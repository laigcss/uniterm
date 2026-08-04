package session

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"runtime"
	"strconv"
	"sync"

	"golang.org/x/crypto/ssh"
)

// x11Forwarder owns the lifecycle of an SSH X11 forwarding session: the
// x11-req global request and any number of x11 channels the server opens
// back to us.
type x11Forwarder struct {
	client  *ssh.Client
	mu      sync.Mutex
	stopped bool
	done    chan struct{}
	// onError surfaces user-facing failures (e.g. local X server not
	// reachable) into the SSH session terminal. Set by the caller.
	onError func(string)
}

const x11ChannelType = "x11"

// encodeX11Req marshals the x11-req channel-request payload per RFC 4254
// §6.3.1 + OpenSSH extensions:
//
//	bool   single-connection
//	string x11-auth-protocol
//	string x11-auth-cookie    (HEX-encoded, not raw bytes)
//	uint32 x11-screen-number
//
// The cookie MUST be hex-encoded (e.g. "0123456789abcdef..." for 16 raw
// bytes). OpenSSH sshd 9.8 calls xauth_valid_string on both proto and
// data and rejects the request with "Invalid X11 forwarding data" if
// either is not a valid xauth string — and a valid xauth cookie is the
// 32-character hex form. We previously sent raw bytes and hit the
// validation rejection.
func encodeX11Req(single bool, proto string, cookie []byte, screen uint32) []byte {
	hexCookie := make([]byte, hex.EncodedLen(len(cookie)))
	hex.Encode(hexCookie, cookie)
	return ssh.Marshal(struct {
		Single bool
		Proto  string
		Cookie string
		Screen uint32
	}{single, proto, string(hexCookie), screen})
}

// randomCookie returns 16 bytes of crypto-grade randomness for use as a
// fake x11-auth-cookie in trusted mode (where the server doesn't verify
// it but the wire format still requires a 16-byte string).
func randomCookie() []byte {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return b
}

var (
	errX11ClientNil       = errors.New("x11: nil ssh client")
	errX11SessionNil      = errors.New("x11: nil ssh session")
	errX11DisplayEmpty    = errors.New("x11: $DISPLAY is empty")
	errX11TrustedFallback = errors.New("x11: trusted mode (no MIT-MAGIC-COOKIE-1 in xauth)")
)

// bridge copies bytes between a and b bidirectionally, closing both when
// either side returns EOF. Same shape as tunnel_forward.go's pipe() but
// takes io.ReadWriteCloser so it can wrap either *net.Conn or *ssh.Channel.
func bridge(a, b io.ReadWriteCloser) {
	done := make(chan struct{}, 2)
	go func() { io.Copy(a, b); done <- struct{}{} }()
	go func() { io.Copy(b, a); done <- struct{}{} }()
	<-done
	a.Close()
	b.Close()
}

// startX11Forward enables X11 forwarding on an already-open SSH session
// channel. It sends the "x11-req" channel request (per RFC 4254 §6.3.1)
// with the parsed cookie, then registers the "x11" channel handler on the
// client to accept forwarded X11 channels. If MIT-MAGIC-COOKIE-1 cannot
// be read from xauthPath the request is sent in trusted mode with a random
// cookie and errX11TrustedFallback is returned alongside the forwarder.
// On Windows an empty display defaults to "localhost:0" (standard
// VcXsrv address); on macOS / Linux an empty display returns
// errX11DisplayEmpty without touching the client.
//
// Note: x11-req is a CHANNEL request (sent on the session channel), not
// a global request. Sending it via client.SendRequest would route it
// through the global-request transport path and OpenSSH servers would
// silently return REQUEST_FAILURE (it only knows x11-req as a channel
// request of the session channel).
func startX11Forward(client *ssh.Client, session *ssh.Session, xauthPath, display string) (*x11Forwarder, error) {
	if client == nil {
		return nil, errX11ClientNil
	}
	if session == nil {
		return nil, errX11SessionNil
	}
	if display == "" {
		// Windows convenience: VcXsrv is standard at localhost:0;
		// assume that's what the user has and skip the empty-DISPLAY error.
		// macOS / Linux keep the strict behavior — their DISPLAY is normally
		// set by the session, and a missing one is usually intentional.
		if runtime.GOOS == "windows" {
			display = "localhost:0"
		} else {
			return nil, errX11DisplayEmpty
		}
	}

	_, _, screen, err := ParseDisplay(display)
	if err != nil {
		return nil, fmt.Errorf("x11: %w", err)
	}

	// LookupCookie surfaces every "no usable cookie" case — empty path,
	// missing file, no matching entry, only unsupported protocols — as
	// os.ErrNotExist, so a single errors.Is covers all of them. Anything
	// else (display parse error, xauthority binary corruption) is a hard
	// failure: we can't trust the cookie, so don't pretend to.
	proto, cookie, cerr := LookupCookie(xauthPath, display)
	trusted := false
	if cerr != nil {
		if !errors.Is(cerr, os.ErrNotExist) {
			return nil, fmt.Errorf("x11: %w", cerr)
		}
		proto = "MIT-MAGIC-COOKIE-1"
		cookie = randomCookie()
		trusted = true
	}

	payload := encodeX11Req(false, proto, cookie, uint32(screen))
	if ok, err := session.SendRequest("x11-req", true, payload); err != nil || !ok {
		if err != nil {
			return nil, fmt.Errorf("x11: server rejected x11-req: %w", err)
		}
		return nil, fmt.Errorf("x11: server rejected x11-req (X11Forwarding may be disabled in remote sshd_config)")
	}

	fwd := &x11Forwarder{
		client: client,
		done:   make(chan struct{}),
	}

	// crypto/ssh exposes channel-open handlers as a Go channel; we drain
	// it in one goroutine and fan out per-channel handling.
	chans := client.HandleChannelOpen(x11ChannelType)
	go fwd.acceptX11Channels(chans, display)

	// Trusted-mode warning is surfaced to the caller (wired in Task 6)
	// so the SSH session can print a yellow warning to the terminal.
	if trusted {
		return fwd, errX11TrustedFallback
	}
	return fwd, nil
}

// acceptX11Channels drains the x11 channel-open stream and spawns a
// per-channel goroutine for each. Returns when the channel is closed
// (SSH disconnect) or stop() is called.
func (f *x11Forwarder) acceptX11Channels(chans <-chan ssh.NewChannel, display string) {
	for {
		select {
		case ch, ok := <-chans:
			if !ok {
				return
			}
			go f.handleX11(ch, display)
		case <-f.done:
			return
		}
	}
}

// handleX11 accepts an "x11" channel from the server and bridges the
// channel data stream to the local X server. The OpenSSH-specific
// originator address lives in the channel-open packet (ExtraData), NOT
// in the channel data stream — reading it from ch2 would silently eat
// the first 4+N bytes of the X11 protocol and corrupt the connection.
// Any error closes the channel silently; legitimate races (e.g. the
// local X server has just shut down) happen often.
func (f *x11Forwarder) handleX11(ch ssh.NewChannel, display string) {
	ch2, requests, err := ch.Accept()
	if err != nil {
		return
	}
	defer ch2.Close()
	go ssh.DiscardRequests(requests)
	// Drop the originator address from the channel-open packet on the
	// floor — the bridge is purely byte-piping ch2 <-> local X.
	_ = ch.ExtraData()

	local, err := DialLocalX(display)
	if err != nil {
		f.onError("[x11] Could not connect to the local X11 server.\r\n[x11] Display target: " + displayTargetString(display) + "\r\n[x11] " + xServerHint(runtime.GOOS))
		return
	}
	bridge(local, ch2)
}

func (f *x11Forwarder) errorf(format string, args ...any) {
	if f.onError != nil {
		f.onError(fmt.Sprintf(format, args...))
	}
}

// displayTargetString renders the dialed target as host:port for error
// messages, e.g. "localhost:6000" for ":0" and "192.168.1.5:6010" for
// "192.168.1.5:10". Falls back to the raw display string for paths.
func displayTargetString(display string) string {
	host, disp, _, err := ParseDisplay(display)
	if err != nil {
		return display
	}
	port := 6000 + disp
	if host == "" {
		host = "localhost"
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

func xServerHint(goos string) string {
	switch goos {
	case "windows":
		return "Windows: install and start VcXsrv, then try again."
	case "darwin":
		return "macOS: install and start XQuartz, then try again."
	default:
		return "Linux: install and start an X server (Xorg), then try again."
	}
}

// stop signals in-flight bridges to exit. Idempotent.
func (f *x11Forwarder) stop() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stopped {
		return
	}
	f.stopped = true
	close(f.done)
	// crypto/ssh has no public "unregister channel handler" API, but the
	// handler is harmless to leave: the client is about to be closed
	// by the SSH session's Disconnect path.
}
