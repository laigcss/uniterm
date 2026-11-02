//go:build windows && !server

package main

import (
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// checkWebView2Runtime checks whether the Microsoft WebView2 Runtime is
// installed and the architecture-matching EmbeddedBrowserWebView.dll exists.
// If not found, it shows a Windows MessageBox with install instructions and
// returns false so the caller can exit before Wails tries to initialise
// WebView2 (which would call os.Exit(1) silently — "double-click and
// nothing happens").
//
// This is critical for Windows 7/8 machines where WebView2 is not
// pre-installed, and for Windows 10 LTTC/slim builds that ship without it.
func checkWebView2Runtime() bool {
	if findWebView2Install() {
		return true
	}

	const title = "uniTerm — 缺少 WebView2 Runtime"
	text := "未检测到 Microsoft WebView2 Runtime。\n\n" +
		"uniTerm 需要 WebView2 Runtime 才能运行界面。\n\n" +
		"请从以下途径之一获取并安装：\n" +
		"  1. 双击同目录下的 install-webview2.bat（自动下载安装）\n" +
		"  2. 从微软官网下载：https://developer.microsoft.com/microsoft-edge/webview2/\n\n" +
		"安装完成后请重新启动 uniTerm。"

	showMessageBox(title, text)
	return false
}

// findWebView2Install checks the Windows registry for an installed WebView2
// Runtime across all 4 channels (stable/beta/dev/canary) and both registry
// hives (HKLM for machine-wide, HKCU for per-user). It mirrors the lookup
// logic in Wails v3's webviewloader package but is self-contained so it can
// be called before application.New().
//
// The WOW64_32KEY flag is used because WebView2 registers itself in the
// 32-bit registry view regardless of the actual runtime architecture.
func findWebView2Install() bool {
	const installKeyPath = `Software\Microsoft\EdgeUpdate\ClientState\`
	channelUuids := []string{
		"{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}", // stable
		"{2CD8A007-E189-409D-A2C8-9AF4EF3C72AA}", // beta
		"{0D50BFEC-CD6A-4F9A-964C-C7416E3ACB10}", // dev
		"{65C35B14-6C1D-4122-AC46-7148CC9D6497}", // canary
	}

	arch := ""
	switch runtime.GOARCH {
	case "arm64":
		arch = "arm64"
	case "amd64":
		arch = "x64"
	case "386":
		arch = "x86"
	default:
		return false
	}

	for _, uuid := range channelUuids {
		keyPath := installKeyPath + uuid
		for _, rootKey := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
			regKey, err := registry.OpenKey(rootKey, keyPath, registry.READ|registry.WOW64_32KEY)
			if err != nil {
				continue
			}
			ebwebview, _, err := regKey.GetStringValue("EBWebView")
			regKey.Close()
			if err != nil || ebwebview == "" {
				continue
			}
			// The registry EBWebView value is a versioned directory path.
			// The actual DLL lives at: <path>/EBWebView/<arch>/EmbeddedBrowserWebView.dll
			dllPath := filepath.Join(ebwebview, "EBWebView", arch, "EmbeddedBrowserWebView.dll")
			if _, err := os.Stat(dllPath); err == nil {
				return true
			}
		}
	}
	return false
}

// showMessageBox displays a Windows MessageBox with an error icon.
// It uses the lazy-loaded user32.dll MessageBoxW API directly, so it works
// even before any GUI/window initialisation.
func showMessageBox(title, text string) {
	user32 := windows.NewLazySystemDLL("user32.dll")
	messageBoxW := user32.NewProc("MessageBoxW")
	titlePtr, _ := windows.UTF16PtrFromString(title)
	textPtr, _ := windows.UTF16PtrFromString(text)
	messageBoxW.Call(
		0, // hWnd = no parent window
		uintptr(unsafe.Pointer(textPtr)),
		uintptr(unsafe.Pointer(titlePtr)),
		0x00000010, // MB_ICONERROR
	)
}
