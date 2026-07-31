import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from './settings'

describe('DEFAULT_SETTINGS.terminal.fontFamily', () => {
  it('prefers the bundled JetBrains Mono Variable as the first family', () => {
    const first = DEFAULT_SETTINGS.terminal.fontFamily.split(',')[0].trim()
    expect(first).toBe('"JetBrains Mono Variable"')
  })

  it('keeps platform fallbacks so the stack degrades gracefully', () => {
    const stack = DEFAULT_SETTINGS.terminal.fontFamily
    expect(stack).toMatch(/Menlo/)
    expect(stack).toMatch(/Consolas/)
    expect(stack).toMatch(/Courier New/)
    expect(stack).toMatch(/monospace$/)
  })
})
