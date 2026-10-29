//go:build !windows

package session

// Stub methods called from app_terminal.go / app_remote_desktop.go on non-Windows
// platforms. The upstream rdp_session.go is a cross-platform proxy implementation;
// these methods are Windows-specific (ActiveX / HWND) and have no-op stubs here.

func (s *RDPSession) ClientAreaScreenRect() (x, y, w, h int) { return }

func (s *RDPSession) SetParentHwnd(_ uintptr) {}

func (s *RDPSession) SetPosition(_, _, _, _ int) {}

func (s *RDPSession) Show() {}

func (s *RDPSession) Hide() {}

func (s *RDPSession) SetFullScreen(_ bool) {}

func (s *RDPSession) SetOnFullScreenExit(_ func()) {}

func (s *RDPSession) SetOnAdaptiveEvent(_ func(event, snapshot string)) {}

func (s *RDPSession) Invalidate() {}

func (s *RDPSession) Snapshot() (string, error) {
	return "", nil
}
