// tools/interruptCommand.ts — interrupt_command 工具定义。

import { sendTerminalKey } from '../terminalAgent'
import { capToolResult } from './_shared'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface InterruptCommandInput {
  panel?: string
}

function validateInterruptCommandInput(raw: unknown): InterruptCommandInput {
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    panel: typeof obj.panel === 'string' ? obj.panel : undefined,
  }
}

async function execute(ctx: ToolContext, input: InterruptCommandInput): Promise<ToolExecResult> {
  const { store, toolUseId } = ctx
  try {
    store.status = 'executing'
    const panelTitle = input.panel
    const result = await sendTerminalKey(undefined, 'ctrl_c', true, panelTitle)
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: capToolResult(result.output || 'Sent Ctrl+C to interrupt the running command.'),
      tool_call_id: toolUseId
    })
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error sending Ctrl+C: ${e.message ?? e}]`,
      tool_call_id: toolUseId
    })
  }
  return { kind: 'continue' }
}

export const tool: ToolDefinition = {
  name: 'interrupt_command',
  confirmPolicy: 'never',
  validate: validateInterruptCommandInput,
  execute,
  schema: {
    name: 'interrupt_command',
    description: 'Send Ctrl+C to cancel the currently running command. Use this when a command is stuck, hanging, or needs to be stopped before running a different command.',
    input_schema: {
      type: 'object',
      properties: {
        panel: {
          type: 'string',
          description: 'Target panel by its title. Use the exact title from AVAILABLE PANELS in context. Omit to use the default panel.'
        }
      }
    }
  }
}