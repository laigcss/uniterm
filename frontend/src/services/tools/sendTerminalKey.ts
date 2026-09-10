// tools/sendTerminalKey.ts — send_terminal_key 工具定义。

import { sendTerminalKey } from '../terminalAgent'
import {
  InputValidationError,
  validateObject,
} from '../../utils/runtimeTypeCheck'
import { capToolResult } from './_shared'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface SendTerminalKeyInput {
  input?: string
  control?: 'ctrl_c' | 'ctrl_d' | 'enter'
  send_enter: boolean
  panel?: string
}

function validateSendTerminalKeyInput(raw: unknown): SendTerminalKeyInput {
  const obj = validateObject(raw, 'send_terminal_key input')
  const control = obj.control
  let validatedControl: 'ctrl_c' | 'ctrl_d' | 'enter' | undefined
  if (control === undefined) {
    validatedControl = undefined
  } else if (control === 'ctrl_c' || control === 'ctrl_d' || control === 'enter') {
    validatedControl = control
  } else {
    throw new InputValidationError(`control must be one of ctrl_c, ctrl_d, enter`)
  }
  return {
    input: typeof obj.input === 'string' ? obj.input : undefined,
    control: validatedControl,
    send_enter: typeof obj.send_enter === 'boolean' ? obj.send_enter : true,
    panel: typeof obj.panel === 'string' ? obj.panel : undefined,
  }
}

async function execute(ctx: ToolContext, input: SendTerminalKeyInput): Promise<ToolExecResult> {
  const { store, toolUseId } = ctx
  try {
    store.status = 'executing'
    const panelTitle = input.panel
    const result = await sendTerminalKey(
      input.input,
      input.control,
      input.send_enter,
      panelTitle
    )
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: capToolResult(result.output || '(input sent)'),
      tool_call_id: toolUseId
    })
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error sending terminal input: ${e.message ?? e}]`,
      tool_call_id: toolUseId
    })
  }
  return { kind: 'continue' }
}

export const tool: ToolDefinition = {
  name: 'send_terminal_key',
  confirmPolicy: 'never',
  validate: validateSendTerminalKeyInput,
  execute,
  schema: {
    name: 'send_terminal_key',
    description: 'Send text or a control character to the active terminal. Use this ONLY when you can SEE an interactive prompt in the output (password request, y/n confirmation, etc.). NEVER guess that a prompt is there.',
    input_schema: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Text to send to the terminal (e.g., a password, "y" for confirmation, or a command fragment).'
        },
        control: {
          type: 'string',
          enum: ['ctrl_c', 'ctrl_d', 'enter'],
          description: 'Send a control character instead of text. "ctrl_c" interrupts/cancels the running command. "ctrl_d" sends EOF. "enter" sends a newline/Enter key.'
        },
        send_enter: {
          type: 'boolean',
          description: 'Whether to send an Enter/Return key after the input text to submit it. Default true. Set to false only when you need to send partial input without submitting (e.g., typing a password character by character). Ignored when using control.'
        },
        panel: {
          type: 'string',
          description: 'Target panel by its title. Use the exact title from AVAILABLE PANELS in context. Omit to use the default panel.'
        }
      }
    }
  }
}

export { InputValidationError }