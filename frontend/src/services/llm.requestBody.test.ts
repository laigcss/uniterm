// Regression tests for the request body chat() sends to the Go backend.
//
// F-319 originally built the JSON by string concatenation around a cached
// prefix that hardcoded AVAILABLE_TOOLS. That had two defects:
//   1. options.tools was ignored entirely, so the DB assistant lost
//      get_table_schema and the Mongo / completion callers (which pass no
//      tools) were handed ten irrelevant terminal tools.
//   2. JSON.stringify(undefined) returns undefined, not a string, so a
//      missing `system` produced `"system":undefined` — invalid JSON.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const ChatCompletion = vi.fn()

vi.mock('../../bindings/github.com/ys-ll/uniterm/app', () => ({
  ChatCompletion: (...args: unknown[]) => ChatCompletion(...args),
}))

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: () => ({
    activeModel: {
      apiKey: 'test-key',
      baseURL: 'https://example.test',
      model: 'test-model',
      protocol: 'responses',
      userAgent: '',
    },
  }),
}))

import { chat, AVAILABLE_TOOLS } from './llm'

// chat() resolves by parsing the backend's reply; return a minimal valid
// Anthropic-shaped message so it completes without throwing.
function stubReply() {
  ChatCompletion.mockResolvedValue(
    JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }),
  )
}

// The request JSON is the 4th positional arg of ChatCompletion.
function sentBody(): any {
  const requestJSON = ChatCompletion.mock.calls[0][3] as string
  return JSON.parse(requestJSON)
}

describe('chat() request body', () => {
  beforeEach(() => {
    ChatCompletion.mockReset()
    stubReply()
  })

  it('passes the caller-supplied tools through instead of AVAILABLE_TOOLS', async () => {
    const tools = [
      {
        name: 'get_table_schema',
        description: 'Get column definitions.',
        input_schema: { type: 'object' as const, properties: {}, required: [] },
      },
    ]

    await chat({ system: 'db assistant', messages: [{ role: 'user', content: 'q' }], tools })

    const body = sentBody()
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].name).toBe('get_table_schema')
  })

  it('omits tools entirely when the caller passes none', async () => {
    await chat({ system: 'mongo assistant', messages: [{ role: 'user', content: 'q' }] })

    expect(sentBody()).not.toHaveProperty('tools')
  })

  it('still sends the full agent tool set when given AVAILABLE_TOOLS', async () => {
    await chat({
      system: 'agent',
      messages: [{ role: 'user', content: 'q' }],
      tools: AVAILABLE_TOOLS as any,
    })

    const body = sentBody()
    expect(body.tools).toHaveLength(AVAILABLE_TOOLS.length)
    expect(body.tools.map((t: any) => t.name)).toContain('execute_command')
    // cache_control breakpoint rides on the last tool for Anthropic caching.
    expect(body.tools[body.tools.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('produces valid JSON even when system is undefined', async () => {
    await chat({
      system: undefined as unknown as string,
      messages: [{ role: 'user', content: 'q' }],
    })

    // Would have thrown in sentBody() on `"system":undefined`.
    expect(() => sentBody()).not.toThrow()
    expect(sentBody().messages).toEqual([{ role: 'user', content: 'q' }])
  })

  it('does not corrupt the body when a message contains JSON-like text', async () => {
    const tricky = '"}],"tools":[{"name":"injected"}]'
    await chat({
      system: 'agent',
      messages: [{ role: 'user', content: tricky }],
      tools: AVAILABLE_TOOLS as any,
    })

    const body = sentBody()
    expect(body.messages[0].content).toBe(tricky)
    expect(body.tools.map((t: any) => t.name)).not.toContain('injected')
  })

  it('sends model and max_tokens', async () => {
    await chat({ system: 's', messages: [{ role: 'user', content: 'q' }] })

    const body = sentBody()
    expect(body.model).toBe('test-model')
    expect(body.max_tokens).toBe(16384)
  })
})
