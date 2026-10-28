// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'

const { isMobileMock, startKeepAliveMock, stopKeepAliveMock, sessionStoreMock } = vi.hoisted(() => ({
  isMobileMock: vi.fn(),
  startKeepAliveMock: vi.fn(),
  stopKeepAliveMock: vi.fn(),
  sessionStoreMock: {
    sessions: new Map<string, any>(),
    getStatus: vi.fn(() => 'disconnected'),
  },
}))

vi.mock('../utils/platform', () => ({
  isMobilePlatform: isMobileMock,
  detectPlatformSync: vi.fn(() => 'linux'),
  isPhoneLayout: ref(false),
  isNarrowScreen: ref(false),
}))
vi.mock('../utils/androidKeepAlive', () => ({
  startAndroidKeepAlive: startKeepAliveMock,
  stopAndroidKeepAlive: stopKeepAliveMock,
}))
vi.mock('../stores/sessionStore', () => ({
  useSessionStore: () => sessionStoreMock,
  disposeSessionStore: vi.fn(),
}))
vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: ref('en') }),
}))

import { useMobileKeyBar } from './useMobileKeyBar'

beforeEach(() => {
  vi.clearAllMocks()
  sessionStoreMock.sessions = new Map()
  sessionStoreMock.getStatus.mockReturnValue('disconnected')
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useMobileKeyBar — isMobile', () => {
  it('exposes true on a mobile platform', () => {
    isMobileMock.mockReturnValue(true)
    const mkb = useMobileKeyBar()
    expect(mkb.isMobile).toBe(true)
  })

  it('exposes false on a desktop platform', () => {
    isMobileMock.mockReturnValue(false)
    const mkb = useMobileKeyBar()
    expect(mkb.isMobile).toBe(false)
  })
})

describe('useMobileKeyBar — init / dispose', () => {
  it('registers focusin/focusout/visibilitychange listeners on mobile', () => {
    isMobileMock.mockReturnValue(true)
    const addSpy = vi.spyOn(document, 'addEventListener')
    const mkb = useMobileKeyBar()
    mkb.init()
    expect(addSpy).toHaveBeenCalledWith('focusin', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('focusout', expect.any(Function))
    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    addSpy.mockRestore()
  })

  it('does not register listeners on desktop', () => {
    isMobileMock.mockReturnValue(false)
    const addSpy = vi.spyOn(document, 'addEventListener')
    const mkb = useMobileKeyBar()
    mkb.init()
    expect(addSpy).not.toHaveBeenCalledWith('focusin', expect.any(Function))
    expect(addSpy).not.toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    addSpy.mockRestore()
  })

  it('dispose removes listeners and stops keep-alive on mobile', () => {
    isMobileMock.mockReturnValue(true)
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const mkb = useMobileKeyBar()
    mkb.init()
    mkb.dispose()
    expect(removeSpy).toHaveBeenCalledWith('focusin', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('focusout', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(stopKeepAliveMock).toHaveBeenCalled()
    removeSpy.mockRestore()
  })

  it('dispose still stops keep-alive on desktop', () => {
    isMobileMock.mockReturnValue(false)
    const mkb = useMobileKeyBar()
    mkb.dispose()
    expect(stopKeepAliveMock).toHaveBeenCalled()
  })
})

describe('useMobileKeyBar — keyBarSessionId', () => {
  it('returns null on desktop', () => {
    isMobileMock.mockReturnValue(false)
    const mkb = useMobileKeyBar()
    expect(mkb.keyBarSessionId.value).toBeNull()
  })

  it('returns null on mobile when no terminal is focused', () => {
    isMobileMock.mockReturnValue(true)
    const mkb = useMobileKeyBar()
    expect(mkb.keyBarSessionId.value).toBeNull()
  })

  it('returns the session id when a connected terminal is focused on mobile', () => {
    isMobileMock.mockReturnValue(true)
    sessionStoreMock.getStatus.mockReturnValue('connected')

    // Build DOM: a terminal container with the xterm helper textarea inside.
    const container = document.createElement('div')
    container.dataset.terminalSessionId = 'sess-1'
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    container.appendChild(textarea)
    document.body.appendChild(container)

    const mkb = useMobileKeyBar()
    mkb.init()
    textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: null }))
    // The focusin listener uses e.target
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }) as any)
    // Manually simulate: the listener reads e.target
    // Since jsdom FocusEvent target may not propagate to document listener correctly,
    // dispatch directly on document with target set
    const ev = new FocusEvent('focusin')
    Object.defineProperty(ev, 'target', { value: textarea, configurable: true })
    document.dispatchEvent(ev)

    expect(mkb.keyBarSessionId.value).toBe('sess-1')
  })

  it('returns null when the focused terminal session is not connected', () => {
    isMobileMock.mockReturnValue(true)
    sessionStoreMock.getStatus.mockReturnValue('connecting')

    const container = document.createElement('div')
    container.dataset.terminalSessionId = 'sess-2'
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    container.appendChild(textarea)
    document.body.appendChild(container)

    const mkb = useMobileKeyBar()
    mkb.init()
    const ev = new FocusEvent('focusin')
    Object.defineProperty(ev, 'target', { value: textarea, configurable: true })
    document.dispatchEvent(ev)

    expect(mkb.keyBarSessionId.value).toBeNull()
  })
})

describe('useMobileKeyBar — visibility keep-alive', () => {
  it('starts keep-alive when hidden with live sessions', () => {
    isMobileMock.mockReturnValue(true)
    sessionStoreMock.sessions.set('s1', { status: 'connected' })
    sessionStoreMock.sessions.set('s2', { status: 'disconnected' })

    const mkb = useMobileKeyBar()
    mkb.init()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(startKeepAliveMock).toHaveBeenCalledWith('uniTerm', 'app.backgroundKeepAlive')
  })

  it('does not start keep-alive when hidden without live sessions', () => {
    isMobileMock.mockReturnValue(true)
    sessionStoreMock.sessions.set('s1', { status: 'disconnected' })

    const mkb = useMobileKeyBar()
    mkb.init()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(startKeepAliveMock).not.toHaveBeenCalled()
  })

  it('stops keep-alive when becoming visible', () => {
    isMobileMock.mockReturnValue(true)
    const mkb = useMobileKeyBar()
    mkb.init()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(stopKeepAliveMock).toHaveBeenCalled()
  })

  it('treats connecting sessions as live', () => {
    isMobileMock.mockReturnValue(true)
    sessionStoreMock.sessions.set('s1', { status: 'connecting' })

    const mkb = useMobileKeyBar()
    mkb.init()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(startKeepAliveMock).toHaveBeenCalled()
  })
})