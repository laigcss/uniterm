// tools/collectOutput.ts — collect_output 工具定义。

import { collectOutput } from '../terminalAgent'
import { capToolResult } from './_shared'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface CollectOutputInput {
  timeout: number
  head_lines: number
  tail_lines: number
  panel?: string
}

function validateCollectOutputInput(raw: unknown): CollectOutputInput {
  // 原代码无显式 validate（直接 tu.input.timeout as number || 30 等），
  // 这里保持同等行为：passthrough + 默认值。
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    timeout: (typeof obj.timeout === 'number' && obj.timeout) || 30,
    head_lines: typeof obj.head_lines === 'number' ? obj.head_lines : 100,
    tail_lines: typeof obj.tail_lines === 'number' ? obj.tail_lines : 300,
    panel: typeof obj.panel === 'string' ? obj.panel : undefined,
  }
}

async function execute(ctx: ToolContext, input: CollectOutputInput): Promise<ToolExecResult> {
  const { store, toolUseId, cleanupStreamListeners } = ctx
  const timeoutMs = input.timeout * 1000
  const headLines = input.head_lines
  const tailLines = input.tail_lines
  try {
    store.status = 'executing'
    const panelTitle = input.panel
    const result = await collectOutput(timeoutMs, headLines, tailLines, () => store.stopRequested, panelTitle)
    if (store.stopRequested) {
      store.addMessage({
        id: `msg-${Date.now()}`,
        role: 'tool',
        content: '[INTERRUPTED]'
      })
      store.isRunning = false
      cleanupStreamListeners()
      return { kind: 'stop' }
    }
    const status = result.completed ? '[COMMAND COMPLETED]' : '[COMMAND STILL RUNNING]'
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: capToolResult(`${result.output}\n\n${status}`),
      tool_call_id: toolUseId
    })
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error collecting output: ${e.message ?? e}]`,
      tool_call_id: toolUseId
    })
  }
  return { kind: 'continue' }
}

export const tool: ToolDefinition = {
  name: 'collect_output',
  confirmPolicy: 'never',
  validate: validateCollectOutputInput,
  execute,
  schema: {
    name: 'collect_output',
    description: 'Wait and collect terminal output WITHOUT sending any command or text to the terminal. Pure passive listening. Use this when a command is still running and you want to wait for more output. You can call this repeatedly to wait in stages.',
    input_schema: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: 'Seconds to wait. Default 30s. Use 15-30s for active progress checks, 60-120s for slower operations.'
        },
        head_lines: {
          type: 'number',
          description: 'Head lines to keep on truncation. Default 100.'
        },
        tail_lines: {
          type: 'number',
          description: 'Tail lines to keep on truncation. Default 300.'
        },
        panel: {
          type: 'string',
          description: 'Target panel by its title. Use the exact title from AVAILABLE PANELS in context. Omit to use the default panel.'
        }
      }
    }
  }
}