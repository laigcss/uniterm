package session

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ParseDisplay parses an X11 $DISPLAY string into its host, display number,
// and screen number. host is "" for local (":0", "unix:0", or a full XQuartz
// abstract socket path starting with "/"). Returns an error for empty or
// malformed values.
func ParseDisplay(s string) (host string, display, screen int, err error) {
	if s == "" {
		return "", 0, 0, fmt.Errorf("empty DISPLAY")
	}

	// XQuartz full abstract socket path: use the path as-is, no host/port
	// parsing. The whole string is the local endpoint.
	if strings.HasPrefix(s, "/") {
		return "", 0, 0, nil
	}

	// Split "host:display.screen" or "host:display" or "unix:display.screen".
	var rest string
	if i := strings.LastIndex(s, ":"); i < 0 {
		return "", 0, 0, fmt.Errorf("missing ':' in %q", s)
	} else {
		host, rest = s[:i], s[i+1:]
	}
	if host == "unix" {
		host = ""
	}

	dispStr := rest
	if i := strings.Index(rest, "."); i >= 0 {
		dispStr = rest[:i]
		if rest[i+1:] != "" {
			screen, err = strconv.Atoi(rest[i+1:])
			if err != nil {
				return "", 0, 0, fmt.Errorf("bad screen: %w", err)
			}
		}
	}
	display, err = strconv.Atoi(dispStr)
	if err != nil {
		return "", 0, 0, fmt.Errorf("bad display: %w", err)
	}
	if display < 0 {
		return "", 0, 0, fmt.Errorf("negative display: %d", display)
	}
	return host, display, screen, nil
}

// DialLocalX connects to the X server pointed to by `display`.
//   - ":N" / "unix:N"                         → unix socket /tmp/.X11-unix/XN
//     on Linux/macOS, with a parallel TCP fallback to 127.0.0.1:6000+N.
//   - "host:N"                                → TCP host:6000+N.
//   - A path beginning with "/" (XQuartz etc.) → that exact unix socket.
//
// Local dials try unix and TCP in parallel (5s total) and return whichever
// wins, so an X server with no unix socket (e.g. -nolisten unix, Wayland
// shim) still works.
func DialLocalX(display string) (net.Conn, error) {
	host, disp, _, err := ParseDisplay(display)
	if err != nil {
		return nil, err
	}

	if host == "" || host == "localhost" || host == "127.0.0.1" {
		conn, err := dialLocal(runtime.GOOS, display, disp, 5*time.Second)
		if err != nil && runtime.GOOS == "windows" {
			// VcXsrv / Xming not running — try to start it.
			if started := tryStartLocalXServer(); started {
				conn, err = dialLocal(runtime.GOOS, display, disp, 5*time.Second)
			}
		}
		return conn, err
	}
	return net.DialTimeout("tcp", net.JoinHostPort(host, "600"+strconv.Itoa(disp)), 5*time.Second)
}

// tryStartLocalXServer attempts to launch VcXsrv on Windows if it's not
// already running. Returns true if it spawned a process (caller should
// retry the dial). No-op on macOS / Linux — XQuartz is a user-level .app
// that needs a different launcher, and Xorg is expected to already be
// running in a graphical session.
func tryStartLocalXServer() bool {
	if runtime.GOOS != "windows" {
		return false
	}
	if c, err := net.DialTimeout("tcp", "127.0.0.1:6000", 200*time.Millisecond); err == nil {
		c.Close()
		return false
	}
	candidates := []string{
		`C:\Program Files\VcXsrv\vcxsrv.exe`,
		`C:\Program Files (x86)\VcXsrv\vcxsrv.exe`,
	}
	for _, path := range candidates {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		cmd := exec.Command(path, ":0", "-ac", "-multiwindow", "-clipboard", "-silent-dup-error")
		if err := cmd.Start(); err != nil {
			return false
		}
		for i := 0; i < 50; i++ {
			time.Sleep(100 * time.Millisecond)
			if c, err := net.DialTimeout("tcp", "127.0.0.1:6000", 200*time.Millisecond); err == nil {
				c.Close()
				return true
			}
		}
		return false
	}
	return false
}

func dialLocal(goos, display string, disp int, timeout time.Duration) (net.Conn, error) {
	tcpAddr := net.JoinHostPort("127.0.0.1", "600"+strconv.Itoa(disp))
	if goos == "windows" {
		return net.DialTimeout("tcp", tcpAddr, timeout)
	}

	var unixAddr string
	if strings.HasPrefix(display, "/") {
		unixAddr = display
	} else {
		unixAddr = "/tmp/.X11-unix/X" + strconv.Itoa(disp)
	}

	type result struct {
		conn net.Conn
		err  error
	}
	ch := make(chan result, 2)
	go func() { c, e := net.DialTimeout("unix", unixAddr, timeout); ch <- result{c, e} }()
	go func() { c, e := net.DialTimeout("tcp", tcpAddr, timeout); ch <- result{c, e} }()
	var firstErr error
	for i := 0; i < 2; i++ {
		r := <-ch
		if r.err == nil {
			return r.conn, nil
		}
		if firstErr == nil {
			firstErr = r.err
		}
	}
	return nil, firstErr
}
