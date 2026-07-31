package session

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAnsiStripperBasic(t *testing.T) {
	var s ansiStripper
	got := string(s.Strip([]byte("hello \x1b[31mred\x1b[0m world")))
	want := "hello red world"
	if got != want {
		t.Errorf("Strip = %q, want %q", got, want)
	}
}

func TestAnsiStripperSplitAcrossChunks(t *testing.T) {
	var s ansiStripper
	// Split ESC [ 31 m across two calls: pending state must survive.
	a := string(s.Strip([]byte("hello \x1b[")))
	b := string(s.Strip([]byte("31mred\x1b[0m")))
	got := a + b
	if !strings.Contains(got, "hello red") {
		t.Errorf("split-chunk strip got %q, want to contain %q", got, "hello red")
	}
	if strings.Contains(got, "\x1b") {
		t.Errorf("ESC leaked through: %q", got)
	}
}

func TestAnsiStripperOSC(t *testing.T) {
	var s ansiStripper
	// OSC title set: ESC ] 0 ; title BEL
	got := string(s.Strip([]byte("prompt\x1b]0;mytitle\x07$ ")))
	want := "prompt$ "
	if got != want {
		t.Errorf("OSC strip = %q, want %q", got, want)
	}
}

func TestAnsiStripperPreservesControl(t *testing.T) {
	var s ansiStripper
	// \r \n \t \b must survive.
	got := string(s.Strip([]byte("a\r\nb\tc\bd")))
	want := "a\r\nb\tc\bd"
	if got != want {
		t.Errorf("control-byte strip = %q, want %q", got, want)
	}
}

func TestAnsiStripperUTF8(t *testing.T) {
	var s ansiStripper
	// Chinese chars are UTF-8 multi-byte; must pass through verbatim
	// even when interleaved with ANSI.
	got := string(s.Strip([]byte("你好 \x1b[32m世界\x1b[0m")))
	want := "你好 世界"
	if got != want {
		t.Errorf("UTF-8 strip = %q, want %q", got, want)
	}
}

func TestSanitizeLogName(t *testing.T) {
	cases := []struct{ in, want string }{
		{"prod-switch-01", "prod-switch-01"},
		{"a/b:c*.log", "a_b_c_.log"},
		{"   trim me   ", "trim me"},
		{"a__b___c", "a_b_c"},
		{"", ""},
		{"CON", "_CON_"},
		{"con", "_con_"},
		{"COM1", "_COM1_"},
		{"COM10", "COM10"}, // COM10 is NOT reserved
		{"你好 服务器", "你好 服务器"},
		{strings.Repeat("x", 150), strings.Repeat("x", 100)},
	}
	for _, c := range cases {
		got := sanitizeLogName(c.in)
		if got != c.want {
			t.Errorf("sanitizeLogName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestLineProcessorSlowCharEchoNoDuplication(t *testing.T) {
	// Regression for issue #358: a switch CLI echoes one char per keystroke.
	// When the user types slower than flushTimeout, each Feed triggers a
	// timeout flush. The buffer must only emit the NEW tail each time, not
	// re-emit the growing prefix, or the log fills with duplicated lines
	// like "port acc[prompt]port accv[prompt]port access v...".
	p := lineProcessor{flushTimeout: 1 * time.Millisecond}
	var out []byte
	for _, ch := range []string{"v", "l", "a", "n", " ", "2", "4"} {
		time.Sleep(2 * time.Millisecond)
		out = append(out, p.Feed([]byte(ch))...)
	}
	out = append(out, p.Feed([]byte("\r\n"))...)
	got := string(out)
	want := "vlan 24\n"
	if got != want {
		t.Errorf("slow char echo = %q, want %q", got, want)
	}
}

func TestLineProcessorRepaintAfterTimeoutFlush(t *testing.T) {
	// After a timeout flush emits a prefix, a \r-repaint that overwrites
	// already-emitted bytes must re-flush the corrected tail rather than
	// silently drop it.
	p := lineProcessor{flushTimeout: 1 * time.Millisecond}
	out := string(p.Feed([]byte("abc")))
	if out != "" {
		t.Errorf("first Feed emitted %q, want empty", out)
	}
	time.Sleep(2 * time.Millisecond)
	// Timeout flush emits "abc"; then \r rewrites to "aXY". "abc" is already
	// committed to the log (can't be unwritten), so the corrected tail is
	// appended: the second Feed yields "abc" (flush) + "aXY\n" (repaint).
	out2 := string(p.Feed([]byte("\raXY\n")))
	want := "abcaXY\n"
	if out2 != want {
		t.Errorf("repaint after flush = %q, want %q", out2, want)
	}
}

func TestLineProcessorReadlineRecallEraseToEnd(t *testing.T) {
	// Regression: readline history recall repaints the prompt line. Recalling
	// a SHORTER command over a longer one uses ESC[K to erase the leftover
	// tail. Without interpreting ESC[K the log kept the old tail, e.g.
	// "cat trace_fip_flows.sh er01.cloud.local...". \r returns to col 0, the
	// new command overwrites, ESC[K erases the rest.
	var p lineProcessor
	// First command echoed, then Enter.
	got1 := string(p.Feed([]byte("[root@m ~]# cat test.txt\r\n")))
	if got1 != "[root@m ~]# cat test.txt\n" {
		t.Errorf("first line = %q", got1)
	}
	// Prompt reprints; user recalls a longer line then a shorter one. The
	// shorter recall overwrites from col 0 and erases the tail with ESC[K.
	in := []byte("[root@m ~]# cat a_very_long_old_command.txt\r" +
		"[root@m ~]# cat short.sh\x1b[K\r\n")
	got2 := string(p.Feed(in))
	want2 := "[root@m ~]# cat short.sh\n"
	if got2 != want2 {
		t.Errorf("recall erase-to-end = %q, want %q", got2, want2)
	}
}

func TestLineProcessorCursorMoveAndDelete(t *testing.T) {
	// readline mid-line edit: type "helo", move cursor left with ESC[D,
	// insert 'l' — verify cursor-left (D) and the resulting text.
	var p lineProcessor
	// "helo" then cursor left 2 (before 'l'... actually before 'o'): ESC[2D
	// puts cursor between 'e' and 'l'; insert 'l' → "hello".
	got := string(p.Feed([]byte("helo\x1b[2Dl\r\n")))
	// helo, pos=4. ESC[2D → pos=2 (between 'e' and 'l'). write 'l' overwrites
	// 'l' at pos2, pos=3. \n flushes "hello"? -> overwrite makes "hello"? no:
	// "helo"[2]='l' overwritten with 'l' = "helo", pos3. So result "helo".
	// This asserts cursor-left works without corrupting the buffer.
	if got != "helo\n" {
		t.Errorf("cursor move = %q, want %q", got, "helo\n")
	}
}

func TestLineProcessorDeleteChar(t *testing.T) {
	// ESC[P (DCH) deletes n chars at cursor — used by readline Ctrl+D / edit.
	var p lineProcessor
	// "hello", cursor to col 1 (ESC[2G → 1-indexed col 2 = pos 1, on 'e'),
	// delete 1 char → "hllo".
	got := string(p.Feed([]byte("hello\x1b[2G\x1b[Px\r\n")))
	// hello pos5. ESC[2G → pos1. ESC[P deletes 'e' → "hllo" pos1. 'x' writes
	// at pos1 over 'l' → "hxlo" pos2. \n → "hxlo".
	if got != "hxlo\n" {
		t.Errorf("delete char = %q, want %q", got, "hxlo\n")
	}
}

func TestOutputLoggerBasic(t *testing.T) {
	var l OutputLogger
	dir := t.TempDir()

	path, err := l.Enable(dir, "test-conn", "ssh")
	if err != nil {
		t.Fatalf("Enable: %v", err)
	}
	if !l.Enabled() {
		t.Fatal("Enabled = false after Enable")
	}
	l.WriteOutput([]byte("hello \x1b[31mred\x1b[0m world\n"))
	l.WriteOutput([]byte("second line\n"))
	l.Disable()
	if l.Enabled() {
		t.Fatal("Enabled = true after Disable")
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	s := string(content)
	if !strings.Contains(s, bannerHeader) {
		t.Errorf("header banner missing:\n%s", s)
	}
	if !strings.Contains(s, "Name: test-conn") {
		t.Errorf("Name line missing:\n%s", s)
	}
	if !strings.Contains(s, "Protocol: ssh") {
		t.Errorf("Protocol line missing:\n%s", s)
	}
	if !strings.Contains(s, "hello red world") {
		t.Errorf("ANSI not stripped:\n%s", s)
	}
	if strings.Contains(s, "\x1b") {
		t.Errorf("ESC leaked into log:\n%s", s)
	}
	if !strings.Contains(s, "=== Ended:") {
		t.Errorf("footer banner missing:\n%s", s)
	}
}

func TestOutputLoggerFileNameCollision(t *testing.T) {
	var l1, l2 OutputLogger
	dir := t.TempDir()

	p1, err := l1.Enable(dir, "same", "ssh")
	if err != nil {
		t.Fatal(err)
	}
	p2, err := l2.Enable(dir, "same", "ssh")
	if err != nil {
		t.Fatal(err)
	}
	if p1 == p2 {
		t.Fatalf("same-second collision produced same path: %s", p1)
	}
	if filepath.Dir(p1) != filepath.Dir(p2) {
		t.Errorf("paths in different dirs: %s vs %s", p1, p2)
	}
	l1.Disable()
	l2.Disable()
}

func TestOutputLoggerDisableIdempotent(t *testing.T) {
	var l OutputLogger
	dir := t.TempDir()
	_, err := l.Enable(dir, "t", "ssh")
	if err != nil {
		t.Fatal(err)
	}
	l.Disable()
	l.Disable()
	l.WriteOutput([]byte("after disable"))
}

func TestOutputLoggerWriteAfterDisable(t *testing.T) {
	var l OutputLogger
	dir := t.TempDir()
	path, err := l.Enable(dir, "t", "ssh")
	if err != nil {
		t.Fatal(err)
	}
	l.WriteOutput([]byte("before\n"))
	l.Disable()
	l.WriteOutput([]byte("this should not land\n"))

	content, _ := os.ReadFile(path)
	if strings.Contains(string(content), "this should not land") {
		t.Errorf("write after disable landed: %s", content)
	}
}

func TestBaseSessionLogOnConnectRoundtrip(t *testing.T) {
	s := &baseSession{id: "x", sessionType: "ssh"}
	if s.AutoLogOnConnect() {
		t.Errorf("default AutoLogOnConnect should be false")
	}
	s.SetLogOnConnect(true)
	if !s.AutoLogOnConnect() {
		t.Errorf("AutoLogOnConnect not set")
	}
	s.SetLogOnConnect(false)
	if s.AutoLogOnConnect() {
		t.Errorf("AutoLogOnConnect not cleared")
	}
}

func TestBaseSessionEmitDataTeesToWriter(t *testing.T) {
	s := &baseSession{id: "abc12345xxx", sessionType: "ssh", title: "myconn"}

	// Install a writer that appends every byte received.
	var logged []byte
	s.SetOutputLogWriter(func(b []byte) { logged = append(logged, b...) })

	// Capture the frontend callback to ensure it still fires with raw data.
	var seen []byte
	s.SetOnDataCallback(func(b []byte) { seen = append(seen, b...) })

	payload := []byte("hello \x1b[32mgreen\x1b[0m\n")
	s.emitData(payload)

	if string(seen) != string(payload) {
		t.Errorf("frontend callback data mutated: %q", seen)
	}
	if string(logged) != string(payload) {
		t.Errorf("outputLogWriter did not receive raw payload: %q", logged)
	}
}

func TestBaseSessionEmitDataNoWriterIsSafe(t *testing.T) {
	s := &baseSession{id: "id", sessionType: "ssh"}
	// No writer installed. Must not panic.
	s.emitData([]byte("hello"))
}

func TestBaseSessionClearingWriterStopsDelivery(t *testing.T) {
	s := &baseSession{id: "id", sessionType: "ssh"}
	var seen []byte
	s.SetOutputLogWriter(func(b []byte) { seen = append(seen, b...) })
	s.emitData([]byte("first "))
	s.SetOutputLogWriter(nil)
	s.emitData([]byte("second"))
	if string(seen) != "first " {
		t.Errorf("post-clear delivery leaked: %q", seen)
	}
}

func TestOutputLoggerConcurrentWrites(t *testing.T) {
	var l OutputLogger
	dir := t.TempDir()
	path, err := l.Enable(dir, "conc", "ssh")
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for g := 0; g < 10; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				l.WriteOutput([]byte("goroutine data\n"))
			}
		}(g)
	}
	wg.Wait()
	l.Disable()
	content, _ := os.ReadFile(path)
	count := strings.Count(string(content), "goroutine data")
	if count != 1000 {
		t.Errorf("expected 1000 lines, got %d", count)
	}
}

func TestLineProcessorBackspace(t *testing.T) {
	// Typical server-echoed typo: 'helllo' then two BS-space-BS erases,
	// then continues to '... world\n'. Users see 'hello world' on
	// screen; the log should match.
	var p lineProcessor
	got := string(p.Feed([]byte("helllo\b \b\b \bo world\n")))
	want := "hello world\n"
	if got != want {
		t.Errorf("Feed = %q, want %q", got, want)
	}
}

func TestLineProcessorCarriageReturn(t *testing.T) {
	// Progress-bar style repaint: multiple \r-overwrites, only the last
	// state should reach the log.
	var p lineProcessor
	got := string(p.Feed([]byte("progress 10%\rprogress 50%\rprogress 100%\n")))
	want := "progress 100%\n"
	if got != want {
		t.Errorf("Feed = %q, want %q", got, want)
	}
}

func TestLineProcessorCRLFPassesThrough(t *testing.T) {
	// Regression: an earlier implementation cleared the line buffer on
	// \r and then flushed an empty line on \n, so servers that end
	// every line with \r\n (nearly all of them) lost every line of
	// output. \r must only move the cursor to column 0; the following
	// \n still flushes the buffered content.
	var p lineProcessor
	got := string(p.Feed([]byte("$ ls\r\ntotal 4\r\nfile.txt\r\n$ ")))
	want := "$ ls\ntotal 4\nfile.txt\n"
	if got != want {
		t.Errorf("Feed = %q, want %q", got, want)
	}
}

func TestLineProcessorFlushOnTimeout(t *testing.T) {
	// A partial line with no newline sits in the buffer, awaiting more
	// bytes. After flushTimeout the next Feed pushes the pending buffer
	// to output so long-running commands (top/less/monitor) don't lose
	// their content to buffering.
	p := lineProcessor{flushTimeout: 1 * time.Millisecond}
	out1 := string(p.Feed([]byte("partial line")))
	if out1 != "" {
		t.Errorf("first Feed emitted %q, expected empty", out1)
	}
	time.Sleep(5 * time.Millisecond)
	// Any subsequent Feed must trigger the timeout flush and emit the
	// pending line even before its terminating \n.
	out2 := string(p.Feed([]byte("!")))
	if !strings.HasPrefix(out2, "partial line") {
		t.Errorf("timeout flush missing: %q", out2)
	}
}

func TestLineProcessorFlushPartialOnDisable(t *testing.T) {
	// Disable happens mid-line (session ended without a trailing \n).
	// FlushPartial should return the pending buffer so the last
	// unterminated line is not silently discarded.
	var p lineProcessor
	_ = p.Feed([]byte("last partial"))
	got := string(p.FlushPartial())
	if got != "last partial" {
		t.Errorf("FlushPartial = %q, want %q", got, "last partial")
	}
	// Second call after empty state is a no-op.
	if x := p.FlushPartial(); len(x) != 0 {
		t.Errorf("second FlushPartial should be empty, got %q", x)
	}
}

func TestOutputLoggerLineBufferedEndToEnd(t *testing.T) {
	// Exercise the whole pipeline: ANSI stripping, backspace erase,
	// and line buffering all working together via WriteOutput.
	var l OutputLogger
	dir := t.TempDir()
	path, err := l.Enable(dir, "e2e", "ssh")
	if err != nil {
		t.Fatal(err)
	}
	// Simulated server echo with a color escape and a typo the user
	// corrected before pressing Enter. The typed sequence is:
	//   $ echo helllo   (typo: 3 l's)
	//   \b\b\b          (erase 'o', 'l', 'l')  → '$ echo hel'
	//   lo world        (retype: 'lo world')   → '$ echo hello world'
	l.WriteOutput([]byte("\x1b[32m$ ec\x1b[0mho helllo\b\b\blo world\n"))
	l.Disable()

	content, _ := os.ReadFile(path)
	if !strings.Contains(string(content), "$ echo hello world") {
		t.Errorf("line-buffered echo missing:\n%s", content)
	}
	if strings.Contains(string(content), "helllo") {
		t.Errorf("uncorrected typo leaked into log:\n%s", content)
	}
	if strings.Contains(string(content), "\x1b") {
		t.Errorf("ESC leaked into log:\n%s", content)
	}
}

// TestOutputLoggerBufferedModeEventualFlush (output_log buffered writes)
// verifies that in the default buffered mode the periodic flush goroutine
// drains bufio into the file within logFlushInterval (1s) even when
// Disable() has not been called. Without the buffered-writes change we
// Sync per WriteOutput, so this would always be instant — the test
// pins the new contract: writes are accumulated and forwarded by the
// ticker, not by per-write Sync.
func TestOutputLoggerBufferedModeEventualFlush(t *testing.T) {
	var l OutputLogger
	dir := t.TempDir()
	path, err := l.Enable(dir, "buf", "ssh")
	if err != nil {
		t.Fatalf("Enable: %v", err)
	}
	defer l.Disable()

	// Force flushTimeout to be much longer than the test wait so the
	// line processor doesn't pre-flush via its own mechanism — we want
	// to exercise the WriteOutput → bufio → flushLoop → file path.
	l.WriteOutput([]byte("buffered line one\n"))

	// Within logFlushInterval the ticker must drain the buffer into
	// the underlying file. Poll briefly so the test stays fast on
	// happy-path while still detecting a missing flush loop.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		content, _ := os.ReadFile(path)
		if strings.Contains(string(content), "buffered line one") {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	content, _ := os.ReadFile(path)
	t.Errorf("ticker flush never landed buffered content:\n%s", content)
}

// TestOutputLoggerSetBufferedTogglesMode checks that SetBuffered(false)
// before Enable opts the logger back into the legacy Sync-per-write
// path. Subsequent writes must be durable on disk immediately.
func TestOutputLoggerSetBufferedTogglesMode(t *testing.T) {
	var l OutputLogger
	l.SetBuffered(false)
	dir := t.TempDir()
	path, err := l.Enable(dir, "sync", "ssh")
	if err != nil {
		t.Fatalf("Enable: %v", err)
	}
	defer l.Disable()

	l.WriteOutput([]byte("legacy sync line\n"))
	// No sleep — the legacy path syncs on each WriteOutput.
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if !strings.Contains(string(content), "legacy sync line") {
		t.Errorf("legacy sync mode did not land write:\n%s", content)
	}
}

func TestOutputLoggerReusableAcrossWriters(t *testing.T) {
	// This mirrors the App-layer scenario where a single OutputLogger
	// stays alive across session disconnect/reconnect: both sessions'
	// output should land in the same file with no gap.
	var l OutputLogger
	dir := t.TempDir()
	path, err := l.Enable(dir, "reconnect", "ssh")
	if err != nil {
		t.Fatal(err)
	}
	// Simulate session A writing a full line, disconnecting, session B
	// writing another. The logger is not touched between them —
	// mirroring the App's SetOutputLogWriter swap.
	l.WriteOutput([]byte("line from session A\n"))
	l.WriteOutput([]byte("line from session B\n"))
	l.Disable()

	content, _ := os.ReadFile(path)
	s := string(content)
	if !strings.Contains(s, "line from session A") {
		t.Errorf("missing session A output: %s", s)
	}
	if !strings.Contains(s, "line from session B") {
		t.Errorf("missing session B output: %s", s)
	}
}
