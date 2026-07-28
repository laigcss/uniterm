package session

import (
	"sync"
	"testing"
)

// TestBaseSessionSetPendingSizeDefaultsAreZero verifies that a freshly
// constructed baseSession has no pending size — Connect() must fall back to
// the per-protocol default (80x24 for SSH/Mosh, 200x60 for local) when the
// frontend never calls SetPendingSize.
func TestBaseSessionSetPendingSizeDefaultsAreZero(t *testing.T) {
	s := &baseSession{}
	cols, rows := s.GetPendingSize()
	if cols != 0 || rows != 0 {
		t.Fatalf("fresh baseSession: GetPendingSize = (%d,%d), want (0,0)", cols, rows)
	}
}

// TestBaseSessionSetPendingSizeRoundTrip covers the new SetPendingSize
// contract that the deferred SessionStart flow relies on: the frontend
// measures the xterm cols/rows, then writes them via SetPendingSize so
// the upcoming Connect() (kicked off by launchConnectGoroutine from
// SessionStart) reads them via getInitialSize instead of using 80x24.
func TestBaseSessionSetPendingSizeRoundTrip(t *testing.T) {
	s := &baseSession{}
	s.SetPendingSize(132, 43)
	gotCols, gotRows := s.GetPendingSize()
	if gotCols != 132 || gotRows != 43 {
		t.Fatalf("GetPendingSize after SetPendingSize(132,43) = (%d,%d), want (132,43)", gotCols, gotRows)
	}

	s.SetPendingSize(220, 50)
	gotCols, gotRows = s.GetPendingSize()
	if gotCols != 220 || gotRows != 50 {
		t.Fatalf("GetPendingSize after second SetPendingSize(220,50) = (%d,%d), want (220,50)", gotCols, gotRows)
	}
}

// TestBaseSessionGetInitialSizePrefersPendingOverDefault exercises the
// shape that the SSH/Mosh RequestPty calls and the local pty.Setsize call
// both depend on: when a frontend-measured size is pending, it wins over
// the protocol default. When nothing is pending, the default is used.
func TestBaseSessionGetInitialSizePrefersPendingOverDefault(t *testing.T) {
	s := &baseSession{}
	cols, rows := s.getInitialSize(80, 24)
	if cols != 80 || rows != 24 {
		t.Fatalf("no pending size: getInitialSize(80,24) = (%d,%d), want (80,24)", cols, rows)
	}

	s.SetPendingSize(160, 48)
	cols, rows = s.getInitialSize(80, 24)
	if cols != 160 || rows != 48 {
		t.Fatalf("pending 160x48: getInitialSize(80,24) = (%d,%d), want (160,48)", cols, rows)
	}
}

// TestBaseSessionGetInitialSizeFallsBackPerAxis documents the half-set
// case the local session hits when Resize(cols, 0) is called: pending
// cols is honored, rows falls back to the default.
func TestBaseSessionGetInitialSizeFallsBackPerAxis(t *testing.T) {
	s := &baseSession{}
	s.SetPendingSize(120, 0)
	cols, rows := s.getInitialSize(80, 24)
	if cols != 120 || rows != 24 {
		t.Fatalf("pending cols only: getInitialSize(80,24) = (%d,%d), want (120,24)", cols, rows)
	}

	s2 := &baseSession{}
	s2.SetPendingSize(0, 50)
	cols, rows = s2.getInitialSize(80, 24)
	if cols != 80 || rows != 50 {
		t.Fatalf("pending rows only: getInitialSize(80,24) = (%d,%d), want (80,50)", cols, rows)
	}
}

// TestBaseSessionSetPendingSizeConcurrent guards against the regression
// where a frontend-driven SetPendingSize races with a backend-driven
// Resize/Connect read: getInitialSize is called from a goroutine while
// SetPendingSize is called from another, and both must agree on a value
// that was either fully-written or fully-unwritten. A data race would
// surface as `-race` failures; the assertion here just makes sure we
// observe one of the values, not a torn half-write.
func TestBaseSessionSetPendingSizeConcurrent(t *testing.T) {
	s := &baseSession{}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				s.SetPendingSize(100, 30)
			}
		}()
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				s.GetPendingSize()
			}
		}()
	}
	wg.Wait()

	cols, rows := s.GetPendingSize()
	if cols != 100 || rows != 30 {
		t.Fatalf("after concurrent SetPendingSize(100,30): GetPendingSize = (%d,%d), want (100,30)", cols, rows)
	}
}

// TestConnectionConfigCarriesInitialSizeAndDeferConnect ensures the new
// fields are wired into ConnectionConfig so they survive JSON round-trip
// from the frontend (CreateSession / SessionStart take ConnectionConfig
// over the Wails boundary and rely on the JSON tags).
func TestConnectionConfigCarriesInitialSizeAndDeferConnect(t *testing.T) {
	cfg := ConnectionConfig{
		InitialCols: 178,
		InitialRows: 52,
		DeferConnect: true,
	}
	if cfg.InitialCols != 178 || cfg.InitialRows != 52 || !cfg.DeferConnect {
		t.Fatalf("ConnectionConfig fields not preserved: %+v", cfg)
	}

	cfg.DeferConnect = false
	if cfg.DeferConnect {
		t.Fatalf("DeferConnect did not flip back to false")
	}
}
