//go:build server

package sync

import (
	"os"
	"path/filepath"
)

// syncMetaDir resolves the directory holding sync metadata (sync-config.json
// and the local snapshot repo clone) for server mode (HarmonyOS c-shared).
// In server mode, os.UserConfigDir() relies on XDG_CONFIG_HOME / HOME which
// are set by the c-shared entry point (cshared.go SetDataDirRoot).
func syncMetaDir() (string, error) {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		// Fallback: use HOME directly
		home := os.Getenv("HOME")
		if home == "" {
			return "", err
		}
		cfgDir = home
	}
	dir := filepath.Join(cfgDir, "uniTerm")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}
