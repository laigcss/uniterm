package session

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
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

// resolveLocalDisplay returns a usable X11 display string. A non-empty raw
// value (normally $DISPLAY) is used verbatim. When it's empty on macOS/Linux
// — a GUI-launched app often doesn't inherit $DISPLAY, and a macOS .app opened
// from Finder/Dock has its environment stripped entirely — it probes the
// standard socket dir /tmp/.X11-unix/Xn and returns ":n" for the lowest live
// socket (XQuartz/Xorg both listen there). Returns "" if nothing is found.
func resolveLocalDisplay(raw string) string {
	if raw != "" || runtime.GOOS == "windows" {
		return raw
	}
	entries, err := os.ReadDir("/tmp/.X11-unix")
	if err != nil {
		return ""
	}
	best := -1
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, "X") {
			continue
		}
		n, aerr := strconv.Atoi(name[1:])
		if aerr != nil || n < 0 {
			continue
		}
		if best == -1 || n < best {
			best = n
		}
	}
	if best == -1 {
		return ""
	}
	return ":" + strconv.Itoa(best)
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
			// VcXsrv not running — try to start it.
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
	candidates := vcxsrvCandidates()
	for _, path := range candidates {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		// Minimal VcXsrv args per user: ":0 -clipboard". No -screen
		// (VcXsrv defaults to the primary monitor), no -multiwindow (XWin's
		// default is "windowed" single-window mode, same as XLaunch's
		// "One large window"). Dir must be set to a writable path (the user's
		// home) because VcXsrv writes its XWin.log to the cwd and aborts
		// with "Cannot open log file XWin.log" if cwd is not writable.
		cmd := exec.Command(path, ":0", "-clipboard")
		home, _ := os.UserHomeDir()
		cmd.Dir = home
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

// vcxsrvCandidates returns ordered paths where vcxsrv.exe may be found:
// bundled copy (production + dev), then system-wide installs.
func vcxsrvCandidates() []string {
	var paths []string
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		paths = append(paths, filepath.Join(dir, "plugins", "vcxsrv", "vcxsrv.exe"))
	}
	// Development convenience: wails dev runs from the project root
	if wd, err := os.Getwd(); err == nil {
		paths = append(paths, filepath.Join(wd, "plugins", "vcxsrv", "vcxsrv.exe"))
	}
	paths = append(paths,
		`C:\Program Files\VcXsrv\vcxsrv.exe`,
		`C:\Program Files (x86)\VcXsrv\vcxsrv.exe`,
	)
	return paths
}
