package session

import (
	"crypto/rand"
	"encoding/binary"
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
	// realProto and realCookie hold the local X server's MIT-MAGIC-COOKIE-1
	// credentials, read from $XAUTHORITY. When non-empty, handleX11 replaces
	// the forwarded X11 connection's auth data with these so the local X
	// server accepts the connection. Nil/empty means no local auth is
	// available (e.g. Windows VcXsrv with access control disabled); in that
	// case the connection setup is forwarded unmodified.
	realProto  string
	realCookie []byte
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
		if runtime.GOOS == "windows" {
			display = "localhost:0"
		} else {
			// macOS / Linux: a GUI-launched app (esp. a Finder-launched
			// .app with its env stripped) often has no $DISPLAY even when
			// XQuartz/Xorg is running. Probe /tmp/.X11-unix for a live
			// socket before giving up.
			display = resolveLocalDisplay(display)
			if display == "" {
				return nil, errX11DisplayEmpty
			}
		}
	}

	_, _, screen, err := ParseDisplay(display)
	if err != nil {
		// Windows: treat unparseable DISPLAY (e.g. placeholder like
		// "needs-to-be-defined") the same as empty — fall back to
		// localhost:0. macOS / Linux keep strict validation.
		if runtime.GOOS == "windows" {
			display = "localhost:0"
			_, _, screen, err = ParseDisplay(display)
			if err != nil {
				return nil, fmt.Errorf("x11: %w", err)
			}
		} else {
			return nil, fmt.Errorf("x11: %w", err)
		}
	}

	// Read the local X server's real cookie from $XAUTHORITY for use in
	// handleX11 auth replacement. If unavailable (no xauth file, no
	// matching entry, etc.) the connection setup will be forwarded as-is.
	realProto, realCookie, cerr := LookupCookie(xauthPath, display)
	noRealCookie := false
	if cerr != nil {
		if !errors.Is(cerr, os.ErrNotExist) {
			return nil, fmt.Errorf("x11: %w", cerr)
		}
		noRealCookie = true
	}

	// Always use a random fake cookie for the x11-req (untrusted forwarding,
	// equivalent to ssh -X). This prevents the remote X application from
	// learning the local X server's real cookie. The fake cookie secures the
	// SSH X11 proxy; handleX11 will re-authenticate to the local X server
	// with the real cookie.
	fakeProto := "MIT-MAGIC-COOKIE-1"
	fakeCookie := randomCookie()

	payload := encodeX11Req(false, fakeProto, fakeCookie, uint32(screen))
	if ok, err := session.SendRequest("x11-req", true, payload); err != nil || !ok {
		if err != nil {
			return nil, fmt.Errorf("x11: server rejected x11-req: %w", err)
		}
		return nil, fmt.Errorf("x11: server rejected x11-req (X11Forwarding may be disabled in remote sshd_config)")
	}

	fwd := &x11Forwarder{
		client:     client,
		done:       make(chan struct{}),
		realProto:  realProto,
		realCookie: realCookie,
	}

	// crypto/ssh exposes channel-open handlers as a Go channel; we drain
	// it in one goroutine and fan out per-channel handling.
	chans := client.HandleChannelOpen(x11ChannelType)
	go fwd.acceptX11Channels(chans, display)

	// Surface a warning when no local xauth cookie is available (e.g.
	// Windows without VcXsrv auth, or Linux with a missing Xauthority).
	// The callers treat this sentinel as non-fatal — forwarding still works
	// if the local X server does not enforce MIT-MAGIC-COOKIE-1.
	if noRealCookie {
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
// channel data stream to the local X server. It first reads the initial
// X11 connection setup from the channel, replaces the remote auth data
// (which uses the fake cookie from x11-req) with the real local cookie,
// and writes the modified setup to the local X server. After that it
// bridges the remaining data bidirectionally.
//
// If no real local cookie is available (e.g. Windows VcXsrv without
// access control), the connection setup is forwarded unmodified.
//
// The OpenSSH-specific originator address lives in the channel-open packet
// (ExtraData), NOT in the channel data stream — reading it from ch2 would
// silently eat the first 4+N bytes of the X11 protocol and corrupt the
// connection.
//
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
	// floor — only the channel data stream carries X11 protocol bytes.
	_ = ch.ExtraData()

	local, err := DialLocalX(display)
	if err != nil {
		f.onError("[x11] Could not connect to the local X11 server.\r\n[x11] Display target: " + displayTargetString(display) + "\r\n[x11] " + xServerHint(runtime.GOOS))
		return
	}
	defer local.Close()

	// Replace the X11 connection setup's auth with the real local cookie
	// before bridging. If the setup read/write fails the channel is
	// dropped — the X application will see a connection error and may
	// retry or exit, just as it would if the X server were unreachable.
	forwardX11Setup(local, ch2, f.realProto, f.realCookie)
	bridge(local, ch2)
}

// forwardX11Setup reads the initial X11 connection-request packet from
// remote (the SSH x11 channel), replaces its auth fields with the given
// realProto/realCookie (if non-empty), and writes the result to local.
//
// X11 connection-request wire format:
//
//	1        CARD8   byte-order ('B'=MSB, 'l'=LSB)
//	1               unused
//	2        CARD16  protocol-major-version
//	2        CARD16  protocol-minor-version
//	2        CARD16  auth-protocol-name-length (n)
//	2        CARD16  auth-protocol-data-length (m)
//	2               unused
//	n        STRING  auth-protocol-name
//	m        STRING  auth-protocol-data
//	p               padding, p = pad(n+m)
func forwardX11Setup(local io.Writer, remote io.Reader, realProto string, realCookie []byte) error {
	// Read the 12-byte fixed header.
	header := make([]byte, 12)
	if _, err := io.ReadFull(remote, header); err != nil {
		return err
	}

	// Determine byte order from the first octet.
	var order binary.ByteOrder = binary.BigEndian
	if header[0] == 0x6C { // 'l' = LSB first
		order = binary.LittleEndian
	}

	n := int(order.Uint16(header[6:8]))  // auth-protocol-name length
	m := int(order.Uint16(header[8:10])) // auth-protocol-data length

	// Read the variable-length auth fields.
	authName := make([]byte, n)
	authData := make([]byte, m)
	if n > 0 {
		if _, err := io.ReadFull(remote, authName); err != nil {
			return err
		}
	}
	if m > 0 {
		if _, err := io.ReadFull(remote, authData); err != nil {
			return err
		}
	}

	// Skip padding: pad(x) = (4 - (x % 4)) % 4
	padLen := (4 - ((n + m) % 4)) % 4
	if padLen > 0 {
		if _, err := io.ReadFull(remote, make([]byte, padLen)); err != nil {
			return err
		}
	}

	// Replace auth with the real local cookie when available.
	if realProto != "" && len(realCookie) > 0 {
		newN := uint16(len(realProto))
		newM := uint16(len(realCookie))

		newHeader := make([]byte, 12)
		copy(newHeader, header) // preserves byte-order and protocol version
		order.PutUint16(newHeader[6:8], newN)
		order.PutUint16(newHeader[8:10], newM)
		// bytes 10-11 (unused) already copied

		if _, err := local.Write(newHeader); err != nil {
			return err
		}
		if _, err := local.Write([]byte(realProto)); err != nil {
			return err
		}
		if _, err := local.Write(realCookie); err != nil {
			return err
		}
		return nil
	}

	// No local cookie — forward the original setup unchanged.
	if _, err := local.Write(header); err != nil {
		return err
	}
	if n > 0 {
		if _, err := local.Write(authName); err != nil {
			return err
		}
	}
	if m > 0 {
		if _, err := local.Write(authData); err != nil {
			return err
		}
	}
	if padLen > 0 {
		// Pad bytes are zero-filled per the X11 spec.
		if _, err := local.Write(make([]byte, padLen)); err != nil {
			return err
		}
	}
	return nil
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
		return "Windows: VcXsrv is bundled with uniTerm (plugins/vcxsrv). If missing, reinstall uniTerm."
	case "darwin":
		return "macOS: install and start XQuartz, then try again."
	default:
		return "Linux: make sure DISPLAY is set and an X server is running (Xorg or XWayland)."
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
