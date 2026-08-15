//go:build !darwin

package main

import (
	"os"
	"os/exec"
	"path/filepath"
)

// relaunchProcess spawns a fresh, detached copy of the current executable.
// On Windows/Linux the binary path from os.Executable() is directly runnable.
func (a *App) relaunchProcess() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe)
	cmd.Dir = filepath.Dir(exe)
	return cmd.Start()
}
