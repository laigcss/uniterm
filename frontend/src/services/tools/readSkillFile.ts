// tools/readSkillFile.ts — read_skill_file 工具定义。

import { GetSkillFile } from '../../../bindings/github.com/ys-ll/uniterm/app'
import {
  InputValidationError,
  validateRequiredString,
  validateObject,
} from '../../utils/runtimeTypeCheck'
import { capToolResult } from './_shared'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface ReadSkillFileInput {
  name: string
  path: string
}

function validateReadSkillFileInput(raw: unknown): ReadSkillFileInput {
  const obj = validateObject(raw, 'read_skill_file input')
  return {
    name: validateRequiredString(obj.name, 'name'),
    path: validateRequiredString(obj.path, 'path'),
  }
}

async function execute(ctx: ToolContext, input: ReadSkillFileInput): Promise<ToolExecResult> {
  const { store, toolUseId } = ctx
  const name = input.name
  const path = input.path
  try {
    const content = await GetSkillFile(name, path)
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: capToolResult(`[Skill file: ${name}/${path}]\n${content}`),
      tool_call_id: toolUseId
    })
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error reading skill file: ${e.message ?? e}]`,
      tool_call_id: toolUseId
    })
  }
  return { kind: 'continue' }
}

export const tool: ToolDefinition = {
  name: 'read_skill_file',
  confirmPolicy: 'never',
  validate: validateReadSkillFileInput,
  execute,
  schema: {
    name: 'read_skill_file',
    description: 'Read a single bundled file of a skill (a reference doc or a script) as text. Use after use_skill to fetch a specific file listed in its manifest.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name.' },
        path: { type: 'string', description: 'Relative path inside the skill dir, as listed by use_skill (e.g. "references/guide.md" or "scripts/check.sh").' }
      },
      required: ['name', 'path']
    }
  }
}

export { InputValidationError }