// tools/executeCommand.ts — execute_command 工具定义。
// 从 agent.ts 的 if-else 分支 + llm.ts 的 schema + agent.ts 的 validator 提取。

import { executeCommand } from '../terminalAgent'
import {
  InputValidationError,
  validateRequiredString,
  validateObject,
} from '../../utils/runtimeTypeCheck'
import { capToolResult, formatExecuteResult } from './_shared'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface ExecuteCommandInput {
  command: string
  timeout: number
  head_lines: number
  tail_lines: number
  panel?: string
}

function validateExecuteCommandInput(raw: unknown): ExecuteCommandInput {
  const obj = validateObject(raw, 'execute_command input')
  return {
    command: validateRequiredString(obj.command, 'command'),
    timeout: typeof obj.timeout === 'number' && Number.isFinite(obj.timeout) && obj.timeout > 0 ? obj.timeout : 60,
    head_lines: typeof obj.head_lines === 'number' && Number.isFinite(obj.head_lines) ? obj.head_lines : 50,
    tail_lines: typeof obj.tail_lines === 'number' && Number.isFinite(obj.tail_lines) ? obj.tail_lines : 300,
    panel: typeof obj.panel === 'string' ? obj.panel : undefined,
  }
}

async function execute(ctx: ToolContext, input: ExecuteCommandInput): Promise<ToolExecResult> {
  const { store, assistantMsg, toolUseId, rawInput, cleanupStreamListeners, getRisk, shouldConfirm } = ctx
  const command = input.command
  // Honor the model-provided timeout as-is (no clamping); the validator
  // falls back to 60s when the argument is missing or invalid.
  const timeoutMs = input.timeout * 1000
  const headLines = input.head_lines
  const tailLines = input.tail_lines
  const risk = getRisk({ name: 'execute_command', input: rawInput }, command)

  if (shouldConfirm(risk)) {
    store.setPendingCommand({
      messageId: assistantMsg.id,
      toolId: toolUseId,
      toolName: 'execute_command',
      command,
      risk,
      dangerous: risk === 'dangerous'
    })
    store.status = 'confirming'
    assistantMsg.tool_calls = [{
      id: toolUseId,
      type: 'function' as const,
      function: {
        name: 'execute_command',
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
    const result = await executeCommand(command, timeoutMs, headLines, tailLines, () => store.stopRequested, panelTitle)
    if (result.cancelled || store.stopRequested) {
      store.addMessage({
        id: `msg-${Date.now()}`,
        role: 'tool',
        content: '[INTERRUPTED]'
      })
      store.isRunning = false
      cleanupStreamListeners()
      return { kind: 'stop' }
    }
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: capToolResult(formatExecuteResult(result)),
      tool_call_id: toolUseId
    })
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error executing command: ${e.message ?? e}]`,
      tool_call_id: toolUseId
    })
  }
  return { kind: 'continue' }
}

export const tool: ToolDefinition = {
  name: 'execute_command',
  confirmPolicy: 'risk-based',
  validate: validateExecuteCommandInput,
  execute,
  schema: {
    name: 'execute_command',
    description: 'Execute a shell command in the active terminal session and return its output. You MUST classify every command with a risk level. Use "timeout" to control how long to wait — short commands need less time, long tasks (builds, installs) need more.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute. Use syntax appropriate for the current shell (provided in context).'
        },
        risk: {
          type: 'string',
          enum: ['read', 'write', 'dangerous'],
          description: 'The risk level of this command:\n- "read": only inspects/views data, absolutely no modifications (e.g. ls, cat, grep, head, tail, df, du, ps, top, find, pwd, whoami, git status, git log, docker ps, npm list)\n- "write": modifies or creates data but not system-destructive (e.g. echo > file, touch, mkdir, cp, mv, git commit, curl POST, npm install, pip install)\n- "dangerous": potentially destructive or system-altering (e.g. rm, > overwrite, chmod, chown, shutdown, mkfs, dd, reboot, force push)'
        },
        timeout: {
          type: 'number',
          description: 'Maximum seconds to wait for command completion. Default 60s. Use 5-10s for quick commands (ls, cat, pwd), 30-60s for moderate tasks, 120-300s for long tasks (npm install, docker build, git clone). NEVER set below 5s.'
        },
        head_lines: {
          type: 'number',
          description: 'Number of lines to keep from the START of output when truncation occurs. Default 50. Increase to see more of the beginning.'
        },
        tail_lines: {
          type: 'number',
          description: 'Number of lines to keep from the END of output when truncation occurs. Default 300. Increase to see more recent output (errors usually at the end).'
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

// re-export for tests that import the validator directly
export { InputValidationError }