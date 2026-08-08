package session

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestEncodeX11Req(t *testing.T) {
	cookie := []byte("0123456789abcdef") // 16 bytes
	payload := encodeX11Req(false, "MIT-MAGIC-COOKIE-1", cookie, 0)

	// Layout: bool(1) | string(4+N) proto | string(4+2N) cookie (hex) | uint32(4) screen
	//   = 1 + 4+18 + 4+32 + 4 = 63 bytes ("MIT-MAGIC-COOKIE-1" is 18 chars,
	//   cookie is 16 raw bytes hex-encoded to 32 ASCII chars)
	if got, want := len(payload), 63; got != want {
		t.Fatalf("len = %d, want %d", got, want)
	}

	// bool single-connection
	if payload[0] != 0 {
		t.Errorf("single-connection = %d, want 0", payload[0])
	}

	// string x11-auth-protocol
	plen := binary.BigEndian.Uint32(payload[1:5])
	if int(plen) != len("MIT-MAGIC-COOKIE-1") {
		t.Errorf("proto len = %d", plen)
	}
	if !bytes.Equal(payload[5:5+plen], []byte("MIT-MAGIC-COOKIE-1")) {
		t.Errorf("proto = %q", payload[5:5+plen])
	}

	// string x11-auth-cookie (HEX-encoded; see encodeX11Req doc)
	off := 5 + plen
	clen := binary.BigEndian.Uint32(payload[off : off+4])
	if int(clen) != 32 {
		t.Errorf("cookie len = %d, want 32 (hex-encoded 16 raw bytes)", clen)
	}
	wantCookie := []byte("30313233343536373839616263646566") // hex("0123456789abcdef")
	if !bytes.Equal(payload[off+4:off+4+clen], wantCookie) {
		t.Errorf("cookie = %q, want %q", payload[off+4:off+4+clen], wantCookie)
	}

	// uint32 screen
	off = off + 4 + clen
	if screen := binary.BigEndian.Uint32(payload[off : off+4]); screen != 0 {
		t.Errorf("screen = %d, want 0", screen)
	}
}

type rwPair struct {
	a, b net.Conn
}

func newRWPair(t *testing.T) rwPair {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	type accepted struct {
		conn net.Conn
		err  error
	}
	ch := make(chan accepted, 1)
	go func() {
		c, e := ln.Accept()
		ch <- accepted{c, e}
	}()
	c1, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	a := <-ch
	if a.err != nil {
		t.Fatal(a.err)
	}
	return rwPair{a: c1, b: a.conn}
}

func TestBridge_Bidirectional(t *testing.T) {
	p := newRWPair(t)
	defer p.a.Close()
	defer p.b.Close()
	go bridge(p.a, p.b)

	// a → b
	go func() { p.a.Write([]byte("ping")) }()
	buf := make([]byte, 4)
	if _, err := io.ReadFull(p.b, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != "ping" {
		t.Errorf("b got %q, want %q", buf, "ping")
	}

	// b → a
	go func() { p.b.Write([]byte("pong")) }()
	if _, err := io.ReadFull(p.a, buf); err != nil {
		t.Fatal(err)
	}
	if string(buf) != "pong" {
		t.Errorf("a got %q, want %q", buf, "pong")
	}

	// Close a; bridge should close b too.
	p.a.Close()
	p.b.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := p.b.Read(buf); err == nil {
		t.Error("expected b to be closed after a closed")
	}
}

func TestBridge_AlreadyClosedPartner(t *testing.T) {
	p := newRWPair(t)
	defer p.a.Close()
	defer p.b.Close()
	p.b.Close()
	done := make(chan struct{})
	go func() { bridge(p.a, p.b); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("bridge hung when partner was already closed")
	}
}

func TestStartX11Forward_NilClient(t *testing.T) {
	_, err := startX11Forward(nil, nil, "", "")
	if !errors.Is(err, errX11ClientNil) {
		t.Fatalf("err = %v, want errX11ClientNil", err)
	}
}

func TestStartX11Forward_NilSession(t *testing.T) {
	_, err := startX11Forward(&ssh.Client{}, nil, "", "")
	if !errors.Is(err, errX11SessionNil) {
		t.Fatalf("err = %v, want errX11SessionNil", err)
	}
}

// makeX11ConnReq builds an X11 connection-request packet with the given
// byte order, auth proto name, and auth data. 'B' for big-endian, 'l'
// for little-endian.
func makeX11ConnReq(t *testing.T, byteOrder byte, authProto string, authData []byte) []byte {
	t.Helper()
	var order binary.ByteOrder = binary.BigEndian
	if byteOrder == 'l' {
		order = binary.LittleEndian
	}

	var buf bytes.Buffer
	// byte-order
	buf.WriteByte(byteOrder)
	// unused
	buf.WriteByte(0)
	// protocol-major-version (11)
	b := make([]byte, 2)
	order.PutUint16(b, 11)
	buf.Write(b)
	// protocol-minor-version (0)
	order.PutUint16(b, 0)
	buf.Write(b)
	// auth-protocol-name-length
	order.PutUint16(b, uint16(len(authProto)))
	buf.Write(b)
	// auth-protocol-data-length
	order.PutUint16(b, uint16(len(authData)))
	buf.Write(b)
	// unused
	buf.Write([]byte{0, 0})
	// auth-protocol-name
	buf.WriteString(authProto)
	// auth-protocol-data
	buf.Write(authData)
	// padding
	padLen := (4 - ((len(authProto) + len(authData)) % 4)) % 4
	buf.Write(make([]byte, padLen))

	return buf.Bytes()
}

func TestForwardX11Setup_ReplacesAuth(t *testing.T) {
	origProto := "MIT-MAGIC-COOKIE-1"
	origCookie := []byte("fakefakefakefake") // 16 bytes
	req := makeX11ConnReq(t, 'B', origProto, origCookie)

	reader := bytes.NewReader(req)
	var writer bytes.Buffer

	realProto := "MIT-MAGIC-COOKIE-1"
	realCookie := []byte("realrealrealreal") // 16 bytes

	err := forwardX11Setup(&writer, reader, realProto, realCookie)
	if err != nil {
		t.Fatalf("forwardX11Setup: %v", err)
	}

	// Verify output contains real cookie, not fake.
	got := writer.Bytes()
	if bytes.Contains(got, origCookie) {
		t.Error("output still contains original fake cookie")
	}
	if !bytes.Contains(got, realCookie) {
		t.Error("output does not contain real cookie")
	}
	if !bytes.Contains(got, []byte(realProto)) {
		t.Error("output does not contain real proto")
	}

	// Verify the header byte order is preserved (big-endian).
	if got[0] != 'B' {
		t.Errorf("byte-order = %c, want 'B'", got[0])
	}

	// Verify the auth length fields in the header were updated.
	n := int(binary.BigEndian.Uint16(got[6:8]))
	m := int(binary.BigEndian.Uint16(got[8:10]))
	if n != len(realProto) {
		t.Errorf("auth proto len = %d, want %d", n, len(realProto))
	}
	if m != len(realCookie) {
		t.Errorf("auth data len = %d, want %d", m, len(realCookie))
	}
}

func TestForwardX11Setup_LittleEndian(t *testing.T) {
	origProto := "MIT-MAGIC-COOKIE-1"
	origCookie := []byte("fakefakefakefake")
	req := makeX11ConnReq(t, 'l', origProto, origCookie)

	reader := bytes.NewReader(req)
	var writer bytes.Buffer

	realProto := "MIT-MAGIC-COOKIE-1"
	realCookie := []byte("realrealrealreal")

	err := forwardX11Setup(&writer, reader, realProto, realCookie)
	if err != nil {
		t.Fatalf("forwardX11Setup: %v", err)
	}

	got := writer.Bytes()
	if got[0] != 'l' {
		t.Errorf("byte-order = %c, want 'l'", got[0])
	}
	if !bytes.Contains(got, realCookie) {
		t.Error("output does not contain real cookie")
	}

	// Verify length fields are little-endian.
	n := int(binary.LittleEndian.Uint16(got[6:8]))
	m := int(binary.LittleEndian.Uint16(got[8:10]))
	if n != len(realProto) {
		t.Errorf("auth proto len = %d, want %d", n, len(realProto))
	}
	if m != len(realCookie) {
		t.Errorf("auth data len = %d, want %d", m, len(realCookie))
	}
}

func TestForwardX11Setup_NoRealCookie_Passthrough(t *testing.T) {
	origProto := "MIT-MAGIC-COOKIE-1"
	origCookie := []byte("fakefakefakefake")
	req := makeX11ConnReq(t, 'B', origProto, origCookie)

	reader := bytes.NewReader(req)
	var writer bytes.Buffer

	// Empty real cookie → should passthrough unchanged.
	err := forwardX11Setup(&writer, reader, "", nil)
	if err != nil {
		t.Fatalf("forwardX11Setup: %v", err)
	}

	got := writer.Bytes()
	if !bytes.Equal(got, req) {
		t.Errorf("passthrough output differs from input:\n  got: %x\n want: %x", got, req)
	}
}

func TestForwardX11Setup_NoAuthInOrig(t *testing.T) {
	// X11 connection with no auth (n=0, m=0).
	req := makeX11ConnReq(t, 'B', "", nil)

	reader := bytes.NewReader(req)
	var writer bytes.Buffer

	realProto := "MIT-MAGIC-COOKIE-1"
	realCookie := []byte("realrealrealreal")

	err := forwardX11Setup(&writer, reader, realProto, realCookie)
	if err != nil {
		t.Fatalf("forwardX11Setup: %v", err)
	}

	got := writer.Bytes()
	if !bytes.Contains(got, realCookie) {
		t.Error("output does not contain real cookie (should add auth)")
	}
	if !bytes.Contains(got, []byte(realProto)) {
		t.Error("output does not contain real proto (should add auth)")
	}
}

func TestForwardX11Setup_ShortRead(t *testing.T) {
	// Incomplete header — should return error.
	reader := bytes.NewReader([]byte{0x42, 0x00, 0x00})
	var writer bytes.Buffer

	err := forwardX11Setup(&writer, reader, "MIT-MAGIC-COOKIE-1", []byte("cccccccccccccccc"))
	if err == nil {
		t.Fatal("expected error for truncated header, got nil")
	}
}
