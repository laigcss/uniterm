package mcpclient

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// fakeSession stands in for *mcp.ClientSession in tests; it returns a fixed tool
// list and echoes the called tool name/args.
type fakeSession struct {
	tools []*mcp.Tool
	calls []string
}

func (f *fakeSession) ListTools(ctx context.Context, params *mcp.ListToolsParams) (*mcp.ListToolsResult, error) {
	return &mcp.ListToolsResult{Tools: f.tools}, nil
}

func (f *fakeSession) CallTool(ctx context.Context, params *mcp.CallToolParams) (*mcp.CallToolResult, error) {
	f.calls = append(f.calls, params.Name)
	return &mcp.CallToolResult{Content: []mcp.Content{
		&mcp.TextContent{Text: "echo:" + params.Name},
	}}, nil
}

func (f *fakeSession) Close() error { return nil }

// flakySession 模拟一个会断开的 MCP session：前 failCount 次 CallTool 返回
// err，之后返回正常结果。用于测试自动重连逻辑。
type flakySession struct {
	tools     []*mcp.Tool
	calls     []string
	err       error // 要返回的连接错误
	failCount int   // 还要失败多少次
}

func (f *flakySession) ListTools(ctx context.Context, params *mcp.ListToolsParams) (*mcp.ListToolsResult, error) {
	return &mcp.ListToolsResult{Tools: f.tools}, nil
}

func (f *flakySession) CallTool(ctx context.Context, params *mcp.CallToolParams) (*mcp.CallToolResult, error) {
	f.calls = append(f.calls, params.Name)
	if f.failCount > 0 {
		f.failCount--
		return nil, f.err
	}
	return &mcp.CallToolResult{Content: []mcp.Content{
		&mcp.TextContent{Text: "echo:" + params.Name},
	}}, nil
}

func (f *flakySession) Close() error { return nil }

func TestQualifiedName(t *testing.T) {
	cases := map[string]string{
		"fs":          "mcp__fs",
		"File Server": "mcp__file_server",
		"a/b:c":       "mcp__a_b_c",
	}
	for in, want := range cases {
		if got := QualifiedName(in, "read_file"); got != want+"__read_file" {
			t.Errorf("QualifiedName(%q,read_file)=%q want %q", in, got, want+"__read_file")
		}
	}
	if _, _, ok := splitQualified("plain_tool"); ok {
		t.Error("plain tool must not parse as qualified")
	}
	server, tool, ok := splitQualified("mcp__fs__read_file")
	if !ok || server != "fs" || tool != "read_file" {
		t.Errorf("splitQualified = %q,%q,%v", server, tool, ok)
	}
}

func TestConfigValidate(t *testing.T) {
	if err := (ClientConfig{Name: "x", Transport: TransportStdio}).Validate(); err == nil {
		t.Error("stdio without command should fail")
	}
	if err := (ClientConfig{Name: "x", Transport: TransportStreamableHTTP, URL: "http://x"}).Validate(); err != nil {
		t.Errorf("valid http config: %v", err)
	}
	if err := (ClientConfig{Name: "x", Transport: "ftp"}).Validate(); err == nil {
		t.Error("unknown transport should fail")
	}
}

func TestManagerListAndCall(t *testing.T) {
	fs := &fakeSession{tools: []*mcp.Tool{
		{Name: "read_file", Description: "read a file", InputSchema: map[string]any{"type": "object"}},
		{Name: "write_file", Description: "write a file"},
	}}
	m := NewManager(NewStore(t.TempDir()))
	m.dial = func(ctx context.Context, cfg ClientConfig) (Session, error) { return fs, nil }

	ctx := context.Background()
	m.ensureConn(ctx, ClientConfig{Name: "fs", Transport: TransportStdio, Command: "npx", Enabled: true})

	tools := m.ListTools()
	if len(tools) != 2 {
		t.Fatalf("want 2 tools, got %d", len(tools))
	}
	if tools[0].QualifiedName != "mcp__fs__read_file" {
		t.Errorf("qualified = %q", tools[0].QualifiedName)
	}

	out, err := m.CallTool(ctx, "mcp__fs__read_file", map[string]any{"path": "/tmp/a"})
	if err != nil {
		t.Fatalf("CallTool: %v", err)
	}
	if out != "echo:read_file" {
		t.Errorf("out=%q", out)
	}
	if fs.calls[0] != "read_file" {
		t.Errorf("remote tool called = %q", fs.calls[0])
	}

	// A non-qualified name must be rejected.
	if _, err := m.CallTool(ctx, "read_file", nil); err == nil {
		t.Error("plain name should error")
	}
}

func TestManagerRecordsDialFailure(t *testing.T) {
	wantErr := errors.New("boom")
	m := NewManager(NewStore(t.TempDir()))
	m.dial = func(ctx context.Context, cfg ClientConfig) (Session, error) { return nil, wantErr }
	m.ensureConn(context.Background(), ClientConfig{Name: "bad", Transport: TransportStdio, Command: "x", Enabled: true})

	if tools := m.ListTools(); len(tools) != 0 {
		t.Errorf("failed conn must not list tools, got %d", len(tools))
	}
	statuses := m.Statuses([]ClientConfig{{Name: "bad", Enabled: true}})
	if len(statuses) != 1 || statuses[0].Connected || statuses[0].Error == "" {
		t.Errorf("statuses=%+v", statuses)
	}
}

func TestStoreRoundTrip(t *testing.T) {
	s := NewStore(t.TempDir())
	in := []ClientConfig{
		{Name: "B", Transport: TransportStdio, Command: "npx", Enabled: true},
		{Name: "a", Transport: TransportSSE, URL: "http://x/sse", Enabled: false},
	}
	if err := s.Save(in); err != nil {
		t.Fatal(err)
	}
	got, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	// Saved sorted by name.
	if got[0].Name != "a" || got[1].Name != "B" {
		t.Errorf("not sorted: %s, %s", got[0].Name, got[1].Name)
	}
	// Missing file → empty, not error.
	empty := NewStore(t.TempDir())
	list, err := empty.Load()
	if err != nil || len(list) != 0 {
		t.Errorf("missing file: list=%v err=%v", list, err)
	}
}

// TestIsConnectionError 验证连接断开类错误的识别。
func TestIsConnectionError(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{nil, false},
		{errors.New("some other error"), false},
		{io.EOF, true},
		{errors.New("connection closed: calling \"tools/call\": client is closing: EOF"), true},
		{errors.New("client is closing"), true},
		{errors.New("write: broken pipe"), true},
		{errors.New("read: connection reset by peer"), true},
		{errors.New("use of closed network connection"), true},
		{errors.New("session ended"), true},
	}
	for _, c := range cases {
		if got := isConnectionError(c.err); got != c.want {
			t.Errorf("isConnectionError(%v) = %v, want %v", c.err, got, c.want)
		}
	}
}

// TestCallToolAutoReconnect 验证 SSE 断连后 CallTool 自动重连并重试成功。
// 第一次 CallTool 返回 EOF，触发重连；dialer 第二次返回一个健康的 session，
// 重试调用成功。
func TestCallToolAutoReconnect(t *testing.T) {
	// 第一个 session 模拟断开的 SSE 连接：总是返回 EOF
	broken := &flakySession{
		tools:     []*mcp.Tool{{Name: "ping", Description: "echo"}},
		err:       io.EOF,
		failCount: 1, // 第一次 CallTool 失败，之后如果还被调用则成功
	}
	// 第二个 session 是重连后的健康连接
	healthy := &fakeSession{tools: []*mcp.Tool{{Name: "ping", Description: "echo"}}}

	dialCount := 0
	m := NewManager(NewStore(t.TempDir()))
	m.dial = func(ctx context.Context, cfg ClientConfig) (Session, error) {
		dialCount++
		if dialCount == 1 {
			return broken, nil
		}
		return healthy, nil
	}

	ctx := context.Background()
	cfg := ClientConfig{Name: "sse-srv", Transport: TransportSSE, URL: "http://x/sse", Enabled: true}
	m.ensureConn(ctx, cfg)

	// 第一次调用：broken session 返回 EOF → 触发重连 → healthy session → 成功
	out, err := m.CallTool(ctx, "mcp__sse-srv__ping", map[string]any{})
	if err != nil {
		t.Fatalf("CallTool should auto-reconnect and succeed, got: %v", err)
	}
	if out != "echo:ping" {
		t.Errorf("out=%q, want %q", out, "echo:ping")
	}
	// dialer 应被调用两次：初始连接 + 重连
	if dialCount != 2 {
		t.Errorf("dialCount=%d, want 2 (initial + reconnect)", dialCount)
	}
	// broken session 应被调用一次（失败的那次）
	if len(broken.calls) != 1 {
		t.Errorf("broken.calls=%d, want 1", len(broken.calls))
	}
	// healthy session 应被调用一次（重连后重试的那次）
	if len(healthy.calls) != 1 {
		t.Errorf("healthy.calls=%d, want 1", len(healthy.calls))
	}
}

// TestCallToolNoReconnectOnNonConnectionError 验证非连接错误不触发重连。
// 工具自身返回的业务错误（res.IsError）不应触发重连。
func TestCallToolNoReconnectOnNonConnectionError(t *testing.T) {
	// session 返回一个非连接类错误
	bizErr := &flakySession{
		tools:     []*mcp.Tool{{Name: "ping"}},
		err:       errors.New("tool not found"),
		failCount: 1,
	}

	dialCount := 0
	m := NewManager(NewStore(t.TempDir()))
	m.dial = func(ctx context.Context, cfg ClientConfig) (Session, error) {
		dialCount++
		return bizErr, nil
	}

	ctx := context.Background()
	m.ensureConn(ctx, ClientConfig{Name: "srv", Transport: TransportStdio, Command: "x", Enabled: true})

	// 调用应返回错误，且不触发重连
	_, err := m.CallTool(ctx, "mcp__srv__ping", nil)
	if err == nil {
		t.Fatal("CallTool should return the business error")
	}
	// dialer 只应被调用一次（初始连接），不触发重连
	if dialCount != 1 {
		t.Errorf("dialCount=%d, want 1 (no reconnect on business error)", dialCount)
	}
}

// TestCallToolReconnectFails 验证重连失败时返回包含原始错误的复合错误信息。
func TestCallToolReconnectFails(t *testing.T) {
	// 第一个 session 总是返回 EOF
	broken := &flakySession{
		tools:     []*mcp.Tool{{Name: "ping"}},
		err:       io.EOF,
		failCount: 5, // 总是失败
	}

	dialCount := 0
	m := NewManager(NewStore(t.TempDir()))
	m.dial = func(ctx context.Context, cfg ClientConfig) (Session, error) {
		dialCount++
		if dialCount == 1 {
			return broken, nil
		}
		// 重连时 dial 失败
		return nil, errors.New("dial failed: server unreachable")
	}

	ctx := context.Background()
	m.ensureConn(ctx, ClientConfig{Name: "srv", Transport: TransportSSE, URL: "http://x", Enabled: true})

	_, err := m.CallTool(ctx, "mcp__srv__ping", nil)
	if err == nil {
		t.Fatal("CallTool should fail when reconnect fails")
	}
	// 错误信息应包含 "reconnect failed"
	if !strings.Contains(err.Error(), "reconnect failed") {
		t.Errorf("error should mention reconnect failed, got: %v", err)
	}
}

// TestReconnectManual 验证手动调用 Reconnect 方法能重新建立连接。
func TestReconnectManual(t *testing.T) {
	first := &fakeSession{tools: []*mcp.Tool{{Name: "ping"}}}
	second := &fakeSession{tools: []*mcp.Tool{{Name: "ping"}}}

	dialCount := 0
	m := NewManager(NewStore(t.TempDir()))
	m.dial = func(ctx context.Context, cfg ClientConfig) (Session, error) {
		dialCount++
		if dialCount == 1 {
			return first, nil
		}
		return second, nil
	}

	ctx := context.Background()
	m.ensureConn(ctx, ClientConfig{Name: "srv", Transport: TransportSSE, URL: "http://x", Enabled: true})

	// 手动重连
	if err := m.Reconnect(ctx, "srv"); err != nil {
		t.Fatalf("Reconnect: %v", err)
	}
	if dialCount != 2 {
		t.Errorf("dialCount=%d, want 2", dialCount)
	}

	// 重连后调用工具应使用新的 session
	out, err := m.CallTool(ctx, "mcp__srv__ping", nil)
	if err != nil {
		t.Fatalf("CallTool after reconnect: %v", err)
	}
	if out != "echo:ping" {
		t.Errorf("out=%q", out)
	}
	// 新 session 应被调用，旧 session 不应被调用
	if len(second.calls) != 1 {
		t.Errorf("second.calls=%d, want 1", len(second.calls))
	}
}

// TestReconnectUnknownServer 验证重连不存在的服务器返回错误。
func TestReconnectUnknownServer(t *testing.T) {
	m := NewManager(NewStore(t.TempDir()))
	m.dial = func(ctx context.Context, cfg ClientConfig) (Session, error) {
		return &fakeSession{}, nil
	}
	err := m.Reconnect(context.Background(), "no-such-server")
	if err == nil {
		t.Fatal("Reconnect should fail for unknown server")
	}
}
