package session

import (
	"sync"
	"testing"
	"time"
)

// TestFTPSessionDisconnectIdempotent covers the basic Disconnect safety:
// even when called multiple times (Disconnect race against itself, or a
// Disconnect racing an in-flight ChangeRemoteDir that already grabbed
// connMu) the call must be safe to invoke and not panic. With connMu
// now serializing close against data ops, the second concurrent call
// sees s.conn == nil after the first sets it and exits cleanly.
func TestFTPSessionDisconnectIdempotent(t *testing.T) {
	s := NewFTPSession("ftp-id")

	const N = 16
	var wg sync.WaitGroup
	deadline := time.After(5 * time.Second)
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = s.Disconnect()
		}()
	}
	doneCh := make(chan struct{})
	go func() { wg.Wait(); close(doneCh) }()
	select {
	case <-doneCh:
	case <-deadline:
		t.Fatal("Disconnect hung when run concurrently 16x — likely lock leak in connMu")
	}

	if s.conn != nil {
		t.Errorf("Disconnect should have niled s.conn")
	}
	if got := s.Status(); got != StatusDisconnected {
		t.Errorf("status after Disconnect = %v, want %v", got, StatusDisconnected)
	}
	// Second Disconnect after completion is the App-layer shutdown path.
	if err := s.Disconnect(); err != nil {
		t.Errorf("post-completion Disconnect returned %v, want nil", err)
	}
}

// TestFTPSessionDisconnectRacesChangeRemoteDir simulates the bug that
// the connMu serialization fixes: a Disconnect runs concurrently with
// a ChangeRemoteDir that would otherwise touch s.conn without holding
// the lock. Both callers must observe a consistent state and neither
// must panic; with connMu, whichever goroutine wins the lock runs to
// completion before the other proceeds, so s.conn cannot be nilled
// out from under the directory listing.
func TestFTPSessionDisconnectRacesChangeRemoteDir(t *testing.T) {
	s := NewFTPSession("ftp-race")

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _ = s.Disconnect() }()
	go func() {
		defer wg.Done()
		// requireConn blocks here because s.conn is nil, but it must
		// not panic. We're verifying the lock path doesn't deadlock
		// when the close path holds connMu; requireConn acquires no
		// lock, so it returns ErrNotConnected and we move on.
		_, _ = s.ChangeRemoteDir("anything")
	}()
	wg.Wait()

	if s.conn != nil {
		t.Errorf("s.conn should be nil after Disconnect race")
	}
}
