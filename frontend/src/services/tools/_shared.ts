// tools/_shared.ts — 工具共享的 helper（结果截断、格式化）。
// 从 agent.ts 提取，agent.ts 改为从这里导入，保持行为不变。

import type { ExecuteResult } from '../terminalAgent'

// F-312: cap the bytes stored in a tool message so a single tool call can't
// blow up the conversation computed. The model can still see the beginning
// and the end of long output; the in-between is dropped with a clear marker.
// 32 KB total, 8 KB head, 16 KB tail — biased to the tail because error
// messages and final state almost always live at the bottom of terminal output.
export const TOOL_RESULT_MAX_BYTES = 32 * 1024
export const TOOL_RESULT_HEAD_BYTES = 8 * 1024
export const TOOL_RESULT_TAIL_BYTES = 16 * 1024

export function capToolResult(text: string): string {
  if (text.length <= TOOL_RESULT_MAX_BYTES) return text
  const head = text.slice(0, TOOL_RESULT_HEAD_BYTES)
  const tail = text.slice(text.length - TOOL_RESULT_TAIL_BYTES)
  const omitted = text.length - TOOL_RESULT_HEAD_BYTES - TOOL_RESULT_TAIL_BYTES
  return `${head}\n\n─────── [已截断: 工具结果共 ${text.length} 字节, 已省略 ${omitted} 字节] ────────\n调整工具参数（如 head_lines / tail_lines）或分段调用以查看被截断部分。\n\n${tail}`
}

export function formatExecuteResult(result: ExecuteResult): string {
  if (!result.timedOut) {
    return `${result.output}\n\n[COMMAND COMPLETED]`
  }
  // Put the timeout guidance right after the status line so the AI sees the
  // verdict before reading the follow-up advice.
  return `${result.output}\n\n[COMMAND TIMED OUT]\n\n`
    + `⚠️ The command did not finish within the timeout and may still be running.\n`
    + `Do not resend the same command.\n`
    + `• If the output shows progress (percentages, scrolling filenames, etc.) → use collect_output to keep waiting\n`
    + `• If the output shows a password/confirmation prompt → use send_terminal_key to respond\n`
    + `• If the command is stuck and unresponsive → use interrupt_command to cancel`
}