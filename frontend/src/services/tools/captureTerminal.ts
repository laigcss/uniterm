// tools/captureTerminal.ts — capture_terminal 工具定义。

import { captureTerminal } from '../terminalAgent'
import { capToolResult } from './_shared'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface CaptureTerminalInput {
  tail_lines: number
  panel?: string
}

function validateCaptureTerminalInput(raw: unknown): CaptureTerminalInput {
  // 原代码无显式 validate（直接 tu.input.tail_lines as number ?? 200），
  // 这里保持同等行为：passthrough + 默认值。
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    tail_lines: typeof obj.tail_lines === 'number' ? obj.tail_lines : 200,
    panel: typeof obj.panel === 'string' ? obj.panel : undefined,
  }
}

async function execute(ctx: ToolContext, input: CaptureTerminalInput): Promise<ToolExecResult> {
  const { store, toolUseId } = ctx
  const tailLines = input.tail_lines
  try {
    store.status = 'executing'
    const panelTitle = input.panel
    const result = captureTerminal(tailLines, panelTitle)
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: capToolResult(result.output || '(terminal is empty)'),
      tool_call_id: toolUseId
    })
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error capturing terminal: ${e.message ?? e}]`,
      tool_call_id: toolUseId
    })
  }
  return { kind: 'continue' }
}

export const tool: ToolDefinition = {
  name: 'capture_terminal',
  confirmPolicy: 'never',
  validate: validateCaptureTerminalInput,
  execute,
  schema: {
    name: 'capture_terminal',
    description: 'Take an instant snapshot of the terminal screen. Use this to check what is currently visible without running any command. Useful after a command times out or returns, to see if the shell prompt is back or to read error messages on screen.',
    input_schema: {
      type: 'object',
      properties: {
        tail_lines: {
          type: 'number',
          description: 'Lines from the bottom of the buffer. Default 200. Increase to see more of the recent output.'
        },
        panel: {
          type: 'string',
          description: 'Target panel by its title. Use the exact title from AVAILABLE PANELS in context. Omit to use the default panel.'
        }
      }
    }
  }
}