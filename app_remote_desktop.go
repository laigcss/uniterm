package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/cloudsoda/go-smb2"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/ys-ll/uniterm/backend/platform"
	"github.com/ys-ll/uniterm/backend/session"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/korean"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

func (a *App) EncodeVNCClipboardText(text, charset string) (string, error) {
	var codec encoding.Encoding
	switch charset {
	case "gbk", "gb2312":
		codec = simplifiedchinese.GBK
	case "gb18030":
		codec = simplifiedchinese.GB18030
	case "big5":
		codec = traditionalchinese.Big5
	case "shift-jis":
		codec = japanese.ShiftJIS
	case "euc-jp":
		codec = japanese.EUCJP
	case "euc-kr":
		codec = korean.EUCKR
	default:
		return "", fmt.Errorf("unsupported VNC clipboard encoding: %q", charset)
	}
	data, err := codec.NewEncoder().Bytes([]byte(text))
	if err != nil {
		return "", fmt.Errorf("encode VNC clipboard as %s: %w", charset, err)
	}
	return base64.StdEncoding.EncodeToString(data), nil
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

type ClipboardFileInfo struct {
	ID string `json:"id,omitempty"`
	// Basename shown to the remote (the full path never leaves the machine).
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	LastModified int64  `json:"lastModified"` // unix milliseconds
}

type clipboardTransfer struct {
	dir      string
	files    []ClipboardFileInfo
	paths    []string
	received []int64
}

var clipboardTransfers = struct {
	sync.Mutex
	items map[string]*clipboardTransfer
}{items: make(map[string]*clipboardTransfer)}

// ClipboardBeginFileTransfer stages remote clipboard files in a private temp
// directory. The renderer only receives an opaque token, never a writable path.
func (a *App) ClipboardBeginFileTransfer(files []ClipboardFileInfo) (string, error) {
	if len(files) == 0 || len(files) > 10000 {
		return "", fmt.Errorf("invalid clipboard file count")
	}
	seen := make(map[string]bool, len(files))
	for _, file := range files {
		key := strings.ToLower(file.Name)
		if file.Size < 0 || file.Size > 9007199254740991 || file.Name == "." || file.Name == ".." ||
			!filepath.IsLocal(file.Name) || strings.ContainsAny(file.Name, "/\\:\x00") || seen[key] {
			return "", fmt.Errorf("invalid or duplicate clipboard file name %q", file.Name)
		}
		seen[key] = true
	}
	dir, err := os.MkdirTemp("", "uniterm-clipboard-")
	if err != nil {
		return "", err
	}
	transfer := &clipboardTransfer{dir: dir, files: files, received: make([]int64, len(files))}
	for _, file := range files {
		path := filepath.Join(dir, file.Name)
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			os.RemoveAll(dir)
			return "", err
		}
		f.Close()
		transfer.paths = append(transfer.paths, path)
	}
	id := uuid.NewString()
	clipboardTransfers.Lock()
	clipboardTransfers.items[id] = transfer
	clipboardTransfers.Unlock()
	return id, nil
}

func (a *App) ClipboardWriteFileChunk(id string, index int, offset int64, encoded string) error {
	if len(encoded) > base64.StdEncoding.EncodedLen(8*1024*1024) {
		return fmt.Errorf("clipboard chunk too large")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return err
	}
	clipboardTransfers.Lock()
	defer clipboardTransfers.Unlock()
	t := clipboardTransfers.items[id]
	if t == nil || index < 0 || index >= len(t.files) {
		return fmt.Errorf("unknown clipboard transfer or file")
	}
	if offset != t.received[index] || int64(len(data)) > t.files[index].Size-offset {
		return fmt.Errorf("invalid clipboard chunk offset or size")
	}
	f, err := os.OpenFile(t.paths[index], os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	n, err := f.WriteAt(data, offset)
	t.received[index] += int64(n)
	return err
}

func (a *App) ClipboardFinishFileTransfer(id string) error {
	return finishClipboardTransfer(id, a.setClipboardFiles)
}

func finishClipboardTransfer(id string, publish func([]string) error) error {
	clipboardTransfers.Lock()
	defer clipboardTransfers.Unlock()
	t := clipboardTransfers.items[id]
	if t == nil {
		return fmt.Errorf("unknown clipboard transfer")
	}
	for i, file := range t.files {
		if t.received[i] != file.Size {
			return fmt.Errorf("clipboard file %q is incomplete", file.Name)
		}
		if file.LastModified > 0 {
			mtime := time.UnixMilli(file.LastModified)
			if err := os.Chtimes(t.paths[i], mtime, mtime); err != nil {
				return err
			}
		}
	}
	if err := publish(t.paths); err != nil {
		return err
	}
	// Keep the completed files: Explorer may paste them after disconnection.
	// Their enclosing directory lives in the operating system's temp directory.
	delete(clipboardTransfers.items, id)
	return nil
}

func (a *App) ClipboardAbortFileTransfer(id string) error {
	clipboardTransfers.Lock()
	defer clipboardTransfers.Unlock()
	if t := clipboardTransfers.items[id]; t != nil {
		delete(clipboardTransfers.items, id)
		return os.RemoveAll(t.dir)
	}
	return nil
}

// SetRDPKeyboardCapture is enabled only while the connected WASM desktop has
// focus. The capture token also identifies events queued before a focus change.
// SetVNCKeyboardCapture and SetSPICEKeyboardCapture take a fullscreen flag:
// in fullscreen the browser consumes Escape before the page sees it, so the
// native hook must swallow Escape too and forward it to the remote desktop.
func (a *App) SetRDPKeyboardCapture(sessionID, captureID string, enabled bool) (bool, error) {
	return a.setDesktopKeyboardCapture(sessionID, captureID, enabled, "rdp", false)
}

func (a *App) SetVNCKeyboardCapture(sessionID, captureID string, enabled, fullscreen bool) (bool, error) {
	return a.setDesktopKeyboardCapture(sessionID, captureID, enabled, "vnc", fullscreen)
}

func (a *App) SetSPICEKeyboardCapture(sessionID, captureID string, enabled, fullscreen bool) (bool, error) {
	return a.setDesktopKeyboardCapture(sessionID, captureID, enabled, "spice", fullscreen)
}

func (a *App) setDesktopKeyboardCapture(sessionID, captureID string, enabled bool, sessionType string, fullscreen bool) (bool, error) {
	if !enabled {
		a.rdpKeyboardMu.Lock()
		capture := a.rdpKeyboard
		a.rdpKeyboardMu.Unlock()
		if capture != nil {
			capture.Release(captureID)
		}
		return false, nil
	}
	if captureID == "" || a.sessionManager == nil {
		return false, fmt.Errorf("%s session unavailable", strings.ToUpper(sessionType))
	}
	s, ok := a.sessionManager.Get(sessionID)
	if !ok {
		return false, fmt.Errorf("%s session unavailable", strings.ToUpper(sessionType))
	}
	if s.Type() != sessionType || s.Status() != session.StatusConnected {
		return false, fmt.Errorf("%s session is not connected", strings.ToUpper(sessionType))
	}
	a.rdpKeyboardMu.Lock()
	if a.rdpKeyboard == nil {
		capture, err := platform.NewRDPKeyboardCapture(func(event platform.RDPKeyEvent) {
			if a.app != nil {
				a.app.Event.Emit("remote-desktop:keyboard", event)
			}
		}, application.InvokeSync)
		if err != nil {
			a.rdpKeyboardMu.Unlock()
			return false, err
		}
		a.rdpKeyboard = capture
	}
	capture := a.rdpKeyboard
	a.rdpKeyboardMu.Unlock()
	hwnd := a.mainHwnd
	if hwnd == 0 {
		hwnd = a.findMainWindow()
	}
	if sessionType == "vnc" || sessionType == "spice" {
		return capture.SetShortcutCapture(captureID, hwnd, fullscreen), nil
	}
	return capture.SetCapture(captureID, hwnd), nil
}

func (a *App) closeRDPKeyboard() {
	a.rdpKeyboardMu.Lock()
	capture := a.rdpKeyboard
	a.rdpKeyboardMu.Unlock()
	if capture != nil {
		capture.Close()
	}
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
