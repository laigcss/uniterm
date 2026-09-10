// tools/startCommand.ts — start_command 工具定义。

import { startCommand } from '../terminalAgent'
import {
  InputValidationError,
  validateRequiredString,
  validateObject,
} from '../../utils/runtimeTypeCheck'
import { capToolResult } from './_shared'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface StartCommandInput {
  command: string
  panel?: string
}

function validateStartCommandInput(raw: unknown): StartCommandInput {
  const obj = validateObject(raw, 'start_command input')
  return {
    command: validateRequiredString(obj.command, 'command'),
    panel: typeof obj.panel === 'string' ? obj.panel : undefined,
  }
}

async function execute(ctx: ToolContext, input: StartCommandInput): Promise<ToolExecResult> {
  const { store, assistantMsg, toolUseId, rawInput, cleanupStreamListeners, getRisk, shouldConfirm } = ctx
  const command = input.command
  const risk = getRisk({ name: 'start_command', input: rawInput }, command)

  if (shouldConfirm(risk)) {
    store.setPendingCommand({
      messageId: assistantMsg.id,
      toolId: toolUseId,
      toolName: 'start_command',
      command,
      risk,
      dangerous: risk === 'dangerous'
    })
    store.status = 'confirming'
    assistantMsg.tool_calls = [{
      id: toolUseId,
      type: 'function' as const,
      function: {
        name: 'start_command',
        arguments: JSON.stringify(rawInput)
      }
    }]
    store.isRunning = false
    cleanupStreamListeners()
    return { kind: 'pause' }
  }

  try {
    store.status = 'executing'
    const panelTitle = input.panel
    const result = await startCommand(command, panelTitle)
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: capToolResult(result.output || '(command started)'),
      tool_call_id: toolUseId
    })
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error starting command: ${e.message ?? e}]`,
      tool_call_id: toolUseId
    })
  }
  return { kind: 'continue' }
}

export const tool: ToolDefinition = {
  name: 'start_command',
  confirmPolicy: 'risk-based',
  validate: validateStartCommandInput,
  execute,
  schema: {
    name: 'start_command',
    description: 'Start a background/long-running command and return its initial output (first 3 seconds). Use this for servers (npm run dev, redis-server, python -m http.server) or any command you do NOT want to wait for. You MUST classify every command with a risk level.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to start. It will keep running after this tool returns.'
        },
        risk: {
          type: 'string',
          enum: ['read', 'write', 'dangerous'],
          description: 'The risk level of this command:\n- "read": only inspects/views data, absolutely no modifications\n- "write": modifies or creates data but not system-destructive\n- "dangerous": potentially destructive or system-altering'
        },
        panel: {
          type: 'string',
          description: 'Target panel by its title. Use the exact title from AVAILABLE PANELS in context. Omit to use the default panel.'
        }
      },
      required: ['command', 'risk']
    }
  }
}

export { InputValidationError }