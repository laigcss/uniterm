//go:build server

package main

import (
	"os"
	"strconv"

	"github.com/ys-ll/uniterm/backend/log"
)

// serverModeConfig applies server-mode-specific configuration before the
// Wails application is created. It is only compiled when the binary is built
// with the `server` build tag (CGO-free, headless HTTP server mode), which is
// the HarmonyOS adaptation path D: a static Go binary runs as a subprocess
// and an ArkWeb shell on the device connects to localhost.
//
// This function bridges the application's own AI_OPS_HOST / AI_OPS_PORT
// environment variables onto Wails' built-in WAILS_SERVER_HOST /
// WAILS_SERVER_PORT variables. Wails' server implementation
// (application_server.go) already honours those WAILS_* variables to override
// the ServerOptions set in main.go, so reusing them avoids duplicating the
// parsing/bind logic. We only set a WAILS_* variable when the corresponding
// AI_OPS_* variable is present AND the user has not already set the WAILS_*
// variable directly — that preserves explicit WAILS_* overrides as the
// highest-priority source.
//
// Precedence (highest first):
//  1. WAILS_SERVER_HOST / WAILS_SERVER_PORT (explicit)
//  2. AI_OPS_HOST / AI_OPS_PORT
//  3. ServerOptions in main.go (localhost:9245)
//  4. Wails defaults (localhost:8080)
func serverModeConfig() {
	// Host override.
	if aiHost := os.Getenv("AI_OPS_HOST"); aiHost != "" {
		if existing := os.Getenv("WAILS_SERVER_HOST"); existing == "" {
			if err := os.Setenv("WAILS_SERVER_HOST", aiHost); err != nil {
				log.Writef("server: failed to set WAILS_SERVER_HOST: %v", err)
			}
		}
	}

	// Port override. Validate it parses as a positive integer before
	// propagating, so a malformed AI_OPS_PORT never reaches Wails (where a
	// parse failure silently falls back to the default and hides the typo).
	if aiPort := os.Getenv("AI_OPS_PORT"); aiPort != "" {
		if _, err := strconv.Atoi(aiPort); err != nil {
			log.Writef("server: ignoring invalid AI_OPS_PORT=%q: %v", aiPort, err)
		} else if existing := os.Getenv("WAILS_SERVER_PORT"); existing == "" {
			if err := os.Setenv("WAILS_SERVER_PORT", aiPort); err != nil {
				log.Writef("server: failed to set WAILS_SERVER_PORT: %v", err)
			}
		}
	}
}
