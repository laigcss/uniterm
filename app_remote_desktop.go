package main

import (
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/ys-ll/uniterm/backend/session"
	"golang.org/x/text/encoding/simplifiedchinese"
)

// EncodeClipboardText encodes a UTF-8 string to the specified encoding for
// VNC ClientCutText messages. TightVNC on Chinese Windows uses the system
// ANSI code page (GBK/936) to decode clipboard bytes, not UTF-8 or Latin-1.
// Returns base64-encoded bytes for easy transport to the frontend.
func (a *App) EncodeClipboardText(text string, encoding string) (string, error) {
	switch strings.ToLower(encoding) {
	case "utf-8", "utf8", "":
		return base64.StdEncoding.EncodeToString([]byte(text)), nil
	case "gbk", "gb2312", "gb18030":
		encoder := simplifiedchinese.GBK.NewEncoder()
		encoded, err := encoder.Bytes([]byte(text))
		if err != nil {
			return "", fmt.Errorf("gbk encode: %w", err)
		}
		return base64.StdEncoding.EncodeToString(encoded), nil
	case "latin-1", "latin1", "iso-8859-1":
		result := make([]byte, 0, len(text))
		for _, r := range text {
			if r > 0xFF {
				result = append(result, '?')
			} else {
				result = append(result, byte(r))
			}
		}
		return base64.StdEncoding.EncodeToString(result), nil
	default:
		return base64.StdEncoding.EncodeToString([]byte(text)), nil
	}
}

func (a *App) RDPSetPosition(sessionID string, x, y, w, h int) error {
	if a.sessionManager == nil {
		return fmt.Errorf("session manager not initialized")
	}
	s, ok := a.sessionManager.Get(sessionID)
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	rdp, ok := s.(*session.RDPSession)
	if !ok {
		return fmt.Errorf("session is not RDP")
	}
	rdp.SetPosition(x, y, w, h)
	return nil
}

func (a *App) RDPShow(sessionID string) error {
	if a.sessionManager == nil {
		return fmt.Errorf("session manager not initialized")
	}
	s, ok := a.sessionManager.Get(sessionID)
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	rdp, ok := s.(*session.RDPSession)
	if !ok {
		return fmt.Errorf("session is not RDP")
	}
	rdp.Show()
	return nil
}

// RDPSetFullScreen toggles the ActiveX control's built-in full-screen mode.
func (a *App) RDPSetFullScreen(sessionID string, full bool) error {
	if a.sessionManager == nil {
		return fmt.Errorf("session manager not initialized")
	}
	s, ok := a.sessionManager.Get(sessionID)
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	rdp, ok := s.(*session.RDPSession)
	if !ok {
		return fmt.Errorf("session is not RDP")
	}
	rdp.SetFullScreen(full)
	return nil
}

func (a *App) RDPHide(sessionID string) error {
	if a.sessionManager == nil {
		return fmt.Errorf("session manager not initialized")
	}
	s, ok := a.sessionManager.Get(sessionID)
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	rdp, ok := s.(*session.RDPSession)
	if !ok {
		return fmt.Errorf("session is not RDP")
	}
	rdp.Hide()
	return nil
}

// RDPSnapshot captures the RDP session's current frame as a base64-encoded PNG.
// The frontend shows it as a frozen background in .rdp-area while the RDP window
// is hidden under an overlay (menu/dialog), so the area shows a snapshot instead
// of a black placeholder.
func (a *App) RDPSnapshot(sessionID string) (string, error) {
	if a.sessionManager == nil {
		return "", fmt.Errorf("session manager not initialized")
	}
	s, ok := a.sessionManager.Get(sessionID)
	if !ok {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}
	rdp, ok := s.(*session.RDPSession)
	if !ok {
		return "", fmt.Errorf("session is not RDP")
	}
	return rdp.Snapshot()
}

func (a *App) RDPInvalidate(sessionID string) error {
	if a.sessionManager == nil {
		return fmt.Errorf("session manager not initialized")
	}
	s, ok := a.sessionManager.Get(sessionID)
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	rdp, ok := s.(*session.RDPSession)
	if !ok {
		return fmt.Errorf("session is not RDP")
	}
	rdp.Invalidate()
	return nil
}

// X11DesktopConnect starts an x11-desktop session: looks up the saved
// connection config (which carries its own SSH credentials), opens an
// SSH connection with X11 forwarding, and runs the chosen desktop
// command on the remote host. connectionID and sessionID are distinct
// UUIDs (the connection is the user's saved record; the session is the
// live runtime object created via CreateSession).
func (a *App) X11DesktopConnect(connectionID string, sessionID string) error {
	if a.connectionStore == nil || a.sessionManager == nil {
		return fmt.Errorf("connection store or session manager not initialized")
	}
	data, err := a.connectionStore.Load()
	if err != nil {
		return err
	}
	var cfg *session.ConnectionConfig
	for i := range data.Connections {
		if data.Connections[i].ID == connectionID {
			cfg = &data.Connections[i]
			break
		}
	}
	if cfg == nil {
		return fmt.Errorf("connection not found: %s", connectionID)
	}
	if cfg.Type != "x11-desktop" {
		return fmt.Errorf("connection %s is not an x11-desktop", connectionID)
	}

	// Resolve an identity reference into a concrete password/key config
	// before handing the connection to the X11 dialer.
	if cfg.AuthType == "identity" {
		m, err := a.materializeIdentity(*cfg)
		if err != nil {
			return err
		}
		cfg = &m
	}

	sess, ok := a.sessionManager.Get(sessionID)
	if !ok {
		return fmt.Errorf("session not found: %s", sessionID)
	}
	x11Sess, ok := sess.(*session.X11DesktopSession)
	if !ok {
		return fmt.Errorf("session %s is not x11-desktop", sessionID)
	}
	if err := x11Sess.ConnectX11Desktop(*cfg); err != nil {
		return err
	}
	return nil
}
