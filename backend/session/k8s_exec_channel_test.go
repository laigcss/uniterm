package session

import (
	"encoding/json"
	"testing"
)

func TestExecFraming(t *testing.T) {
	in := encodeStdin([]byte("ls\n"))
	if in[0] != 0 {
		t.Fatalf("stdin channel = %d, want 0", in[0])
	}
	if string(in[1:]) != "ls\n" {
		t.Fatalf("stdin payload = %q", in[1:])
	}

	rz, err := encodeResize(80, 24)
	if err != nil {
		t.Fatalf("encodeResize: %v", err)
	}
	if rz[0] != 3 {
		t.Fatalf("resize channel = %d, want 3", rz[0])
	}
	var size struct{ Width, Height int }
	if err := json.Unmarshal(rz[1:], &size); err != nil {
		t.Fatalf("resize json: %v", err)
	}
	if size.Width != 80 || size.Height != 24 {
		t.Fatalf("resize = %+v, want {80 24}", size)
	}

	ch, payload, ok := decodeFrame([]byte{1, 'h', 'i'})
	if !ok || ch != 1 || string(payload) != "hi" {
		t.Fatalf("decodeFrame stdout = (%d,%q,%v)", ch, payload, ok)
	}
	if _, _, ok := decodeFrame([]byte{}); ok {
		t.Fatalf("empty frame should not decode")
	}
}
