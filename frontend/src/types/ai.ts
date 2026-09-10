export type ExecutionMode = 'confirm_all' | 'confirm_write' | 'confirm_dangerous' | 'bypass'

/**
 * F1: AI 交互模式（与 ExecutionMode 正交的总体能力开关）。
 *   - 'chat'     : 纯对话，禁用所有执行类工具，仅可查看终端输出与回答问题
 *   - 'readonly' : 只读，仅允许读类工具，写/危险命令一律拒绝
 *   - 'agent'    : 全自主，走现有 risk + 确认模式（ExecutionMode）逻辑
 * 默认 'agent'，保持与改动前行为完全一致。
 */
export type InteractionMode = 'chat' | 'readonly' | 'agent'

export type AIAgentStatus = 'thinking' | 'outputting' | 'executing' | 'confirming'

export interface AIConfig {
  apiKey: string
  baseURL: string
  model: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolResult {
  tool_call_id: string
  role: 'tool'
  content: string
}

export interface PendingTool {
  id: string
  name: string
  arguments: Record<string, unknown>
  dangerous: boolean
}

export interface AIMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  _rawApiMsg?: Record<string, unknown>  // exact message from API, passed back verbatim
  _contextHeader?: string  // dynamic context prepended in API requests but hidden in UI
  tool_calls?: ToolCall[]
  tool_call_id?: string
  pendingTools?: PendingTool[]
  needsContinue?: boolean  // UI-only: max turns reached, prompt user to continue
  skillName?: string       // 显式调用的 skill 名（对话卡片渲染用）
  skillSource?: string     // 'explicit' | 'auto'
  commandName?: string     // 显式调用的 command 名（对话卡片渲染用）
  commandArgs?: string
}

export interface AISession {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  messages: AIMessage[]
}
