import { describe, expect, it, vi } from 'vitest'
import { useSmartCopyPaste } from './useSmartCopyPaste'

// Minimal options — shouldSuppressBackspace does not touch the smart
// copy/paste machinery, so stubs are enough to construct the composable.
function makeGuard() {
  return useSmartCopyPaste({
    isMac: false,
    getTerminal: () => null,
    getMode: () => 'ssh',
    readClipboardText: () => Promise.resolve(''),
    writeClipboard: vi.fn(),
    pasteToSession: vi.fn(),
  }).shouldSuppressBackspace
}

describe('shouldSuppressBackspace — Backspace line-start guard (issue #814)', () => {
  const guard = makeGuard()
  const DEL = '\x7f'

  it('suppresses Backspace at cursor 0 on the normal screen', () => {
    expect(guard(DEL, false, 0)).toBe(true)
  })

  it('does not suppress inside alternate-screen apps (vim etc.)', () => {
    expect(guard(DEL, true, 0)).toBe(false)
  })

  it('does not suppress when the cursor is not at the line start', () => {
    expect(guard(DEL, false, 1)).toBe(false)
    expect(guard(DEL, false, 42)).toBe(false)
  })

  it('does not suppress non-Backspace data', () => {
    expect(guard('a', false, 0)).toBe(false)
    expect(guard('\r', false, 0)).toBe(false)
    expect(guard('\x1b[A', false, 0)).toBe(false)
  })
})