package main

import (
	"fmt"

	"github.com/laigcss/ai-ops-terminal/backend/mcp"
)

// MCPStartServer launches an MCP server as a child process and registers it
// under `name`. A server with the same name is stopped first so the caller
// can re-connect. The frontend calls this from the MCP Servers settings card.
func (a *App) MCPStartServer(name, command string, args []string, env map[string]string) error {
	if a.mcpManager == nil {
		return fmt.Errorf("MCP manager not initialized")
	}
	return a.mcpManager.StartServer(name, command, args, env)
}

// MCPStopServer terminates the named MCP server and removes it from the
// registry. Idempotent — returns nil for unknown names.
func (a *App) MCPStopServer(name string) error {
	if a.mcpManager == nil {
		return fmt.Errorf("MCP manager not initialized")
	}
	return a.mcpManager.StopServer(name)
}

// MCPListServers returns the names of all currently connected MCP servers.
func (a *App) MCPListServers() ([]string, error) {
	if a.mcpManager == nil {
		return nil, fmt.Errorf("MCP manager not initialized")
	}
	return a.mcpManager.ListServers(), nil
}

// MCPListTools calls the named server's tools/list method and returns the
// declared tools. The frontend uses this to register MCP tools into the
// toolRegistry so the AI can call them.
func (a *App) MCPListTools(serverName string) ([]mcp.MCPToolInfo, error) {
	if a.mcpManager == nil {
		return nil, fmt.Errorf("MCP manager not initialized")
	}
	return a.mcpManager.ListTools(serverName)
}

// MCPCallTool invokes a single tool on the named MCP server. The result is
// returned as a generic value (the MCP content array) so the frontend can
// interpret it per the spec.
func (a *App) MCPCallTool(serverName, toolName string, args map[string]interface{}) (interface{}, error) {
	if a.mcpManager == nil {
		return nil, fmt.Errorf("MCP manager not initialized")
	}
	return a.mcpManager.CallTool(serverName, toolName, args)
}
