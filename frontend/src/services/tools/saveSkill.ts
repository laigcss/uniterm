// tools/saveSkill.ts — save_skill 工具定义。

import { useSkillStore } from '../../stores/skillStore'
import {
  InputValidationError,
  validateRequiredString,
  validateObject,
} from '../../utils/runtimeTypeCheck'
import type { ToolDefinition, ToolContext, ToolExecResult } from './types'

interface SaveSkillInput {
  name: string
  description: string
  body: string
}

function validateSaveSkillInput(raw: unknown): SaveSkillInput {
  const obj = validateObject(raw, 'save_skill input')
  return {
    name: validateRequiredString(obj.name, 'name'),
    description: validateRequiredString(obj.description, 'description'),
    body: validateRequiredString(obj.body, 'body'),
  }
}

async function execute(ctx: ToolContext, input: SaveSkillInput): Promise<ToolExecResult> {
  const { store, toolUseId } = ctx
  const name = input.name
  const description = input.description
  const body = input.body
  try {
    store.status = 'executing'
    const skillStore = useSkillStore()
    await skillStore.saveByAgent(name, description, body)
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Skill saved: ${name}] The user can now invoke it with /${name}.`,
      tool_call_id: toolUseId
    })
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error saving skill: ${e.message ?? e}]`,
      tool_call_id: toolUseId
    })
  }
  return { kind: 'continue' }
}

export const tool: ToolDefinition = {
  name: 'save_skill',
  confirmPolicy: 'never',
  validate: validateSaveSkillInput,
  execute,
  schema: {
    name: 'save_skill',
    description: 'Create or update a reusable skill (a command-line workflow / SOP) so it can be invoked later via /name. Use this when the user asks to save the current approach as a skill, or when you and the user just worked out a repeatable command-line procedure worth keeping. Write a thin skill: only include steps the model would NOT do by default, use imperative steps, state clearly in the description what it does AND when to use it. Locked skills cannot be overwritten.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill identifier in kebab-case (lowercase letters, digits, hyphens), e.g. "git-clean-branches". This becomes the /trigger.'
        },
        description: {
          type: 'string',
          description: 'One line: what the skill does AND when to use it (drives matching). E.g. "Clean up merged local git branches. Use when the user wants to delete/tidy git branches."'
        },
        body: {
          type: 'string',
          description: 'The skill instructions as markdown (imperative steps). Do NOT include YAML frontmatter — name/description are passed separately.'
        }
      },
      required: ['name', 'description', 'body']
    }
  }
}

export { InputValidationError }