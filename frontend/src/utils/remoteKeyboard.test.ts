import { describe, expect, it, vi } from 'vitest'

// settings.ts reads navigator.userAgent at module top level (DEFAULT_UI_FONT_SIZE)
// and useKeyboardShortcuts touches window. vitest's node environment may not
// expose these globals, so define minimal stubs before any module import.
// vi.hoisted runs before all imports in the file.
vi.hoisted(() => {
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'node', platform: 'darwin' },
    })
  }
  if (typeof globalThis.window === 'undefined') {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    })
  }
})

import { isRdpPasteKey, queueRemoteKeyboardChange, remoteDesktopOwnsKey, releaseRemoteKeyboardFocus } from './remoteKeyboard'
import { loadKeybindings, onGlobalKeydown } from '../composables/useKeyboardShortcuts'
import { DEFAULT_KEYBOARD } from '../types/settings'

describe('remote keyboard ownership', () => {
  it('keeps application shortcuts out of the focused RDP desktop', () => {
    const closePanel = vi.fn()
    loadKeybindings(DEFAULT_KEYBOARD, { closePanel } as any)
    const closest = vi.fn(() => ({}))
    const event = {
      key: 'q', ctrlKey: true, shiftKey: true, target: { closest },
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent
    expect(remoteDesktopOwnsKey(event)).toBe(true)
    // App.vue guards the global keydown with remoteDesktopOwnsKey (issue
    // refactor): when the remote desktop owns the key, onGlobalKeydown is
    // never called, so the application shortcut (closePanel) stays silent.
    if (!remoteDesktopOwnsKey(event)) onGlobalKeydown(event)
    expect(closest).toHaveBeenCalledWith('[data-remote-keyboard="true"]')
    expect(closePanel).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    closest.mockReturnValue(null as any)
    if (!remoteDesktopOwnsKey(event)) onGlobalKeydown(event)
    expect(closePanel).toHaveBeenCalledOnce()
  })

  it('accepts events without a DOM target', () => {
    expect(remoteDesktopOwnsKey({ target: null } as KeyboardEvent)).toBe(false)
  })

  it('releases remote keyboard capture before a local menu opens', () => {
    const blur = vi.fn()
    const closest = vi.fn(() => ({}))
    vi.stubGlobal('document', { activeElement: { closest, blur } })
    try {
      releaseRemoteKeyboardFocus()
      expect(blur).toHaveBeenCalledOnce()
      closest.mockReturnValue(null as any)
      releaseRemoteKeyboardFocus()
      expect(blur).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('serializes focus/blur across panels and recovers from bridge failures', async () => {
    const calls: string[] = []
    let finish!: () => void
    const first = queueRemoteKeyboardChange(async () => {
      calls.push('focus first')
      await new Promise<void>(resolve => { finish = resolve })
    })
    const blur = queueRemoteKeyboardChange(async () => { calls.push('blur first'); throw Error('bridge error') })
    const recovered = blur.catch(() => {})
    const second = queueRemoteKeyboardChange(async () => { calls.push('focus second') })
    await Promise.resolve()
    expect(calls).toEqual(['focus first'])
    finish()
    await Promise.all([first, recovered, second])
    expect(calls).toEqual(['focus first', 'blur first', 'focus second'])
  })
})

describe('native paste keys retain the clipboard barrier', () => {
  it('recognizes both Ctrl/Win+V and Shift+Insert by physical scan code', () => {
    expect(isRdpPasteKey(0x2f, true, false, false)).toBe(true)
    expect(isRdpPasteKey(0x2f, false, true, false)).toBe(true)
    expect(isRdpPasteKey(0xe052, false, false, true)).toBe(true)
    expect(isRdpPasteKey(0x2f, false, false, false)).toBe(false)
    expect(isRdpPasteKey(0x52, false, false, true)).toBe(false)
  })
})
