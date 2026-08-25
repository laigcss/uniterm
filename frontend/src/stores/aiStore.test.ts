import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// ---- mock wails + i18n so the store module can be imported ----
vi.mock('@wailsio/runtime', () => ({
  Events: { On: vi.fn(() => () => {}), Off: vi.fn() },
}))
vi.mock('../../bindings/github.com/ys-ll/uniterm/app', () => ({
  SaveAIConfig: vi.fn().mockResolvedValue(undefined),
  LoadAIConfig: vi.fn().mockResolvedValue({}),
  SaveAISessions: vi.fn().mockResolvedValue(undefined),
  LoadAISessions: vi.fn().mockResolvedValue({ sessions: [], currentSessionId: null }),
  SaveLocalState: vi.fn().mockResolvedValue(undefined),
  LoadLocalState: vi.fn().mockResolvedValue({}),
}))
vi.mock('../i18n', () => ({ t: (k: string) => k }))

import { useAIStore } from './aiStore'

describe('aiStore message queue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('enqueues trimmed messages', () => {
    const store = useAIStore()
    store.enqueueMessage('  hello  ')
    expect(store.queuedMessages).toHaveLength(1)
    expect(store.queuedMessages[0].content).toBe('hello')
    expect(store.queuedMessages[0].id).toBeTruthy()
  })

  it('ignores empty / whitespace-only input', () => {
    const store = useAIStore()
    store.enqueueMessage('')
    store.enqueueMessage('   ')
    expect(store.queuedMessages).toHaveLength(0)
  })

  it('keeps insertion order for multiple messages', () => {
    const store = useAIStore()
    store.enqueueMessage('first')
    store.enqueueMessage('second')
    expect(store.queuedMessages.map(q => q.content)).toEqual(['first', 'second'])
  })

  it('removes a queued message by id', () => {
    const store = useAIStore()
    store.enqueueMessage('a')
    store.enqueueMessage('b')
    const id = store.queuedMessages[0].id
    store.removeQueuedMessage(id)
    expect(store.queuedMessages.map(q => q.content)).toEqual(['b'])
  })

  it('clearQueue empties the queue', () => {
    const store = useAIStore()
    store.enqueueMessage('a')
    store.clearQueue()
    expect(store.queuedMessages).toHaveLength(0)
  })

  it('stop() clears the queue', () => {
    const store = useAIStore()
    store.enqueueMessage('a')
    store.stop()
    expect(store.queuedMessages).toHaveLength(0)
    expect(store.stopRequested).toBe(true)
  })

  it('createSession() clears the queue', () => {
    const store = useAIStore()
    store.enqueueMessage('a')
    store.createSession()
    expect(store.queuedMessages).toHaveLength(0)
  })

  it('switchSession() clears the queue', () => {
    const store = useAIStore()
    store.createSession()               // creates session A (currentSessionId = A)
    const sessionA = store.currentSessionId!
    store.createSession()               // creates session B, now current
    store.enqueueMessage('pending')
    // confirm we switch to an existing session (successful-switch path, not early return)
    expect(store.sessions.some(s => s.id === sessionA)).toBe(true)
    store.switchSession(sessionA)       // switching sessions must clear the queue
    expect(store.currentSessionId).toBe(sessionA)
    expect(store.queuedMessages).toHaveLength(0)
  })
})

describe('aiStore conversation memoization (F-301)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('returns the same conversation reference until the version bumps', async () => {
    const store = useAIStore()
    store.createSession()
    store.addMessage({ id: 'm1', role: 'user', content: 'hello' } as any)
    await nextTick()

    const first = store.conversation
    expect(first).toBeDefined()
    expect(first.length).toBe(1)

    // Mutate the existing message (simulate per-token content +=)
    const msg = store.messages[0]
    msg.content = 'hello world'
    await nextTick()

    // Conversation reference should be stable — version hasn't bumped
    expect(store.conversation).toBe(first)

    // addMessage bumps version -> new reference
    store.addMessage({ id: 'm2', role: 'assistant', content: 'hi' } as any)
    await nextTick()
    expect(store.conversation).not.toBe(first)
  })

  // agent.ts builds its request body synchronously right after addMessage(),
  // with no await in between. The F-301 rebuild therefore has to run on a sync
  // watch flush; with Vue's default 'pre' flush the first turn shipped an empty
  // messages array (and later turns lagged one message behind), which the
  // OpenAI Responses API rejects as a missing `input` parameter.
  it('reflects a new message synchronously, without awaiting a tick', () => {
    const store = useAIStore()
    store.createSession()
    store.addMessage({ id: 'm1', role: 'user', content: 'first question' } as any)

    expect(store.conversation).toEqual([
      { role: 'user', content: 'first question' },
    ])
  })

  it('does not lag a turn behind across successive sends', async () => {
    const store = useAIStore()
    store.createSession()

    store.addMessage({ id: 'm1', role: 'user', content: 'first' } as any)
    expect(store.conversation).toHaveLength(1)

    // Simulates the `await chat(...)` between agent turns.
    await new Promise(resolve => setTimeout(resolve, 0))

    store.addMessage({ id: 'm2', role: 'assistant', content: 'reply' } as any)
    store.addMessage({ id: 'm3', role: 'user', content: 'second' } as any)
    expect(store.conversation.map(m => m.content)).toEqual([
      'first',
      'reply',
      'second',
    ])
  })
})

// An assistant message carrying a tool_use is built *before* the tool message
// that resolves it. Collecting resolvedIds inside the same forward pass meant
// the tool_use looked dangling and was dropped, and the mirror pass then
// dropped the orphaned tool_result — erasing entire tool roundtrips, so the
// model could not see the commands it ran or their output. On the Responses
// API the resulting assistant-tailed payload was rejected outright.
describe('aiStore keeps completed tool roundtrips in the payload', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function addToolTurn(store: any, toolId: string, command: string, output: string) {
    const assistant = store.addMessage({ id: `a-${toolId}`, role: 'assistant', content: '' } as any)
    assistant._rawApiMsg = {
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolId, name: 'execute_command', input: { command } }],
    }
    store.addMessage({
      id: `t-${toolId}`,
      role: 'tool',
      content: output,
      tool_call_id: toolId,
    } as any)
  }

  it('emits assistant tool_use paired with a user tool_result', () => {
    const store = useAIStore()
    store.createSession()
    store.addMessage({ id: 'u1', role: 'user', content: 'run ls' } as any)
    addToolTurn(store, 'tu1', 'ls', 'file.txt')

    expect(store.conversation).toEqual([
      { role: 'user', content: 'run ls' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'execute_command', input: { command: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file.txt' }],
      },
    ])
  })

  it('keeps every roundtrip across a multi-step agent turn', () => {
    const store = useAIStore()
    store.createSession()
    store.addMessage({ id: 'u1', role: 'user', content: 'do the thing' } as any)
    addToolTurn(store, 't1', 'step-one', 'out-1')
    addToolTurn(store, 't2', 'step-two', 'out-2')
    addToolTurn(store, 't3', 'step-three', 'out-3')

    // 1 user + 3 × (assistant tool_use + user tool_result)
    expect(store.conversation).toHaveLength(7)
    expect(store.conversation.map(m => m.role)).toEqual([
      'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user',
    ])
  })

  it('does not end the payload with an assistant message after a tool turn', () => {
    const store = useAIStore()
    store.createSession()
    store.addMessage({ id: 'u1', role: 'user', content: 'run ls' } as any)
    addToolTurn(store, 'tu1', 'ls', 'file.txt')

    // The OpenAI Responses API rejects a trailing assistant message.
    expect(store.conversation[store.conversation.length - 1].role).toBe('user')
  })

  it('resolves legacy tool_calls messages the same way', () => {
    const store = useAIStore()
    store.createSession()
    store.addMessage({ id: 'u1', role: 'user', content: 'q' } as any)
    store.addMessage({
      id: 'a1',
      role: 'assistant',
      content: 'checking',
      tool_calls: [{
        id: 'lc1',
        type: 'function',
        function: { name: 'execute_command', arguments: '{"command":"ls"}' },
      }],
    } as any)
    store.addMessage({ id: 't1', role: 'tool', content: 'out', tool_call_id: 'lc1' } as any)

    expect(store.conversation).toEqual([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 'lc1', name: 'execute_command', input: { command: 'ls' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'lc1', content: 'out' }] },
    ])
  })

  it('still drops a tool message that carries no tool_call_id', () => {
    const store = useAIStore()
    store.createSession()
    store.addMessage({ id: 'u1', role: 'user', content: 'q' } as any)
    store.addMessage({ id: 'a1', role: 'assistant', content: 'partial' } as any)
    store.addMessage({ id: 't1', role: 'tool', content: '[INTERRUPTED]' } as any)

    // Display-only; it has no tool_use to pair with.
    expect(store.conversation).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'partial' },
    ])
  })
})

describe('aiStore lazy _rawApiMsg parse (F-316)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('parses _rawApiMsg only on switchSession, not at load time', async () => {
    const raw = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
    const rawJson = JSON.stringify(raw)
    const { LoadAISessions } = await import('../../bindings/github.com/ys-ll/uniterm/app')
    vi.mocked(LoadAISessions).mockResolvedValue({
      sessions: [{
        id: 's1',
        name: 's1',
        createdAt: 0,
        updatedAt: 0,
        messages: [{ id: 'm1', role: 'assistant', content: 'ok', _rawApiMsg: rawJson }]
      }],
      currentSessionId: 's1'
    })

    const store = useAIStore()
    // We bypass init() and feed sessions directly to isolate the lazy-parse path
    // init() always creates a fresh session ("Always start with a fresh session
    // after restart"), so the lazy parse path is owned by switchSession().
    store.sessions.push({
      id: 's1',
      name: 's1',
      createdAt: 0,
      updatedAt: 0,
      messages: [{ id: 'm1', role: 'assistant', content: 'ok', _rawApiMsg: rawJson } as any]
    })
    expect(typeof store.sessions[0].messages[0]._rawApiMsg).toBe('string')

    store.switchSession('s1')

    // After switchSession, _rawApiMsg is parsed in place
    expect(typeof store.sessions[0].messages[0]._rawApiMsg).toBe('object')
    expect(store.sessions[0].messages[0]._rawApiMsg).toEqual(raw)
  })
})

describe('aiStore doSave debounce (F-304)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  it('coalesces a burst of addMessage calls into a single save', async () => {
    const { SaveAISessions } = await import('../../bindings/github.com/ys-ll/uniterm/app')
    vi.mocked(SaveAISessions).mockClear()

    const store = useAIStore()
    store.createSession()
    store.addMessage({ id: 'm1', role: 'user', content: 'one' } as any)
    store.addMessage({ id: 'm2', role: 'assistant', content: 'two' } as any)
    store.addMessage({ id: 'm3', role: 'user', content: 'three' } as any)

    // No save has fired yet — debounce timer is pending
    expect(vi.mocked(SaveAISessions)).not.toHaveBeenCalled()

    // Advance past the 500ms debounce window
    await vi.advanceTimersByTimeAsync(500)

    expect(vi.mocked(SaveAISessions)).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })

  it('renameSession flushes immediately and cancels pending debounce', async () => {
    const { SaveAISessions } = await import('../../bindings/github.com/ys-ll/uniterm/app')
    vi.mocked(SaveAISessions).mockClear()

    const store = useAIStore()
    store.createSession()
    const sessionId = store.currentSessionId!
    store.addMessage({ id: 'm1', role: 'user', content: 'one' } as any)

    // renameSession should hit the bridge without waiting 500ms
    store.renameSession(sessionId, 'renamed')
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(SaveAISessions)).toHaveBeenCalledTimes(1)

    // Advancing past the debounce window must NOT cause a second save
    await vi.advanceTimersByTimeAsync(500)
    expect(vi.mocked(SaveAISessions)).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
