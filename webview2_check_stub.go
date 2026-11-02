//go:build !windows || server

package main

// checkWebView2Runtime is a no-op on non-Windows platforms.
// WebView2 Runtime is only required on Windows.
func checkWebView2Runtime() bool {
	return true
}
