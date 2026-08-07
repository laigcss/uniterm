package session

import (
	"net"
	"path/filepath"
	"regexp"
	"runtime"
	"testing"
)

func TestParseDisplay(t *testing.T) {
	cases := []struct {
		in       string
		wantHost string
		wantDisp int
		wantScrn int
		wantErr  bool
	}{
		{":0", "", 0, 0, false},
		{":0.0", "", 0, 0, false},
		{":10.1", "", 10, 1, false},
		{"unix:0.0", "", 0, 0, false},
		{"localhost:0.0", "localhost", 0, 0, false},
		{"127.0.0.1:10.0", "127.0.0.1", 10, 0, false},
		{"192.168.1.5:0.0", "192.168.1.5", 0, 0, false},
		{"/tmp/com.apple.launchd.abc/org.xquartz:0", "", 0, 0, false},
		{"", "", 0, 0, true},
		{":abc", "", 0, 0, true},
		{":0.abc", "", 0, 0, true},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			host, disp, scrn, err := ParseDisplay(c.in)
			if (err != nil) != c.wantErr {
				t.Fatalf("err = %v, wantErr = %v", err, c.wantErr)
			}
			if err != nil {
				return
			}
			if host != c.wantHost {
				t.Errorf("host = %q, want %q", host, c.wantHost)
			}
			if disp != c.wantDisp {
				t.Errorf("display = %d, want %d", disp, c.wantDisp)
			}
			if scrn != c.wantScrn {
				t.Errorf("screen = %d, want %d", scrn, c.wantScrn)
			}
		})
	}
}

// TestDialLocalX_UnixSocket exercises the unix-socket dial branch on
// Linux/macOS by standing up a socket in a temp dir and dialing it via the
// XQuartz full-path style (display = "/path/to/X0"). That way the test
// doesn't depend on a real X server being installed on the host.
func TestDialLocalX_UnixSocket(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket not supported on Windows")
	}
	dir := t.TempDir()
	sock := filepath.Join(dir, "X0")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	go func() {
		c, _ := ln.Accept()
		if c != nil {
			c.Close()
		}
	}()

	conn, err := DialLocalX(sock)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	conn.Close()
}

func TestDialLocalX_DisplayUnset(t *testing.T) {
	_, err := DialLocalX("")
	if err == nil {
		t.Fatal("expected error for empty DISPLAY")
	}
}

func TestResolveLocalDisplay(t *testing.T) {
	// A non-empty value is always used verbatim, regardless of OS.
	if got := resolveLocalDisplay(":3"); got != ":3" {
		t.Errorf("non-empty passthrough: got %q, want %q", got, ":3")
	}
	if got := resolveLocalDisplay("host:0"); got != "host:0" {
		t.Errorf("non-empty passthrough: got %q, want %q", got, "host:0")
	}

	// Empty-value probing is platform-specific.
	got := resolveLocalDisplay("")
	switch runtime.GOOS {
	case "windows":
		// No socket probing on Windows — empty stays empty.
		if got != "" {
			t.Errorf("windows empty: got %q, want \"\"", got)
		}
	default:
		// macOS/Linux: either no live socket ("") or a well-formed ":n"
		// discovered from /tmp/.X11-unix. Assert the shape, not a fixed
		// value, so the test doesn't depend on whether an X server runs.
		if got != "" && !regexp.MustCompile(`^:\d+$`).MatchString(got) {
			t.Errorf("probed display %q is not empty or \":n\"", got)
		}
	}
}

// TestDialLocalX_RemoteTCP stands up a fake "X server" on 127.0.0.1:6000
// and verifies that DialLocalX for an explicit host uses TCP only.
func TestDialLocalX_RemoteTCP(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:6000")
	if err != nil {
		t.Skipf("port 6000 unavailable: %v", err)
	}
	defer ln.Close()
	go func() {
		c, _ := ln.Accept()
		if c != nil {
			c.Close()
		}
	}()

	conn, err := DialLocalX("127.0.0.1:0.0")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	conn.Close()
}
