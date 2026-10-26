package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"os"
	"path"
	"strings"
	"time"

	"github.com/cloudsoda/go-smb2"
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

// UploadFileViaSMB copies a local file to the remote Windows machine via SMB
// (forward connection Mac → Windows:445).  SMB natively handles binary files
// so Word docs, images, archives all work without encoding issues.  The file
// is placed in the user's Downloads folder and the Windows path is returned
// (suitable for Win+R).
func (a *App) UploadFileViaSMB(filepath, host, username, password string) (string, error) {
	addr := net.JoinHostPort(host, "445")
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return "", fmt.Errorf("smb dial: %w", err)
	}
	defer conn.Close()

	d := &smb2.Dialer{
		Initiator: &smb2.NTLMInitiator{
			User:     username,
			Password: password,
		},
	}
	smbConn, err := d.DialConn(context.Background(), conn, addr)
	if err != nil {
		// Friendly hint for the common case: Windows rejects blank-password
		// network logons by default security policy.
		if strings.Contains(err.Error(), "auth") || strings.Contains(err.Error(), "Authentication") {
			return "", fmt.Errorf("SMB 认证失败。Windows 空密码不支持网络登录，请在远程桌面执行: net user %s <密码> 设置密码", username)
		}
		return "", fmt.Errorf("smb auth: %w", err)
	}
	defer smbConn.Logoff()

	share, err := smbConn.Mount("C$")
	if err != nil {
		return "", fmt.Errorf("smb mount C$: %w", err)
	}
	defer share.Umount()

	data, err := os.ReadFile(filepath)
	if err != nil {
		return "", fmt.Errorf("read local file: %w", err)
	}
	filename := path.Base(filepath)

	// Ensure Downloads directory exists (ignore errors — dirs may already exist)
	share.Mkdir("Users", 0755)
	share.Mkdir("Users/"+username, 0755)
	share.Mkdir("Users/"+username+"/Downloads", 0755)

	remotePath := "Users/" + username + "/Downloads/" + filename
	f, err := share.Create(remotePath)
	if err != nil {
		return "", fmt.Errorf("smb create file: %w", err)
	}

	// Write in 64 KB chunks, emitting a progress event after each chunk so
	// the frontend can show a percentage.
	const chunkSize = 64 * 1024
	total := len(data)
	written := 0
	for written < total {
		end := written + chunkSize
		if end > total {
			end = total
		}
		n, werr := f.Write(data[written:end])
		if werr != nil {
			f.Close()
			return "", fmt.Errorf("smb write: %w", werr)
		}
		written += n
		percent := 0
		if total > 0 {
			percent = written * 100 / total
		}
		a.emit("vnc:smb-progress", map[string]any{
			"filename": filename,
			"written":  written,
			"total":    total,
			"percent":  percent,
		})
	}
	f.Close()

	winPath := fmt.Sprintf(`C:\Users\%s\Downloads\%s`, username, filename)
	return winPath, nil
}
