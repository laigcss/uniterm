//go:build darwin

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// relaunchProcess spawns a fresh copy of the app. On macOS the executable lives
// inside a .app bundle (.../Foo.app/Contents/MacOS/Foo); re-exec'ing that path
// bypasses LaunchServices, so walk up to the bundle and use `open -n` instead.
// Falls back to a raw re-exec when not running from a bundle (e.g. `wails dev`).
func (a *App) relaunchProcess() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	// .../Foo.app/Contents/MacOS/Foo -> .../Foo.app
	bundle := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	if strings.HasSuffix(bundle, ".app") {
		return exec.Command("open", "-n", bundle).Start()
	}
	return exec.Command(exe).Start()
}
