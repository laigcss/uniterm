//go:build !server

package main

// serverModeConfig is a no-op in desktop (non-server) builds.
// The real implementation lives in server_config.go, compiled only when the
// `server` build tag is set. Keeping the signature identical lets main.go call
// it unconditionally without a build-tag switch at the call site.
func serverModeConfig() {}
