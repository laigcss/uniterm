package session

import (
	"strings"
	"testing"
)

// TestDesktopCommandMapping covers the six built-in desktop environment
// presets. Each maps to a command on the remote wrapped in
// `dbus-run-session --` so the DE has a working DBUS_SESSION_BUS_ADDRESS
// (SSH sessions don't get one injected; see x11_desktop_session.go).
func TestDesktopCommandMapping(t *testing.T) {
	cases := []struct {
		desktopType string
		want        string
	}{
		{"gnome", `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec gnome-session'`},
		{"kde", `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec startkde'`},
		{"xfce", `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec startxfce4'`},
		{"mate", `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec mate-session'`},
		{"cinnamon", `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec cinnamon-session'`},
		{"openbox", `dbus-run-session -- sh -c 'xsetroot -name "X11 Desktop" || true; exec openbox-session'`},
	}
	for _, c := range cases {
		t.Run(c.desktopType, func(t *testing.T) {
			cfg := ConnectionConfig{X11DesktopDesktopType: c.desktopType}
			got, err := resolveDesktopCommand(cfg)
			if err != nil {
				t.Fatalf("resolveDesktopCommand(%q): unexpected error: %v", c.desktopType, err)
			}
			if got != c.want {
				t.Errorf("resolveDesktopCommand(%q) = %q, want %q", c.desktopType, got, c.want)
			}
		})
	}
}

func TestResolveCustomPassthrough(t *testing.T) {
	cfg := ConnectionConfig{
		X11DesktopDesktopType: "custom",
		X11DesktopCustomCmd:   "mycommand --foo bar",
	}
	got, err := resolveDesktopCommand(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "mycommand --foo bar" {
		t.Errorf("got %q, want %q", got, "mycommand --foo bar")
	}
}

func TestResolveCustomWhitespaceTrim(t *testing.T) {
	cfg := ConnectionConfig{
		X11DesktopDesktopType: "custom",
		X11DesktopCustomCmd:   "   startxfce4   ",
	}
	got, err := resolveDesktopCommand(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "startxfce4" {
		t.Errorf("got %q, want trimmed %q", got, "startxfce4")
	}
	if strings.TrimSpace(got) != got {
		t.Errorf("result still has surrounding whitespace: %q", got)
	}
}

func TestResolveCustomEmpty(t *testing.T) {
	cfg := ConnectionConfig{
		X11DesktopDesktopType: "custom",
		X11DesktopCustomCmd:   "",
	}
	_, err := resolveDesktopCommand(cfg)
	if err == nil {
		t.Fatal("expected error for empty custom command, got nil")
	}
}

func TestResolveUnknownType(t *testing.T) {
	cfg := ConnectionConfig{
		X11DesktopDesktopType: "windows-xp",
	}
	_, err := resolveDesktopCommand(cfg)
	if err == nil {
		t.Fatal("expected error for unknown desktop type, got nil")
	}
}

func TestResolveEmptyType(t *testing.T) {
	cfg := ConnectionConfig{}
	_, err := resolveDesktopCommand(cfg)
	if err == nil {
		t.Fatal("expected error for empty desktop type, got nil")
	}
}

// TestX11DesktopSession_NotConnectedByDefault checks that a freshly
// constructed session reports IsConnected() == false and Status() ==
// StatusDisconnected, before Connect is ever called.
func TestX11DesktopSession_NotConnectedByDefault(t *testing.T) {
	s := NewX11DesktopSession("test-x11-id")
	if s == nil {
		t.Fatal("NewX11DesktopSession returned nil")
	}
	if s.IsConnected() {
		t.Error("IsConnected() = true, want false before Connect")
	}
	if s.Status() != StatusDisconnected {
		t.Errorf("Status() = %v, want %v", s.Status(), StatusDisconnected)
	}
	if s.Type() != "x11-desktop" {
		t.Errorf("Type() = %q, want %q", s.Type(), "x11-desktop")
	}
	if s.ID() != "test-x11-id" {
		t.Errorf("ID() = %q, want %q", s.ID(), "test-x11-id")
	}
}

// TestX11DesktopSession_WriteReturnsError checks that Write always
// rejects data: this session represents an X11-forwarded desktop, not a
// terminal pipe, so there is no stdin to write to.
func TestX11DesktopSession_WriteReturnsError(t *testing.T) {
	s := NewX11DesktopSession("test-x11-id")
	if err := s.Write([]byte("hello")); err == nil {
		t.Error("Write() = nil, want non-nil error (X11 desktop is not a terminal)")
	}
}

// TestX11DesktopSession_ResizeIsNoop checks that Resize is a no-op:
// xterm.js dimensions don't apply to a remote desktop rendered by an
// external X server.
func TestX11DesktopSession_ResizeIsNoop(t *testing.T) {
	s := NewX11DesktopSession("test-x11-id")
	if err := s.Resize(80, 24); err != nil {
		t.Errorf("Resize(80, 24) = %v, want nil", err)
	}
	// Boundary values should also be accepted.
	if err := s.Resize(0, 0); err != nil {
		t.Errorf("Resize(0, 0) = %v, want nil", err)
	}
	if err := s.Resize(1000, 500); err != nil {
		t.Errorf("Resize(1000, 500) = %v, want nil", err)
	}
}

// TestX11DesktopSession_DisconnectIdempotent verifies that calling
// Disconnect multiple times is safe: it should return nil every time
// and leave the session in StatusDisconnected. sync.Once guarantees
// the teardown only runs once even if SSH/X11 resources are nil.
func TestX11DesktopSession_DisconnectIdempotent(t *testing.T) {
	s := NewX11DesktopSession("test-x11-id")
	for i := 1; i <= 3; i++ {
		if err := s.Disconnect(); err != nil {
			t.Errorf("Disconnect call %d: unexpected error: %v", i, err)
		}
		if s.Status() != StatusDisconnected {
			t.Errorf("Disconnect call %d: Status() = %v, want %v", i, s.Status(), StatusDisconnected)
		}
	}
}
