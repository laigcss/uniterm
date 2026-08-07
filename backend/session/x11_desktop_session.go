package session

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"

	"github.com/ys-ll/uniterm/backend/log"
)

// "custom" is handled separately below — it is not a preset key.
// SSH sessions don't get DBus session bus injected (pam_systemd only
// does that for graphical logins), so presets are wrapped in
// `dbus-run-session --` to give the DE a working DBUS_SESSION_BUS_ADDRESS.
// Plain commands like xterm don't need it; the wrapper is harmless.
// xsetroot -name sets the root window's WM_NAME so it shows up in the
// Windows taskbar (VcXsrv multiwindow mode creates a Windows window
// per X client; MATE's root window has no title by default and is
// therefore hidden from the taskbar. xsetroot sets the title before
// the DE starts; MATE may or may not override it, but it's harmless
// either way).
var desktopCommands = map[string]string{
	"gnome":    `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec gnome-session'`,
	"kde":      `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec startkde'`,
	"xfce":     `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec startxfce4'`,
	"mate":     `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec mate-session'`,
	"cinnamon": `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec cinnamon-session'`,
	"openbox":  `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec openbox-session'`,
}

func resolveDesktopCommand(cfg ConnectionConfig) (string, error) {
	if cfg.X11DesktopDesktopType == "custom" {
		cmd := strings.TrimSpace(cfg.X11DesktopCustomCmd)
		if cmd == "" {
			return "", fmt.Errorf("x11-desktop: custom command is empty")
		}
		return cmd, nil
	}
	cmd, ok := desktopCommands[cfg.X11DesktopDesktopType]
	if !ok {
		return "", fmt.Errorf("x11-desktop: unknown desktop type %q", cfg.X11DesktopDesktopType)
	}
	return cmd, nil
}

// X11DesktopSession opens an SSH connection to a remote host with X11
// forwarding enabled and runs the chosen desktop command. The remote X
// clients are bridged to the local X server (VcXsrv/XQuartz/Xorg) over
// SSH's x11 channel — the actual desktop is rendered outside uniTerm.
// The session represents the lifecycle of that desktop process:
// Connected while the command is running, Disconnected when it exits.
type X11DesktopSession struct {
	baseSession
	sshClient  *ssh.Client
	sshSession *ssh.Session
	x11Fwd     *x11Forwarder
	quit       chan struct{}
	quitOnce   sync.Once
}

func NewX11DesktopSession(id string) *X11DesktopSession {
	return &X11DesktopSession{
		baseSession: baseSession{id: id, sessionType: "x11-desktop", status: StatusDisconnected},
		quit:        make(chan struct{}),
	}
}

// Connect is the Session-interface stub. The real entry point is
// ConnectX11Desktop below, which X11DesktopConnect in app.go invokes.
// The frontend sets deferConnect: true at create time so the generic
// launch goroutine never calls this method. It exists only to satisfy
// the Session interface; any direct call here is a programming error.
func (s *X11DesktopSession) Connect(config ConnectionConfig) error {
	return fmt.Errorf("x11-desktop: use X11DesktopConnect (not Session.Connect); set deferConnect: true at create time")
}

// ConnectX11Desktop opens an SSH connection with X11 forwarding and runs
// the desktop command on the remote host. Blocks until the remote command
// exits (or the SSH connection drops).
func (s *X11DesktopSession) ConnectX11Desktop(cfg ConnectionConfig) error {
	s.setStatus(StatusConnecting)

	cmd, err := resolveDesktopCommand(cfg)
	if err != nil {
		s.setStatus(StatusError)
		return err
	}

	// X11 forward is mandatory for this type.
	cfg.X11Forwarding = true

	// Make sure a local X server is running. On Windows $DISPLAY is normally
	// unset or set to a placeholder like "needs-to-be-defined"; VcXsrv/Xming
	// listen at localhost:0 by convention, so fall back to that. macOS/Linux
	// keep strict validation.
	display := os.Getenv("DISPLAY")
	if runtime.GOOS == "windows" {
		if _, _, _, perr := ParseDisplay(display); perr != nil {
			display = "localhost:0"
		}
	} else if display == "" {
		display = resolveLocalDisplay(display)
	}
	if _, derr := DialLocalX(display); derr != nil {
		if !tryStartLocalXServer() {
			s.setStatus(StatusError)
			return fmt.Errorf("x11-desktop: local X server unreachable: %w", derr)
		}
		// After starting VcXsrv, try localhost:0 (not the original
		// possibly-broken DISPLAY).
		retryDisplay := display
		if runtime.GOOS == "windows" {
			retryDisplay = "localhost:0"
		}
		if _, derr2 := DialLocalX(retryDisplay); derr2 != nil {
			s.setStatus(StatusError)
			return fmt.Errorf("x11-desktop: local X server unreachable after start: %w", derr2)
		}
	}

	client, err := DialSSHClient(cfg)
	if err != nil {
		s.setStatus(StatusError)
		return fmt.Errorf("x11-desktop: %w", err)
	}
	s.sshClient = client

	sess, err := client.NewSession()
	if err != nil {
		client.Close()
		s.setStatus(StatusError)
		return fmt.Errorf("x11-desktop: new session: %w", err)
	}
	s.sshSession = sess

	xauthPath := os.Getenv("XAUTHORITY")
	if xauthPath == "" {
		if home, herr := os.UserHomeDir(); herr == nil {
			xauthPath = home + "/.Xauthority"
		}
	}
	fwd, ferr := startX11Forward(client, sess, xauthPath, os.Getenv("DISPLAY"))
	switch {
	case ferr == nil, errors.Is(ferr, errX11TrustedFallback):
		s.x11Fwd = fwd
	default:
		sess.Close()
		client.Close()
		s.setStatus(StatusError)
		return fmt.Errorf("x11-desktop: x11 forward: %w", ferr)
	}

	s.title = fmt.Sprintf("%s @ %s (%s)", cfg.X11DesktopDesktopType, cfg.Host, "X11")
	s.setStatus(StatusConnected)

	// Block until remote command exits; report back via status change.
	go func() {
		werr := sess.Run(cmd)
		log.Writef("x11-desktop: command %q exited: %v", cmd, werr)
		s.Disconnect()
	}()

	return nil
}

// Disconnect tears down the X11 forwarder, SSH session, and SSH client.
// Idempotent: sync.Once guarantees the cleanup runs once even if the
// underlying resources are nil (e.g. Disconnect called before Connect,
// or after a partial failure).
func (s *X11DesktopSession) Disconnect() error {
	s.quitOnce.Do(func() {
		if s.x11Fwd != nil {
			s.x11Fwd.stop()
			s.x11Fwd = nil
		}
		if s.sshSession != nil {
			s.sshSession.Close()
		}
		if s.sshClient != nil {
			s.sshClient.Close()
		}
		s.setStatus(StatusDisconnected)
	})
	return nil
}

// Write/Resize are not applicable: X11 data flows directly between
// remote X clients and the local X server, bypassing this session.
// Resize is a no-op because the remote desktop's size is determined by
// the X server, not by xterm.js dimensions.
func (s *X11DesktopSession) Write(_ []byte) error { return fmt.Errorf("x11-desktop: not a terminal session") }
func (s *X11DesktopSession) Resize(_, _ int) error { return nil }

func (s *X11DesktopSession) IsConnected() bool { return s.Status() == StatusConnected }
