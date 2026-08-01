package session

import (
	"sync"
	"testing"
)

// fakeSession is a minimal Session used to exercise SessionManager
// lifecycle / cleanup logic without spinning up a real protocol.
//
// Status / Type / Title are settable from the test so the manager can
// be made to observe a session in any state. Connect / Disconnect are
// no-ops; IsConnected mirrors the last status (true iff connected).
type fakeSession struct {
	id     string
	typ    string
	title  string
	status SessionStatus

	mu          sync.Mutex
	disconnects int
}

func (f *fakeSession) ID() string                    { return f.id }
func (f *fakeSession) Type() string                  { return f.typ }
func (f *fakeSession) Title() string                 { return f.title }
func (f *fakeSession) Status() SessionStatus         { return f.status }
func (f *fakeSession) setStatus(s SessionStatus)      { f.status = s }
func (f *fakeSession) Connect(ConnectionConfig) error { f.setStatus(StatusConnected); return nil }
func (f *fakeSession) Disconnect() error {
	f.mu.Lock()
	f.disconnects++
	f.mu.Unlock()
	f.setStatus(StatusDisconnected)
	return nil
}
func (f *fakeSession) IsConnected() bool          { return f.status == StatusConnected }
func (f *fakeSession) Resize(cols, rows int) error { return nil }
func (f *fakeSession) SetPendingSize(cols, rows int) {}
func (f *fakeSession) Write(data []byte) error     { return nil }
func (f *fakeSession) SetOnDataCallback(func([]byte))          {}
func (f *fakeSession) SetOnBinaryCallback(func([]byte))        {}
func (f *fakeSession) SetOnStatusChangeCallback(func(SessionStatus)) {}
func (f *fakeSession) SetZmodemMode(bool)         {}
func (f *fakeSession) IsZmodemMode() bool          { return false }

// TestSessionManagerInitEvictsDeadSessions (F-018) verifies that the
// manager's Init() purges sessions left over from a previous run in
// a terminal (disconnected / error) state, but keeps sessions that
// are still alive (connecting / connected). The point is to avoid
// unbounded growth of the in-memory session map across app restarts
// when a session was abandoned mid-run.
func TestSessionManagerInitEvictsDeadSessions(t *testing.T) {
	sm := NewSessionManager()

	deadDisc := &fakeSession{id: "dead-disc", typ: "ssh", title: "old1", status: StatusDisconnected}
	deadErr := &fakeSession{id: "dead-err", typ: "ssh", title: "old2", status: StatusError}
	aliveConn := &fakeSession{id: "alive-conn", typ: "ssh", title: "live1", status: StatusConnected}
	aliveConnecting := &fakeSession{id: "alive-conn2", typ: "ssh", title: "live2", status: StatusConnecting}

	sm.Add(deadDisc)
	sm.Add(deadErr)
	sm.Add(aliveConn)
	sm.Add(aliveConnecting)

	sm.Init()

	if _, ok := sm.Get("dead-disc"); ok {
		t.Errorf("Init() should have evicted dead-disc (StatusDisconnected)")
	}
	if _, ok := sm.Get("dead-err"); ok {
		t.Errorf("Init() should have evicted dead-err (StatusError)")
	}
	if _, ok := sm.Get("alive-conn"); !ok {
		t.Errorf("Init() should have kept alive-conn (StatusConnected)")
	}
	if _, ok := sm.Get("alive-conn2"); !ok {
		t.Errorf("Init() should have kept alive-conn2 (StatusConnecting)")
	}

	// Init must not call Disconnect on the live sessions — only
	// force-evict the dead ones from the map.
	if aliveConn.disconnects != 0 {
		t.Errorf("Init() invoked Disconnect on a live session: %d", aliveConn.disconnects)
	}
	if aliveConnecting.disconnects != 0 {
		t.Errorf("Init() invoked Disconnect on a connecting session: %d", aliveConnecting.disconnects)
	}
}

// TestSessionManagerCloseDisconnectsSession verifies the basic Close
// path: removes the session from the map and calls Disconnect once.
func TestSessionManagerCloseDisconnectsSession(t *testing.T) {
	sm := NewSessionManager()
	s := &fakeSession{id: "c", typ: "ssh", status: StatusConnected}
	sm.Add(s)

	if err := sm.Close("c"); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, ok := sm.Get("c"); ok {
		t.Errorf("Close should have removed the session from the map")
	}
	if s.disconnects != 1 {
		t.Errorf("Close should have called Disconnect exactly once, got %d", s.disconnects)
	}
}

// TestSessionManagerCloseUnknownSession makes sure closing a session
// that isn't in the map returns an error rather than panicking.
func TestSessionManagerCloseUnknownSession(t *testing.T) {
	sm := NewSessionManager()
	if err := sm.Close("nope"); err == nil {
		t.Errorf("Close on unknown id should error, got nil")
	}
}

// TestSessionManagerCloseAllDisconnectsEveryone verifies that CloseAll
// drives every session through Disconnect, even ones that error out,
// and clears the map.
func TestSessionManagerCloseAllDisconnectsEveryone(t *testing.T) {
	sm := NewSessionManager()
	s1 := &fakeSession{id: "1", status: StatusConnected}
	s2 := &fakeSession{id: "2", status: StatusConnected}
	s3 := &fakeSession{id: "3", status: StatusConnected}
	sm.Add(s1)
	sm.Add(s2)
	sm.Add(s3)

	sm.CloseAll()

	if got := len(sm.List()); got != 0 {
		t.Errorf("CloseAll should empty the map, got %d entries", got)
	}
	if s1.disconnects != 1 || s2.disconnects != 1 || s3.disconnects != 1 {
		t.Errorf("CloseAll should disconnect each session once: 1=%d 2=%d 3=%d",
			s1.disconnects, s2.disconnects, s3.disconnects)
	}
}
