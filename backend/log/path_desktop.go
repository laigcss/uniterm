//go:build !android

package log

import (
	"os"
	"path/filepath"
)

// logPath returns the desktop log location (~/.uniterm/uniterm.log).
func logPath() string {
	// If LogDir is set (c-shared mode), use it directly
	if LogDir != "" {
		return filepath.Join(LogDir, ".uniterm", "uniterm.log")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "uniterm.log"
	}
	return filepath.Join(home, ".uniterm", "uniterm.log")
}
