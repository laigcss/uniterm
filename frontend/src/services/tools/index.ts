// tools/index.ts — 工具注册表。
//
// 自动收集所有工具定义到 toolRegistry；AVAILABLE_TOOLS 由注册表派生，
// 消除 llm.ts schema / agent.ts validator / agent.ts dispatch 三处耦合。
// 加工具只需新增一个 xxx.ts 文件并在此 import + register。

import type { ToolDefinition, ToolSchema } from './types'

import { tool as executeCommandTool } from './executeCommand'
import { tool as startCommandTool } from './startCommand'
import { tool as captureTerminalTool } from './captureTerminal'
import { tool as collectOutputTool } from './collectOutput'
import { tool as sendTerminalKeyTool } from './sendTerminalKey'
import { tool as interruptCommandTool } from './interruptCommand'
import { tool as askUserTool } from './askUser'
import { tool as saveSkillTool } from './saveSkill'
import { tool as useSkillTool } from './useSkill'
import { tool as readSkillFileTool } from './readSkillFile'

// toolRegistry 是所有已注册工具的 Map，按 name 索引。
// runAgent 用 toolRegistry.get(tu.name) 查找并执行。
export const toolRegistry = new Map<string, ToolDefinition>()

function register(t: ToolDefinition) {
  toolRegistry.set(t.name, t)
}

register(executeCommandTool)
register(startCommandTool)
register(captureTerminalTool)
register(collectOutputTool)
register(sendTerminalKeyTool)
register(interruptCommandTool)
register(askUserTool)
register(saveSkillTool)
register(useSkillTool)
register(readSkillFileTool)

// AVAILABLE_TOOLS 是发给 LLM 的工具 schema 列表，由注册表自动派生。
// llm.ts 从这里导入，不再手写一份。
export const AVAILABLE_TOOLS: ToolSchema[] = Array.from(toolRegistry.values()).map(t => t.schema)

// F1: 工具分类集合 — agent.ts 按 interactionMode 过滤工具时使用。
//
// 分类语义（与 RiskLevel 互补：RiskLevel 是单次命令的运行时风险，这里是
// 工具本身的静态能力类别）：
//   - READ_ONLY_TOOLS   : 纯查看/被动监听，不改变终端/系统状态
//   - WRITE_TOOLS       : 会修改文件系统/系统状态/会话的写类工具
//   - DANGEROUS_TOOLS   : 高危执行类（启动后台进程、发送按键、中断命令）
//   - EXECUTION_TOOLS   : 所有会触发命令执行或改变终端状态的工具（chat 模式禁用）
//
// ask_user / read_skill_file / use_skill 属于 safe 类，不在下列集合中，
// 任何模式都放行。save_skill 归入 WRITE_TOOLS（会落盘 skill 文件）。
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'capture_terminal',
  'collect_output',
  'read_skill_file',
])

export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'save_skill',
])

export const DANGEROUS_TOOLS: ReadonlySet<string> = new Set([
  'start_command',
  'send_terminal_key',
  'interrupt_command',
])

// chat 模式禁用的执行类工具集合（含写+危险+命令执行）。
// execute_command 同时能读能写，按命令本身风险无法静态判定，故 chat 一律禁用。
export const EXECUTION_TOOLS: ReadonlySet<string> = new Set([
  'execute_command',
  'start_command',
  'send_terminal_key',
  'interrupt_command',
  'save_skill',
  'use_skill',
])

// re-export types for callers
export type { ToolDefinition, ToolContext, ToolExecResult, ToolSchema, RiskLevel, ConfirmPolicy } from './types'