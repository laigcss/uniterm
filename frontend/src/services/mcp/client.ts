// services/mcp/client.ts — MCP 客户端服务。
//
// 封装 Wails binding 调用，提供 MCP server 启停、工具列表、工具调用
// 的 typed 接口。所有方法返回 Promise，错误由调用方处理。
//
// 后端 binding 在 frontend/bindings/github.com/laigcss/ai-ops-terminal/app.js 中
// 自动生成（手动补充 MCP* 函数）。

import {
  MCPStartServer,
  MCPStopServer,
  MCPListServers,
  MCPListTools,
  MCPCallTool,
} from '../../../bindings/github.com/laigcss/ai-ops-terminal/app'

/** MCP server 启动配置。 */
export interface MCPServerConfig {
  /** Server 名称，唯一标识，用作工具名前缀的一部分。 */
  name: string
  /** 可执行命令（如 `npx`、`python`、`/usr/local/bin/mcp-server`）。 */
  command: string
  /** 命令参数。 */
  args?: string[]
  /** 环境变量覆盖（KEY=VALUE）。 */
  env?: Record<string, string>
}

/** MCP server 暴露的工具。inputSchema 是 server 报告的 JSON Schema。 */
export interface MCPTool {
  name: string
  description: string
  /** JSON Schema（server 原样报告，可能是空对象）。 */
  inputSchema: Record<string, unknown>
}

/**
 * 启动一个 MCP server 子进程。
 * 同名 server 会先停止再启动（重连）。
 */
export async function startServer(config: MCPServerConfig): Promise<void> {
  await MCPStartServer(
    config.name,
    config.command,
    config.args ?? [],
    config.env ?? {},
  )
}

/** 停止一个 MCP server。未知名称静默成功（幂等）。 */
export async function stopServer(name: string): Promise<void> {
  await MCPStopServer(name)
}

/** 列出所有已连接的 MCP server 名称。 */
export async function listServers(): Promise<string[]> {
  return await MCPListServers()
}

/** 列出某 server 暴露的工具。 */
export async function listTools(serverName: string): Promise<MCPTool[]> {
  const tools = await MCPListTools(serverName)
  // 后端返回的 inputSchema 是 json.RawMessage（字符串或对象），统一成对象。
  return tools.map((t: any) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: normalizeInputSchema(t.inputSchema),
  }))
}

/** 调用某 server 的某工具。返回 MCP content 数组（由调用方解释）。 */
export async function callTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return await MCPCallTool(serverName, toolName, args)
}

/**
 * 将后端返回的 inputSchema（可能是 JSON 字符串、对象、null）归一化为对象。
 * 空 / 无效时返回 {"type":"object"} 作为安全默认。
 */
function normalizeInputSchema(raw: unknown): Record<string, unknown> {
  if (raw == null) return { type: 'object' }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      // fall through
    }
    return { type: 'object' }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>
  return { type: 'object' }
}