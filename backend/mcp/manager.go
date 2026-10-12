// Package mcp implements a minimal MCP (Model Context Protocol) client that
// launches external MCP servers as child processes and talks to them over
// stdio (JSON-RPC 2.0 over stdin/stdout).
//
// The manager owns the lifetime of every spawned server: it starts the
// process, wires a per-server request/response channel, and tears everything
// down on StopServer / StopAll. Calls are serialized per server (a single
// goroutine reads stdout and dispatches by JSON-RPC id), so concurrent
// ListTools / CallTool from the frontend are safe.
//
// Reference: https://modelcontextprotocol.io/specification
package mcp

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"

	"sync"
	"sync/atomic"
	"time"

	"github.com/laigcss/ai-ops-terminal/backend/log"
)

// MCPTool describes a tool exposed by an MCP server. InputSchema is the raw
// JSON schema the server reports; the frontend converts it into the LLM tool
// schema shape.
type MCPTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// MCPToolInfo is the wire shape returned to the frontend via Wails bindings.
// It mirrors MCPTool but is declared in this package so the binding generator
// emits a stable, importable type.
type MCPToolInfo struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// mcpServerProcess holds the runtime state of one connected MCP server.
type mcpServerProcess struct {
	name   string
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser

	mu      sync.Mutex // guards pending + closed
	pending map[int64]chan *jsonRPCResponse
	closed  bool

	writeMu sync.Mutex // serializes concurrent stdin writes

	nextID atomic.Int64
	done   chan struct{} // closed when the reader goroutine exits
}

// MCPManager owns the set of connected MCP servers. All methods are safe to
// call concurrently from multiple goroutines (Wails binding calls).
type MCPManager struct {
	mu      sync.RWMutex
	servers map[string]*mcpServerProcess
}

// NewManager returns an empty MCPManager. Servers are added via StartServer.
func NewManager() *MCPManager {
	return &MCPManager{servers: make(map[string]*mcpServerProcess)}
}

// jsonRPCRequest is the JSON-RPC 2.0 request envelope sent to the server.
type jsonRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      int64       `json:"id"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

// jsonRPCResponse is the JSON-RPC 2.0 response envelope received from the
// server. Result / Error are kept as RawMessage so the caller can unmarshal
// into the right shape without a round-trip through interface{}.
type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int64           `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonRPCErr     `json:"error,omitempty"`
}

type jsonRPCErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// StartServer launches an MCP server as a child process and begins reading its
// stdout for JSON-RPC responses. The server is registered under `name`; a
// server with the same name is stopped first so the caller can re-connect.
func (m *MCPManager) StartServer(name string, command string, args []string, env map[string]string) error {
	if name == "" {
		return errors.New("mcp: server name is required")
	}
	if command == "" {
		return errors.New("mcp: command is required")
	}

	// Stop an existing server with the same name so re-connect works.
	if _, exists := m.get(name); exists {
		_ = m.StopServer(name)
	}

	cmd := exec.Command(command, args...)
	// Inherit the parent env, then overlay the caller-provided overrides.
	// F3: cmd.Env 一旦设为非 nil 即不再继承父进程环境，会导致配置了 env 的
	//     MCP server 丢失 PATH/HOME（npx/uvx 等启动失败）。必须以 os.Environ()
	//     为基底再叠加用户 env。
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), envToList(env)...)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("mcp: stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return fmt.Errorf("mcp: stdout pipe: %w", err)
	}
	// Discard stderr by default; the server may log noise that would otherwise
	// block the pipe. Users can surface server logs via the app log if needed.
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		return fmt.Errorf("mcp: start %q: %w", command, err)
	}

	p := &mcpServerProcess{
		name:    name,
		cmd:     cmd,
		stdin:   stdin,
		stdout:  stdout,
		pending: make(map[int64]chan *jsonRPCResponse),
		done:    make(chan struct{}),
	}

	m.mu.Lock()
	m.servers[name] = p
	m.mu.Unlock()

	go p.readLoop()

	log.Writef("[mcp] started server %q (pid=%d, cmd=%s %v)", name, cmd.Process.Pid, command, args)
	return nil
}

// StopServer terminates the named server and removes it from the registry.
// Returns nil if the server is not known (idempotent).
func (m *MCPManager) StopServer(name string) error {
	m.mu.Lock()
	p, ok := m.servers[name]
	if ok {
		delete(m.servers, name)
	}
	m.mu.Unlock()
	if !ok {
		return nil
	}
	return p.stop()
}

// ListServers returns the names of all currently connected servers.
func (m *MCPManager) ListServers() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	names := make([]string, 0, len(m.servers))
	for n := range m.servers {
		names = append(names, n)
	}
	return names
}

// ListTools calls the MCP server's tools/list method and returns the declared
// tools. The call has a 10s timeout — servers that don't respond in time are
// considered broken.
func (m *MCPManager) ListTools(name string) ([]MCPToolInfo, error) {
	p, ok := m.get(name)
	if !ok {
		return nil, fmt.Errorf("mcp: server %q not connected", name)
	}

	resp, err := p.call("tools/list", struct{}{}, 10*time.Second)
	if err != nil {
		return nil, err
	}

	// tools/list result shape: {"tools": [{name, description, inputSchema}, ...]}
	var result struct {
		Tools []MCPTool `json:"tools"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, fmt.Errorf("mcp: parse tools/list result: %w", err)
	}

	out := make([]MCPToolInfo, 0, len(result.Tools))
	for _, t := range result.Tools {
		out = append(out, MCPToolInfo{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.InputSchema,
		})
	}
	return out, nil
}

// CallTool invokes a single tool on the named MCP server. args is forwarded
// as the tool call arguments. The result is returned as-is (raw JSON); the
// frontend interprets the content array per the MCP spec.
//
// The call has a 60s timeout — long-running tools are expected to stream
// progress back via their result, not block forever.
func (m *MCPManager) CallTool(name string, toolName string, args map[string]interface{}) (interface{}, error) {
	p, ok := m.get(name)
	if !ok {
		return nil, fmt.Errorf("mcp: server %q not connected", name)
	}

	params := map[string]interface{}{
		"name":      toolName,
		"arguments": args,
	}
	resp, err := p.call("tools/call", params, 60*time.Second)
	if err != nil {
		return nil, err
	}

	// Return the raw result as a generic value so the Wails binding can ship
	// it to the frontend without a typed round-trip. The frontend interprets
	// the content array.
	var result interface{}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, fmt.Errorf("mcp: parse tools/call result: %w", err)
	}
	return result, nil
}

// StopAll terminates every connected server. Called from App.shutdown.
func (m *MCPManager) StopAll() {
	m.mu.Lock()
	servers := m.servers
	m.servers = make(map[string]*mcpServerProcess)
	m.mu.Unlock()

	for name, p := range servers {
		if err := p.stop(); err != nil {
			log.Writef("[mcp] stop %q failed: %v", name, err)
		}
	}
}

// get returns the named server process and a presence flag.
func (m *MCPManager) get(name string) (*mcpServerProcess, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p, ok := m.servers[name]
	return p, ok
}

// envToList converts a map of env overrides into "KEY=VALUE" strings suitable
// for exec.Cmd.Env. The caller is expected to append these to the inherited
// environment.
func envToList(env map[string]string) []string {
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}

// readLoop drains the server's stdout line by line, decodes each line as a
// JSON-RPC response, and dispatches it to the pending caller by id. Exits
// when stdout is closed (server died) or the read fails.
func (p *mcpServerProcess) readLoop() {
	scanner := bufio.NewScanner(p.stdout)
	// MCP servers can emit large tool results; raise the per-line cap so we
	// don't error on a multi-KB JSON-RPC response. 4 MiB matches the typical
	// bufio.MaxScanTokenSize headroom used by other stdio JSON-RPC clients.
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var resp jsonRPCResponse
		if err := json.Unmarshal(line, &resp); err != nil {
			// Not a JSON-RPC response — could be a server log line on stdout.
			// Skip it rather than tearing down the connection.
			continue
		}
		if resp.ID == 0 {
			// Notification (no id) — we don't subscribe to any, ignore.
			continue
		}
		p.deliver(resp.ID, &resp)
	}

	// stdout closed (server exited) or read error. Fail every pending call so
	// callers don't block forever, then signal done.
	p.mu.Lock()
	p.closed = true
	for id, ch := range p.pending {
		close(ch)
		delete(p.pending, id)
	}
	p.mu.Unlock()
	close(p.done)
}

// deliver routes a response to the goroutine waiting on the matching id.
func (p *mcpServerProcess) deliver(id int64, resp *jsonRPCResponse) {
	p.mu.Lock()
	ch, ok := p.pending[id]
	if ok {
		delete(p.pending, id)
	}
	p.mu.Unlock()
	if !ok {
		return // stale response for a timed-out/abandoned call
	}
	ch <- resp
}

// call sends a JSON-RPC request and waits for the matching response. Returns
// an error if the server doesn't respond within timeout or has exited.
func (p *mcpServerProcess) call(method string, params interface{}, timeout time.Duration) (*jsonRPCResponse, error) {
	id := p.nextID.Add(1)
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	// Register the pending response channel BEFORE writing the request so the
	// reader can't race ahead and find no waiter.
	ch := make(chan *jsonRPCResponse, 1)
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, errors.New("mcp: server connection closed")
	}
	p.pending[id] = ch
	p.mu.Unlock()

	payload, err := json.Marshal(req)
	if err != nil {
		p.removePending(id)
		return nil, fmt.Errorf("mcp: marshal request: %w", err)
	}
	// JSON-RPC over stdio is line-delimited.
	payload = append(payload, '\n')

	p.stdinMuLock()
	defer p.stdinMuUnlock()
	if _, err := p.stdin.Write(payload); err != nil {
		p.removePending(id)
		return nil, fmt.Errorf("mcp: write request: %w", err)
	}

	select {
	case resp, ok := <-ch:
		if !ok {
			return nil, errors.New("mcp: server connection closed while waiting for response")
		}
		if resp.Error != nil {
			return nil, fmt.Errorf("mcp: server error %d: %s", resp.Error.Code, resp.Error.Message)
		}
		return resp, nil
	case <-time.After(timeout):
		p.removePending(id)
		return nil, fmt.Errorf("mcp: %s timed out after %s", method, timeout)
	case <-p.done:
		p.removePending(id)
		return nil, errors.New("mcp: server exited while waiting for response")
	}
}

// stdinMuLock / stdinMuUnlock serialize writes to the server's stdin. The
// stdin pipe is not safe for concurrent Write, and multiple Wails calls can
// race. We reuse the process mutex's lock semantics by adding a dedicated
// write mutex so the reader goroutine (which only touches pending) isn't
// blocked by a writer.
func (p *mcpServerProcess) stdinMuLock()   { p.writeMu.Lock() }
func (p *mcpServerProcess) stdinMuUnlock() { p.writeMu.Unlock() }

// removePending drops a waiter from the map. Safe to call even if the id is
// already gone (timeout + late deliver race).
func (p *mcpServerProcess) removePending(id int64) {
	p.mu.Lock()
	delete(p.pending, id)
	p.mu.Unlock()
}

// stop terminates the server process and closes its pipes. Idempotent.
func (p *mcpServerProcess) stop() error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	for id, ch := range p.pending {
		close(ch)
		delete(p.pending, id)
	}
	p.mu.Unlock()

	// Closing stdin signals EOF to most servers; then kill the process to
	// handle servers that don't exit on stdin EOF.
	_ = p.stdin.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	_ = p.cmd.Wait()
	// Drain the reader goroutine so it doesn't leak.
	<-p.done
	log.Writef("[mcp] stopped server %q", p.name)
	return nil
}
