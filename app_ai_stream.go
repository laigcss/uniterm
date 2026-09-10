package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// app_ai_stream.go — A3 重构：提取三个 chatCompletion* 函数的公共 SSE 骨架。
//
// 三个 provider（Anthropic Messages / OpenAI Chat Completions / OpenAI Responses）
// 原本各自重复：context+cancel 注册（F-308 atomic pointer）、HTTP 请求发送、
// 64 KiB 错误体上限（F-305）、scanner 配置、SSE `data: ` 行迭代、最终消息序列化、
// ai:done 事件发射。本文件把这些公共逻辑抽成 helper，provider 仅注册一个
// sseLineMapper 处理各自的事件状态机，行为与原实现完全等价。
//
// 设计要点：
//   - streamState 持有跨事件共享的 content block 列表 / role / usage；
//   - sseLineMapper 通过闭包捕获 provider-specific 的 per-call 状态
//     （Anthropic 的 currentBlock、OpenAI 的 activeToolCalls/toolInputBufs、
//     Responses 的 blockByOutputIdx 等），直接调用 emit 并更新 state；
//   - runSSEStream 驱动 scanner 循环 + `data: ` 前缀解析，把每行交给 mapper，
//     mapper 返回 streamAction 控制终止 / 错误；
//   - prepareSSEContext / doSSERequest / finalizeStreamMessage / emitStreamDone
//     消除三处复制粘贴。

// streamState 是三个 provider 共享的 content block 状态机公共部分。
// provider-specific 的临时状态（当前块、并行 tool_call map、per-block buffer 等）
// 由各自的 sseLineMapper 闭包捕获，不放在这里，避免公共结构被某一 provider 专有字段污染。
type streamState struct {
	contentBlocks []map[string]interface{} // 已关闭的 content block
	messageRole   string                   // 消息角色（默认 "assistant"）
	usage         map[string]interface{}   // 累计 usage（Anthropic message_delta 携带）
}

// streamAction 是 sseLineMapper 处理一行 SSE data 后返回的动作。
//   - done=true 表示流正常结束，result 是最终消息 JSON；
//   - err!=nil 表示流出错（含上游 error 事件）；
//   - 两者都为零值表示继续读下一行。
type streamAction struct {
	done   bool
	result string
	err    error
}

// sseLineMapper 处理一个已去掉 `data: ` 前缀的 SSE data 行。
// mapper 通过闭包捕获 provider-specific 状态机，直接调用 emit 发射 Wails 事件
// 并更新 state。返回 streamAction 控制流的终止 / 错误。
type sseLineMapper func(dataStr string, state *streamState, emit func(string, ...any)) streamAction

// prepareSSEContext 创建带 600s 超时的 context，并把 cancel 注册到 App 级
// atomic pointer（F-308：重叠 ChatCompletion 调用不会互相覆盖 cancel）。
// 返回 ctx 与 cleanup；cleanup 必须在函数返回时调用，且仅当 slot 仍指向自己的
// cancel 时才清空（CAS），避免清掉更新的调用注册的 cancel。
func (a *App) prepareSSEContext() (context.Context, func()) {
	ctx, cancel := context.WithTimeout(context.Background(), 600*time.Second)
	myCancel := cancel
	a.chatCancel.Store(&myCancel)
	cleanup := func() {
		a.chatCancel.CompareAndSwap(&myCancel, nil)
	}
	return ctx, cleanup
}

// doSSERequest 发送 SSE POST 请求并返回响应 + 配置好的 scanner。
// 处理：请求构建、Content-Type、自定义 header、发送、超时/网络错误映射、
// 非 200 状态码（F-305：错误体上限 64 KiB）、scanner buffer 配置（1 MiB 上限）。
// 调用方负责 defer res.Body.Close()。
func doSSERequest(ctx context.Context, client *http.Client, url string, body []byte, headers map[string]string) (*http.Response, *bufio.Scanner, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := client.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, nil, fmt.Errorf("AI_REQUEST_TIMEOUT")
		}
		return nil, nil, err
	}
	if res.StatusCode != http.StatusOK {
		// F-305: cap error-body reads at 64 KiB so a hostile/buggy upstream
		// returning a multi-GB error body can't OOM the Go process.
		errBody, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))
		res.Body.Close()
		return nil, nil, fmt.Errorf("HTTP %d: %s", res.StatusCode, string(errBody))
	}
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	return res, scanner, nil
}

// runSSEStream 驱动 SSE 流解析：迭代 scanner、跳过非 data 行、去掉 `data: ` 前缀、
// 把每行交给 mapper。mapper 返回 done/err 时立即终止；否则继续。
// 流自然结束（scanner.Scan 返回 false）时返回空字符串 + scanner.Err()。
// 调用方负责在 mapper 内处理"流末尾仍有未关闭 block"的兜底逻辑（如原实现）。
func runSSEStream(scanner *bufio.Scanner, state *streamState, emit func(string, ...any), mapper sseLineMapper) (string, error) {
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		dataStr := line[6:]
		action := mapper(dataStr, state, emit)
		if action.err != nil {
			return "", action.err
		}
		if action.done {
			return action.result, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", nil
}

// finalizeStreamMessage 把 state 中的 contentBlocks 序列化为 Anthropic 格式
// 最终消息 JSON（{"role":...,"content":...}）。三个 provider 的返回值契约一致。
func finalizeStreamMessage(state *streamState) (string, error) {
	fullMessage := map[string]interface{}{
		"role":    state.messageRole,
		"content": state.contentBlocks,
	}
	resultJSON, err := json.Marshal(fullMessage)
	if err != nil {
		return "", fmt.Errorf("marshal final message: %w", err)
	}
	return string(resultJSON), nil
}

// emitStreamDone 发射 ai:done 事件（F-320 typed payload）。
// usage 为 nil 时 omitempty 生效，与 Anthropic 路径外的两个 provider 行为一致。
func emitStreamDone(emit func(string, ...any), state *streamState, stopReason string) {
	emit("ai:done", aiDoneEvent{
		Message: map[string]interface{}{
			"role":    state.messageRole,
			"content": state.contentBlocks,
		},
		Usage:      state.usage,
		StopReason: stopReason,
	})
}

// emitStreamDoneRaw 发射 ai:done，但 message 用已序列化的 json.RawMessage 透传，
// 避免对已经 marshal 过的 content 再做一次 map→json 往返（Responses 路径的 finish 闭包
// 原本就用 RawMessage 形式）。
func emitStreamDoneRaw(emit func(string, ...any), messageJSON []byte, stopReason string) {
	emit("ai:done", struct {
		Message    json.RawMessage `json:"message"`
		StopReason string          `json:"stop_reason"`
	}{
		Message:    json.RawMessage(messageJSON),
		StopReason: stopReason,
	})
}
