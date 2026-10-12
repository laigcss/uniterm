// tools/useSkill.ts — use_skill 工具定义。

import { useSkillStore } from '../../stores/skillStore'
import { ListSkillFiles } from '../../../bindings/github.com/laigcss/ai-ops-terminal/app'
import {
  InputValidationError,
  validateRequiredString,
  validateObject,
} from '../../utils/runtimeTypeCheck'
import { capToolResult } from './_shared'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface UseSkillInput {
  name: string
}

function validateUseSkillInput(raw: unknown): UseSkillInput {
  const obj = validateObject(raw, 'use_skill input')
  return { name: validateRequiredString(obj.name, 'name') }
}

async function execute(ctx: ToolContext, input: UseSkillInput): Promise<ToolExecResult> {
  const { store, toolUseId } = ctx
  const name = input.name
  try {
    const skillStore = useSkillStore()
    const meta = skillStore.skills.find(s => s.name === name)
    if (!meta) throw new Error(`skill "${name}" not found`)
    if (!meta.enabled) throw new Error(`skill "${name}" is disabled`)
    if (!meta.modelInvocable) throw new Error(`skill "${name}" is not model-invocable; the user must run it manually via /${name}`)
    const body = await skillStore.getBody(name)
    const files = await ListSkillFiles(name)
    store.addSkillCard(name, 'auto')
    const manifest = [
      body,
      files.references.length ? `\n\nREFERENCES:\n${files.references.map((f: string) => `- ${f}`).join('\n')}` : '',
      files.scripts.length ? `\n\nSCRIPTS:\n${files.scripts.map((f: string) => `- ${f}`).join('\n')}` : '',
    ].join('')
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: capToolResult(`[Skill loaded: ${name}]\n${manifest}`),
      tool_call_id: toolUseId
    })
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error loading skill: ${e.message ?? e}]`,
      tool_call_id: toolUseId
    })
  }
  return { kind: 'continue' }
}

export const tool: ToolDefinition = {
  name: 'use_skill',
  confirmPolicy: 'never',
  validate: validateUseSkillInput,
  execute,
  schema: {
    name: 'use_skill',
    description: 'Load the full instructions (body) of an available skill, plus a manifest of its bundled reference docs and scripts. Call this when a skill from AVAILABLE SKILLS matches the current task, BEFORE acting on it. Scripts are returned as text; to run one, read it with read_skill_file then execute it via execute_command in the target terminal.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The skill name from AVAILABLE SKILLS (without the leading /).' }
      },
      required: ['name']
    }
  }
}

export { InputValidationError }