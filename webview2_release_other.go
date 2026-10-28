//go:build !windows

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// releaseWebView2 is a no-op on non-Windows platforms. On Windows the real
// implementation (webview2_release.go) disposes the WebView2 COM controller so
// the browser subprocess terminates before ExitProcess; elsewhere there is no
// WebView2 to release.
func releaseWebView2(window *application.WebviewWindow) {}
