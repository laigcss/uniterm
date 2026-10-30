package main

import (
	"context"
	"time"
)

// MCPReconnectClient forces a reload of external MCP server connections.
// This is a local-only addition (PR #1287); all other MCP client methods
// live in app_ai.go (upstream). Upstream's Manager.Reload reconnects all
// clients from the store; we use it as the closest equivalent to per-server
// reconnect.
func (a *App) MCPReconnectClient(serverName string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	a.ensureMCPClient().Reload(ctx)
	return nil
}
