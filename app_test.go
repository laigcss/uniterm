package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestApp_StartupError_CapturesSingleError verifies that a single error
// sent during startup() surfaces through StartupError() after
// drainStartupErr() has run. The frontend calls StartupError() on demand
// after receiving the "app:startup-error" event to render a banner.
func TestApp_StartupError_CapturesSingleError(t *testing.T) {
	a := NewApp("")
	a.sendStartupErr(errors.New("connection store: init failed"))

	if got := a.StartupError(); got != "" {
		t.Fatalf("StartupError() before drain = %q, want empty", got)
	}

	a.drainStartupErr()
	got := a.StartupError()
	want := "connection store: init failed"
	if got != want {
		t.Fatalf("StartupError() = %q, want %q", got, want)
	}
}

// TestApp_StartupError_JoinsMultipleErrors verifies the errors.Join
// behaviour: multiple sendStartupErr calls during startup() produce a
// single newline-joined string readable by the frontend.
func TestApp_StartupError_JoinsMultipleErrors(t *testing.T) {
	a := NewApp("")
	a.sendStartupErr(errors.New("connection store: read failed"))
	a.sendStartupErr(errors.New("settings store: write failed"))
	a.drainStartupErr()

	got := a.StartupError()
	for _, want := range []string{"connection store: read failed", "settings store: write failed"} {
		if !strings.Contains(got, want) {
			t.Errorf("StartupError() = %q, missing %q", got, want)
		}
	}
	if !strings.Contains(got, "\n") {
		t.Errorf("StartupError() = %q, expected newline-separated entries", got)
	}
}

// TestApp_StartupError_NilOnClean verifies StartupError() returns ""
// when no init failures occurred. The frontend uses the empty string to
// decide whether to render the banner.
func TestApp_StartupError_NilOnClean(t *testing.T) {
	a := NewApp("")
	a.drainStartupErr()
	if got := a.StartupError(); got != "" {
		t.Fatalf("StartupError() with no errors = %q, want empty", got)
	}
}

// TestApp_SendStartupErr_NilIsNoop confirms nil errors do not enqueue.
// Defensive against a future caller passing nil from an error chain.
func TestApp_SendStartupErr_NilIsNoop(t *testing.T) {
	a := NewApp("")
	a.sendStartupErr(nil)
	a.drainStartupErr()
	if got := a.StartupError(); got != "" {
		t.Fatalf("StartupError() after nil send = %q, want empty", got)
	}
}

// TestApp_SendStartupErr_OverflowDrops verifies that when the buffered
// channel (size 16) overflows, sendStartupErr drops the extra error
// instead of blocking. The send runs on the startup goroutine and must
// remain non-blocking; the log line is the last-resort record.
func TestApp_SendStartupErr_OverflowDrops(t *testing.T) {
	a := NewApp("")
	for i := 0; i < 32; i++ {
		a.sendStartupErr(fmt.Errorf("store: %d", i))
	}
	a.drainStartupErr()
	got := a.StartupError()
	if got == "" {
		t.Fatal("StartupError() empty after 32 sends, want at least one entry")
	}
	if strings.Count(got, "\n") >= 32 {
		t.Errorf("StartupError() kept all 32 sends, expected some drops under cap=16")
	}
}

// TestApp_StartupErr_ConcurrentSendSafe sends from many goroutines and
// confirms drainStartupErr() collects everything safely. Catches data
// races in the channel/snapshot interaction under -race.
func TestApp_StartupErr_ConcurrentSendSafe(t *testing.T) {
	a := NewApp("")
	const N = 32
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func(i int) {
			defer wg.Done()
			a.sendStartupErr(fmt.Errorf("concurrent: %d", i))
		}(i)
	}
	wg.Wait()
	a.drainStartupErr()
	got := a.StartupError()
	if got == "" {
		t.Fatal("StartupError() empty after concurrent sends")
	}
}

// TestApp_PanelLogTitle_FallbackAndLookup exercises panelLogTitle: with
// no registered session the helper returns a synthetic fallback rather
// than crashing on a nil sessionManager, and with a registered session
// it returns non-empty name/protocol under panelLogMu. Regression
// coverage for the helper that PR-15's log-file work depends on.
func TestApp_PanelLogTitle_FallbackAndLookup(t *testing.T) {
	a := NewApp("")

	// No registration — fallback path.
	name, protocol := a.panelLogTitle("panel-X")
	if name == "" {
		t.Errorf("panelLogTitle empty name for unregistered panel")
	}
	if protocol == "" {
		t.Errorf("panelLogTitle empty protocol for unregistered panel")
	}

	// Registered session but no live sessionManager entry — helper
	// falls through to the synthetic name (no panic).
	a.RegisterSessionForPanel("sess-y", "panel-X")
	start := time.Now()
	for i := 0; i < 1000; i++ {
		name, protocol = a.panelLogTitle("panel-X")
	}
	if elapsed := time.Since(start); elapsed > 50*time.Millisecond {
		t.Errorf("1000 panelLogTitle calls took %v, expected < 50ms", elapsed)
	}
	if name == "" || protocol == "" {
		t.Errorf("panelLogTitle returned empty name=%q protocol=%q", name, protocol)
	}
}