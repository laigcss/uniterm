#!/bin/bash
set -euo pipefail

# WebSocket 连通性测试脚本
# 测试 uniTerm server 模式的 WebSocket 事件推送和流连接
#
# 用法: bash harmonyos/tests/websocket-test.sh [port]
# 默认端口: 9245
#
# 依赖:
#   - curl（健康检查）
#   - websocat 或 wscat（WebSocket 测试，需手动安装）
#   - Go 交叉编译产物或本地编译的 server 模式二进制

PORT="${1:-9245}"
HOST="localhost"
BASE_URL="http://${HOST}:${PORT}"
WS_URL="ws://${HOST}:${PORT}"

# 输出函数
log()   { echo "==> $*"; }
pass()  { echo "  ✅ PASS: $*"; }
fail()  { echo "  ❌ FAIL: $*"; }
info()  { echo "  ℹ️  $*"; }

# 检查依赖
check_deps() {
    command -v curl >/dev/null 2>&1 || { echo "ERROR: 需要 curl"; exit 1; }
    if command -v websocat >/dev/null 2>&1; then
        WS_TOOL="websocat"
    elif command -v wscat >/dev/null 2>&1; then
        WS_TOOL="wscat"
    else
        WS_TOOL=""
        info "未找到 websocat 或 wscat，WebSocket 测试将跳过"
        info "安装方式: cargo install websocat 或 npm install -g wscat"
    fi
}

# 构建并启动 server
start_server() {
    log "构建 server 模式二进制（-tags server,production）"

    # 尝试本地构建（macOS/Linux）
    BINARY="/tmp/ai-ops-test-server"
    if ! CGO_ENABLED=0 go build -tags server,production -o "$BINARY" . 2>/dev/null; then
        fail "构建失败"
        exit 1
    fi

    log "启动 server (端口 ${PORT})"
    AI_OPS_PORT="${PORT}" "$BINARY" &>/tmp/ai-ops-test-server.log &
    SERVER_PID=$!
    info "Server PID: ${SERVER_PID}"

    # 等待启动
    for i in $(seq 1 30); do
        if curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
            pass "Server 已启动"
            return 0
        fi
        sleep 0.5
    done

    fail "Server 启动超时"
    cat /tmp/ai-ops-test-server.log
    exit 1
}

# 停止 server
stop_server() {
    log "停止 server"
    if [ -n "${SERVER_PID:-}" ]; then
        kill -TERM "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -f /tmp/ai-ops-test-server /tmp/ai-ops-test-server.log
}

# 测试 1: 健康检查
test_health() {
    log "测试 1: 健康检查端点"
    local response
    response=$(curl -sf "${BASE_URL}/health" 2>/dev/null || echo "")
    if echo "$response" | grep -q '"status":"ok"'; then
        pass "健康检查返回正确: ${response}"
    else
        fail "健康检查异常: ${response}"
    fi
}

# 测试 2: 首页服务
test_index() {
    log "测试 2: 首页服务"
    local response
    response=$(curl -sf "${BASE_URL}/" 2>/dev/null || echo "")
    if echo "$response" | grep -q '<div id="app">'; then
        pass "首页包含 Vue 挂载点"
    else
        fail "首页异常"
    fi
    if echo "$response" | grep -q '/assets/'; then
        pass "首页引用嵌入的静态资源"
    else
        fail "首页未引用静态资源"
    fi
}

# 测试 3: Wails 运行时
test_wails_runtime() {
    log "测试 3: Wails 运行时端点"

    local custom_js
    custom_js=$(curl -sf "${BASE_URL}/wails/custom.js" 2>/dev/null || echo "")
    if echo "$custom_js" | grep -q "WebSocket"; then
        pass "/wails/custom.js 包含 WebSocket 连接代码"
    else
        fail "/wails/custom.js 异常"
    fi

    local runtime_js
    runtime_js=$(curl -sf "${BASE_URL}/wails/runtime.js" 2>/dev/null || echo "")
    if echo "$runtime_js" | grep -q "streamFactory"; then
        pass "/wails/runtime.js 包含 stream factory"
    else
        fail "/wails/runtime.js 异常"
    fi
}

# 测试 4: WebSocket 事件连接
test_ws_events() {
    log "测试 4: WebSocket 事件连接"
    if [ -z "$WS_TOOL" ]; then
        info "跳过（未安装 WebSocket 工具）"
        return
    fi

    local ws_path="/wails/events"
    info "连接 ${WS_URL}${ws_path}"

    if [ "$WS_TOOL" = "websocat" ]; then
        # websocat: 尝试连接 3 秒
        timeout 3 websocat "${WS_URL}${ws_path}" 2>/dev/null && {
            pass "WebSocket 事件连接成功"
        } || {
            # 超时退出码 124 是正常的（连接成功但无事件）
            if [ $? -eq 124 ]; then
                pass "WebSocket 事件连接成功（3 秒超时退出）"
            else
                fail "WebSocket 事件连接失败"
            fi
        }
    elif [ "$WS_TOOL" = "wscat" ]; then
        # wscat: 尝试连接 3 秒
        timeout 3 wscat -c "${WS_URL}${ws_path}" 2>/dev/null && {
            pass "WebSocket 事件连接成功"
        } || {
            if [ $? -eq 124 ]; then
                pass "WebSocket 事件连接成功（3 秒超时退出）"
            else
                fail "WebSocket 事件连接失败"
            fi
        }
    fi
}

# 测试 5: WebSocket 流连接
test_ws_stream() {
    log "测试 5: WebSocket 流连接"
    if [ -z "$WS_TOOL" ]; then
        info "跳过（未安装 WebSocket 工具）"
        return
    fi

    local ws_path="/wails/stream/ws"
    info "连接 ${WS_URL}${ws_path}"

    if [ "$WS_TOOL" = "websocat" ]; then
        timeout 3 websocat "${WS_URL}${ws_path}" 2>/dev/null && {
            pass "WebSocket 流连接成功"
        } || {
            if [ $? -eq 124 ]; then
                pass "WebSocket 流连接成功（3 秒超时退出）"
            else
                fail "WebSocket 流连接失败"
            fi
        }
    elif [ "$WS_TOOL" = "wscat" ]; then
        timeout 3 wscat -c "${WS_URL}${ws_path}" 2>/dev/null && {
            pass "WebSocket 流连接成功"
        } || {
            if [ $? -eq 124 ]; then
                pass "WebSocket 流连接成功（3 秒超时退出）"
            else
                fail "WebSocket 流连接失败"
            fi
        }
    fi
}

# 测试 6: 环境变量覆盖
test_env_override() {
    log "测试 6: 环境变量端口覆盖"
    local custom_port=9301
    local custom_binary="/tmp/ai-ops-test-server-custom"

    if ! CGO_ENABLED=0 go build -tags server,production -o "$custom_binary" . 2>/dev/null; then
        fail "构建失败，跳过"
        return
    fi

    AI_OPS_PORT="$custom_port" "$custom_binary" &>/dev/null &
    local custom_pid=$!

    for i in $(seq 1 10); do
        if curl -sf "http://localhost:${custom_port}/health" >/dev/null 2>&1; then
            pass "自定义端口 ${custom_port} 健康检查通过"
            kill -TERM "$custom_pid" 2>/dev/null || true
            wait "$custom_pid" 2>/dev/null || true
            rm -f "$custom_binary"
            return
        fi
        sleep 0.5
    done

    fail "自定义端口启动超时"
    kill -TERM "$custom_pid" 2>/dev/null || true
    rm -f "$custom_binary"
}

# 主函数
main() {
    log "uniTerm WebSocket 连通性测试"
    log "目标: ${BASE_URL}"
    echo ""

    check_deps
    start_server

    echo ""
    test_health
    test_index
    test_wails_runtime
    test_ws_events
    test_ws_stream
    test_env_override

    echo ""
    log "测试完成"
    stop_server
}

# 确保退出时停止 server
trap stop_server EXIT

main