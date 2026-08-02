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
