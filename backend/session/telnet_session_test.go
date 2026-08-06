package session

import (
	"context"
	"net"
	"sync"
	"testing"
	"time"
)

// pipeServer drains the server end of a net.Pipe in a background goroutine
// so that writes on the client end never block.
type pipeServer struct {
	conn net.Conn
	mu   sync.Mutex
	buf  []byte
}

func newPipeServer(t *testing.T, server net.Conn) *pipeServer {
	t.Helper()
	ps := &pipeServer{conn: server}
	go ps.readLoop()
	return ps
}

func (p *pipeServer) readLoop() {
	for {
		b := make([]byte, 4096)
		n, err := p.conn.Read(b)
		if err != nil {
			return
		}
		p.mu.Lock()
		p.buf = append(p.buf, b[:n]...)
		p.mu.Unlock()
	}
}

// collect returns buffered data and drains the buffer. Returns nil if
// no data arrives within timeout.
func (p *pipeServer) collect(timeout time.Duration) []byte {
	deadline := time.Now().Add(timeout)
	for {
		p.mu.Lock()
		buf := make([]byte, len(p.buf))
		copy(buf, p.buf)
		p.buf = p.buf[:0]
		p.mu.Unlock()
		if len(buf) > 0 {
			return buf
		}
		if time.Now().After(deadline) {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (p *pipeServer) close() {
	p.conn.Close()
}

// testTelnetPair creates a TelnetSession connected via net.Pipe.
// The server side is drained by a background goroutine so writes never block.
func testTelnetPair(t *testing.T, config ConnectionConfig) (*TelnetSession, *pipeServer) {
	t.Helper()
	client, server := net.Pipe()

	s := NewTelnetSession("test")
	s.conn = client
	s.cancel = context.CancelFunc(func() {})
	s.setStatus(StatusConnected)

	s.localEcho = config.LocalEcho
	s.telnetSendMode = config.TelnetSendMode
	s.newlineMode = config.NewlineMode

	ps := newPipeServer(t, server)
	return s, ps
}

func TestTelnetLocalEcho(t *testing.T) {
	config := ConnectionConfig{LocalEcho: true}
	s, ps := testTelnetPair(t, config)
	defer ps.close()
	defer s.Disconnect()

	var echoed []byte
	s.SetOnDataCallback(func(data []byte) {
		echoed = append(echoed, data...)
	})

	err := s.Write([]byte("hello"))
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	if string(echoed) != "hello" {
		t.Errorf("expected echoed 'hello', got %q", echoed)
	}

	got := ps.collect(200 * time.Millisecond)
	if string(got) != "hello" {
		t.Errorf("expected server to receive 'hello', got %q", got)
	}
}

func TestTelnetLocalEchoOff(t *testing.T) {
	config := ConnectionConfig{LocalEcho: false}
	s, ps := testTelnetPair(t, config)
	defer ps.close()
	defer s.Disconnect()

	var echoed []byte
	s.SetOnDataCallback(func(data []byte) {
		echoed = append(echoed, data...)
	})

	err := s.Write([]byte("hello"))
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	if len(echoed) != 0 {
		t.Errorf("expected no echo, got %q", echoed)
	}

	got := ps.collect(200 * time.Millisecond)
	if string(got) != "hello" {
		t.Errorf("expected server to receive 'hello', got %q", got)
	}
}

func TestTelnetSendModeLine(t *testing.T) {
	config := ConnectionConfig{TelnetSendMode: "line"}
	s, ps := testTelnetPair(t, config)
	defer ps.close()
	defer s.Disconnect()

	// Write individual characters — should be buffered, not sent.
	s.Write([]byte("h"))
	s.Write([]byte("e"))
	s.Write([]byte("l"))
	s.Write([]byte("l"))
	s.Write([]byte("o"))

	// Server should NOT have received anything yet.
	got := ps.collect(200 * time.Millisecond)
	if len(got) != 0 {
		t.Errorf("expected no data before Enter, got %q", got)
	}

	// Press Enter — buffer should flush.
	s.Write([]byte("\r"))

	got = ps.collect(200 * time.Millisecond)
	if string(got) != "hello\r" {
		t.Errorf("expected 'hello\\r', got %q", got)
	}
}

func TestTelnetSendModeCharacter(t *testing.T) {
	config := ConnectionConfig{TelnetSendMode: "character"}
	s, ps := testTelnetPair(t, config)
	defer ps.close()
	defer s.Disconnect()

	s.Write([]byte("h"))
	got := ps.collect(200 * time.Millisecond)
	if string(got) != "h" {
		t.Errorf("expected immediate 'h', got %q", got)
	}
}

func TestTelnetSendModeLineLF(t *testing.T) {
	// \n (Ctrl+J) should also flush the buffer.
	config := ConnectionConfig{TelnetSendMode: "line"}
	s, ps := testTelnetPair(t, config)
	defer ps.close()
	defer s.Disconnect()

	s.Write([]byte("test"))
	s.Write([]byte("\n"))

	got := ps.collect(200 * time.Millisecond)
	if string(got) != "test\n" {
		t.Errorf("expected 'test\\n', got %q", got)
	}
}

func TestTelnetNewlineCRLF(t *testing.T) {
	config := ConnectionConfig{NewlineMode: "crlf"}
	s, ps := testTelnetPair(t, config)
	defer ps.close()
	defer s.Disconnect()

	s.Write([]byte("hello\r"))

	got := ps.collect(200 * time.Millisecond)
	if string(got) != "hello\r\n" {
		t.Errorf("expected 'hello\\r\\n', got %q", got)
	}
}

func TestTelnetNewlineCR(t *testing.T) {
	config := ConnectionConfig{NewlineMode: "cr"}
	s, ps := testTelnetPair(t, config)
	defer ps.close()
	defer s.Disconnect()

	s.Write([]byte("hello\r"))

	got := ps.collect(200 * time.Millisecond)
	if string(got) != "hello\r" {
		t.Errorf("expected 'hello\\r', got %q", got)
	}
}

func TestTelnetNewlineCRLFWithLineMode(t *testing.T) {
	config := ConnectionConfig{
		TelnetSendMode:    "line",
		NewlineMode: "crlf",
	}
	s, ps := testTelnetPair(t, config)
	defer ps.close()
	defer s.Disconnect()

	s.Write([]byte("hello"))
	s.Write([]byte("\r"))

	got := ps.collect(200 * time.Millisecond)
	if string(got) != "hello\r\n" {
		t.Errorf("expected 'hello\\r\\n', got %q", got)
	}
}

func TestTelnetLocalEchoAndLineMode(t *testing.T) {
	config := ConnectionConfig{
		LocalEcho: false,
		TelnetSendMode:  "line",
	}
	s, ps := testTelnetPair(t, config)
	defer ps.close()
	defer s.Disconnect()

	var echoed []byte
	s.SetOnDataCallback(func(data []byte) {
		echoed = append(echoed, data...)
	})

	// Type characters without Enter — should echo locally for visibility.
	s.Write([]byte("ab"))

	if string(echoed) != "ab" {
		t.Errorf("line mode: expected local echo of 'ab', got %q", echoed)
	}

	// Server should NOT have received anything yet.
	got := ps.collect(200 * time.Millisecond)
	if len(got) != 0 {
		t.Errorf("line mode: expected no server data before Enter, got %q", got)
	}
}
