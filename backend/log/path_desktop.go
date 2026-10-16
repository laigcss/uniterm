//go:build !android

package log

import (
	"os"
	"path/filepath"
)

// logPath returns the desktop log location (~/.ai-ops-terminal/ai-ops-terminal.log).
func logPath() string {
	// If LogDir is set (c-shared mode), use it directly
	if LogDir != "" {
		return filepath.Join(LogDir, ".ai-ops-terminal", "ai-ops-terminal.log")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "ai-ops-terminal.log"
	}
	return filepath.Join(home, ".ai-ops-terminal", "ai-ops-terminal.log")
}
