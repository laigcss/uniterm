// tools/types.ts — A3 重构：统一工具定义接口。
//
// 原来 agent.ts 的 runAgent 是一条 628 行巨型 if-else 链，每工具一分支；
// llm.ts 的 AVAILABLE_TOOLS schema 与 agent.ts 的 validator / dispatch 分支
// 三处耦合，加工具需改三处（shotgun surgery）。
//
// 现在每工具一个文件，导出 ToolDefinition；index.ts 自动收集到 toolRegistry；
// agent.ts runAgent 改为 toolRegistry.get(name).execute(ctx, input)；
// llm.ts AVAILABLE_TOOLS 由注册表自动生成。加工具只需新增一个文件。

import type { AIMessage } from '../../types/ai'

// 风险等级（从 agent.ts 提取，保持 getRisk/VALID_RISK 行为不变）
export type RiskLevel = 'read' | 'write' | 'dangerous'

// 工具的 JSON schema（发给 LLM 的工具定义）
export interface ToolSchema {
  name: string
  description: string
  input_schema: object
}

// runAgent 传给工具执行的上下文。包含工具可能需要的所有 store / 消息 / helper，
// 工具通过 ctx 完成确认、addMessage、cleanup 等副作用，不直接 import agent.ts 内部。
export interface ToolContext {
  /** AI store（消息、状态、pending 等） */
  store: any
  /** 当前 assistant 消息（用于设置 tool_calls 等） */
  assistantMsg: AIMessage
  /** 当前 tool_use 的 id */
  toolUseId: string
  /** 原始 tool_use input（未验证） */
  rawInput: Record<string, unknown>
  /** 工具结果截断 helper（32KB 上限） */
  capToolResult: (text: string) => string
  /** 清理 token listener + 设置 isRunning=false 的统一出口 */
  cleanupStreamListeners: () => void
  /** getRisk（execute_command/start_command 确认逻辑用） */
  getRisk: (tu: { name: string; input: Record<string, unknown> }, command?: string) => RiskLevel
  /** shouldConfirm（根据 store.mode + risk 决定是否需要用户确认） */
  shouldConfirm: (risk: RiskLevel) => boolean
}

// 工具 execute 的返回值，告诉 runAgent 下一步做什么。
//   - 'pause'  : 工具请求暂停 runAgent（如等待用户确认命令/问题），runAgent 应 return
//   - 'continue': 工具完成，runAgent 应继续下一轮循环
//   - 'stop'   : 工具完成且 runAgent 应停止（如 interrupted），runAgent 应 return
export interface ToolExecResult {
  kind: 'pause' | 'continue' | 'stop'
}

// 确认策略（文档性元数据；实际确认逻辑在 execute 内部用 ctx.getRisk/shouldConfirm 实现）
//   - 'never'     : 不需要确认（读类工具）
//   - 'risk-based' : 根据 risk level + store.mode 动态决定（execute_command/start_command）
export type ConfirmPolicy = 'never' | 'risk-based'

// 统一工具定义。每工具一个文件导出 ToolDefinition，index.ts 收集到 toolRegistry。
export interface ToolDefinition {
  name: string
  schema: ToolSchema
  /** 验证 input，返回验证后的值；throw InputValidationError 如果无效 */
  validate: (input: unknown) => any
  /** 执行工具，返回 ToolExecResult 告诉 runAgent 下一步 */
  execute: (ctx: ToolContext, input: any) => Promise<ToolExecResult>
  /** 确认策略（文档性元数据） */
  confirmPolicy?: ConfirmPolicy
}