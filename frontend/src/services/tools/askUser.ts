// tools/askUser.ts — ask_user 工具定义。

import {
  InputValidationError,
  validateRequiredString,
  validateObject,
} from '../../utils/runtimeTypeCheck'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface AskUserInput {
  question: string
  header?: string
  options: Array<{ label: string; description: string }>
  multiSelect: boolean
}

function validateAskUserInput(raw: unknown): AskUserInput {
  const obj = validateObject(raw, 'ask_user input')
  const rawOptions = obj.options
  const options: Array<{ label: string; description: string }> = []
  if (Array.isArray(rawOptions)) {
    for (const item of rawOptions) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const o = item as Record<string, unknown>
        const label = typeof o.label === 'string' ? o.label : ''
        const description = typeof o.description === 'string' ? o.description : ''
        if (label) options.push({ label, description })
      }
    }
  }
  return {
    question: validateRequiredString(obj.question, 'question'),
    header: typeof obj.header === 'string' ? obj.header : undefined,
    options,
    multiSelect: typeof obj.multiSelect === 'boolean' ? obj.multiSelect : false,
  }
}

async function execute(ctx: ToolContext, input: AskUserInput): Promise<ToolExecResult> {
  const { store, assistantMsg, toolUseId, rawInput, cleanupStreamListeners } = ctx
  const question = input.question
  const header = input.header
  const options = input.options
  const multiSelect = input.multiSelect

  store.setPendingQuestion({
    messageId: assistantMsg.id,
    toolId: toolUseId,
    question,
    header,
    options,
    multiSelect,
  })
  assistantMsg.tool_calls = [{
    id: toolUseId,
    type: 'function' as const,
    function: {
      name: 'ask_user',
      arguments: JSON.stringify(rawInput)
    }
  }]
  store.status = 'confirming'
  store.isRunning = false
  cleanupStreamListeners()
  return { kind: 'pause' }
}

export const tool: ToolDefinition = {
  name: 'ask_user',
  confirmPolicy: 'never',
  validate: validateAskUserInput,
  execute,
  schema: {
    name: 'ask_user',
    description: 'Ask the user a question with predefined options. Use this when you need the user to make a choice, confirm an action, or provide input. The user can select from your options or type a custom answer via the always-present "Other" option.',
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask the user. Be clear and specific. End with a question mark.'
        },
        header: {
          type: 'string',
          description: 'Short label displayed as a chip/tag, max 12 chars. Examples: "Auth method", "Library", "Approach".'
        },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'Display text for this option. Concise, 1-5 words.'
              },
              description: {
                type: 'string',
                description: 'Explanation of what this option means or what will happen if chosen.'
              }
            },
            required: ['label', 'description']
          },
          minItems: 2,
          maxItems: 4,
          description: 'Available choices. 2-4 options. An "Other" option is always appended automatically for custom answers.'
        },
        multiSelect: {
          type: 'boolean',
          description: 'Set to true to allow the user to select multiple options. Default false.'
        }
      },
      required: ['question', 'options']
    }
  }
}

export { InputValidationError }