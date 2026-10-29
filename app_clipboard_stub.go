//go:build !darwin

package main

import "fmt"

// setClipboardFiles publishes completed downloads as clipboard file references.
// On non-darwin platforms (linux/windows/android/harmonyos) this is a stub —
// clipboard file transfer is only supported on specific desktop platforms.
// This mirrors the darwin stub in app_darwin.go so that app_remote_desktop.go
// (which has no platform constraint) compiles on every GOOS.
func (a *App) setClipboardFiles(paths []string) error {
	return fmt.Errorf("clipboard file transfer is not supported on this platform")
}