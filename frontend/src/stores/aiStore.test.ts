import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// ---- mock wails + i18n so the store module can be imported ----
vi.mock('../../wailsjs/runtime', () => ({
  EventsOn: vi.fn(() => () => {}),
}))
vi.mock('../../wailsjs/go/main/App', () => ({
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
})

describe('aiStore lazy _rawApiMsg parse (F-316)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('parses _rawApiMsg only on switchSession, not at load time', async () => {
    const raw = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
    const rawJson = JSON.stringify(raw)
    const { LoadAISessions } = await import('../../wailsjs/go/main/App')
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
    const { SaveAISessions } = await import('../../wailsjs/go/main/App')
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
    const { SaveAISessions } = await import('../../wailsjs/go/main/App')
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
