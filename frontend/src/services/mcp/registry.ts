// services/mcp/registry.ts — MCP 工具注册表桥接。
//
// 将 MCP server 暴露的工具动态注册到 toolRegistry（A3 已建立的注册表），
// 使 AI agent 能像调用内置工具一样调用 MCP 工具。
//
// 命名约定：MCP 工具注册名 = `mcp__<serverName>__<toolName>`，避免与内置
// 工具冲突，并能在 unregisterMCPTools 时按前缀批量移除。
//
// MCP 工具默认归为 'write' 类（会与外部进程交互），受 interactionMode 过滤：
// chat 模式下 MCP 工具被禁用（与 EXECUTION_TOOLS 同列），readonly 模式下
// 也被禁用（与 WRITE_TOOLS 同列）。agent 模式放行。

import { toolRegistry } from '../tools'
import type { ToolDefinition, ToolSchema } from '../tools/types'
import { capToolResult } from '../tools/_shared'
import { callTool as mcpCallTool } from './client'
import type { MCPTool } from './client'

/** MCP 工具名前缀，用于区分内置工具和按 server 批量注销。 */
export const MCP_TOOL_PREFIX = 'mcp__'

/** MCP 工具结果截断上限：10KB，防止外部进程回传大输出撑爆上下文。 */
const MCP_RESULT_MAX_BYTES = 10 * 1024

/**
 * 构造 MCP 工具的注册名：`mcp__<serverName>__<toolName>`。
 * serverName 中的 `__` 会被替换为 `_` 以保持前缀解析的可逆性。
 */
export function mcpToolName(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/__/g, '_')
  return `${MCP_TOOL_PREFIX}${safeServer}__${toolName}`
}

/** 判断一个工具名是否为 MCP 工具（由本模块注册）。 */
export function isMCPTool(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX)
}

/** 从 MCP 工具注册名解析出 serverName 和 toolName。 */
export function parseMCPToolName(name: string): { serverName: string; toolName: string } | null {
  if (!isMCPTool(name)) return null
  const rest = name.slice(MCP_TOOL_PREFIX.length)
  const idx = rest.indexOf('__')
  if (idx < 0) return null
  return { serverName: rest.slice(0, idx), toolName: rest.slice(idx + 2) }
}

/**
 * 将一个 MCP server 暴露的工具批量注册到 toolRegistry。
 * 已存在的同名工具会被覆盖（重连场景）。
 */
export function registerMCPTools(serverName: string, tools: MCPTool[]): void {
  for (const t of tools) {
    const registeredName = mcpToolName(serverName, t.name)
    const def = buildToolDefinition(serverName, t.name, registeredName, t)
    toolRegistry.set(registeredName, def)
  }
}

/**
 * 移除某 server 注册的所有 MCP 工具。
 * 通过遍历 toolRegistry 找出前缀匹配的项。
 */
export function unregisterMCPTools(serverName: string): void {
  const safeServer = serverName.replace(/__/g, '_')
  const prefix = `${MCP_TOOL_PREFIX}${safeServer}__`
  for (const name of Array.from(toolRegistry.keys())) {
    if (name.startsWith(prefix)) {
      toolRegistry.delete(name)
    }
  }
}

/** 获取所有已注册的 MCP 工具名。 */
export function getMCPToolNames(): string[] {
  const names: string[] = []
  for (const name of toolRegistry.keys()) {
    if (isMCPTool(name)) names.push(name)
  }
  return names
}

/** 获取所有已注册的 MCP 工具 schema（用于发给 LLM）。 */
export function getMCPToolSchemas(): ToolSchema[] {
  const schemas: ToolSchema[] = []
  for (const def of toolRegistry.values()) {
    if (isMCPTool(def.name)) schemas.push(def.schema)
  }
  return schemas
}

/** 是否有任何 MCP 工具已注册。 */
export function hasMCPTools(): boolean {
  for (const name of toolRegistry.keys()) {
    if (isMCPTool(name)) return true
  }
  return false
}

/**
 * 为单个 MCP 工具构造 ToolDefinition。
 *
 * - validate: 直接透传 input（MCP 工具的参数由 server 校验）
 * - execute: 调用 mcpCallTool，将结果格式化为文本回传 AI
 * - schema: 从 MCP inputSchema 转换为 LLM tool schema
 *
 * 错误处理：MCP server 崩溃 / 超时 / 返回错误时，将错误消息作为工具
 * 结果回传 AI（不 throw），让 AI 能优雅降级。
 */
function buildToolDefinition(
  serverName: string,
  toolName: string,
  registeredName: string,
  tool: MCPTool,
): ToolDefinition {
  const description = tool.description || `MCP tool ${toolName} from server ${serverName}`
  // 在描述里标注来源，帮助 AI 理解这是外部工具。
  const annotatedDesc = `[MCP:${serverName}] ${description}`

  return {
    name: registeredName,
    schema: {
      name: registeredName,
      description: annotatedDesc,
      input_schema: toLLMInputSchema(tool.inputSchema),
    },
    validate: (input: unknown) => input,
    execute: async (ctx, input) => {
      const { store, toolUseId } = ctx
      try {
        const result = await mcpCallTool(serverName, toolName, (input as Record<string, unknown>) ?? {})
        const text = formatMCPResult(result)
        store.addMessage({
          id: `msg-${Date.now()}`,
          role: 'tool',
          content: capToolResult(truncateForMCP(text)),
          tool_call_id: toolUseId,
        })
      } catch (e: any) {
        // 优雅降级：把错误回传 AI，不崩溃 agent 循环。
        const errMsg = e?.message ?? String(e)
        store.addMessage({
          id: `msg-${Date.now()}`,
          role: 'tool',
          content: `[MCP tool ${toolName} error: ${errMsg}]`,
          tool_call_id: toolUseId,
        })
      }
      return { kind: 'continue' }
    },
    // MCP 工具归为写类（与外部进程交互），受 interactionMode 过滤。
    confirmPolicy: 'risk-based',
  }
}

/**
 * 将 MCP inputSchema 转换为 LLM tool input_schema。
 * MCP 的 JSON Schema 与 Anthropic / OpenAI 的 tool schema 形状基本一致，
 * 直接透传即可；只确保 type 为 object。
 */
function toLLMInputSchema(schema: Record<string, unknown>): object {
  if (!schema || typeof schema !== 'object') return { type: 'object' }
  const out: Record<string, unknown> = { ...schema }
  if (!out.type) out.type = 'object'
  return out
}

/**
 * 将 MCP tools/call 结果格式化为文本。
 * MCP 结果形如 { content: [{ type: 'text', text: '...' }, { type: 'image', ... }] }。
 * 提取所有 text 块拼接；非 text 块用占位符标注。
 */
function formatMCPResult(result: unknown): string {
  if (result == null) return '(no result)'
  if (typeof result === 'string') return result
  if (typeof result === 'number' || typeof result === 'boolean') return String(result)
  if (typeof result === 'object') {
    const r = result as Record<string, unknown>
    // MCP 标准：{ content: [...], isError?: bool }
    if (Array.isArray(r.content)) {
      const parts: string[] = []
      for (const block of r.content as any[]) {
        if (block && typeof block === 'object') {
          if (block.type === 'text' && typeof block.text === 'string') {
            parts.push(block.text)
          } else if (block.type === 'image') {
            parts.push('[image content omitted]')
          } else if (block.type === 'resource') {
            parts.push('[resource content omitted]')
          } else {
            parts.push(`[unknown content type: ${block.type ?? 'unknown'}]`)
          }
        }
      }
      const text = parts.join('\n')
      if (r.isError === true) return `[MCP tool reported error]\n${text}`
      return text || '(empty result)'
    }
    // 非标准形状：JSON 序列化。
    try {
      return JSON.stringify(result, null, 2)
    } catch {
      return String(result)
    }
  }
  return String(result)
}

/** 截断 MCP 结果到 10KB，防止大输出撑爆上下文。 */
function truncateForMCP(text: string): string {
  if (text.length <= MCP_RESULT_MAX_BYTES) return text
  const head = text.slice(0, MCP_RESULT_MAX_BYTES)
  return `${head}\n\n[... truncated: MCP result exceeded ${MCP_RESULT_MAX_BYTES} bytes ...]`
}