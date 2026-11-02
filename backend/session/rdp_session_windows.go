//go:build windows

package session

// Windows no-op stubs for the ActiveX/HWND-specific RDPSession methods that
// app_terminal.go / app_remote_desktop.go call. The cross-platform proxy
// implementation lives in rdp_session.go; these HWND/ActiveX methods are a
// no-op here so the binary links under cross-compilation (CGO_ENABLED=0,
// no Windows SDK). A native Windows build may replace these with a real
// ActiveX implementation; functionally RDP embedding is disabled in this
// build but the terminal core is unaffected.

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
