import { describe, it, expect } from 'vitest'
import { highlight } from './useHighlight'

// SGR sequences inserted by highlight() — we only assert presence/absence,
// not exact bytes (the colour palette is intentionally allowed to evolve).

describe('highlight()', () => {
  it('highlights braces in plain prose', () => {
    const out = highlight('hello {world}')
    expect(out).toContain('\x1b[95m') // brace colour from palette
    expect(out).not.toBe('hello {world}')
  })

  it('skips content INSIDE a fenced code block', () => {
    const input = '```js\nconst x = {a: 1}\necho "hello {world}"\n```\n'
    const out = highlight(input)
    // The fence lines and the two content lines must pass through
    // untouched — no SGR inserted between the backticks.
    expect(out).toBe(input)
  })

  it('skips content inside a tilde fence', () => {
    const input = '~~~py\nprint("{x}")\n~~~\n'
    expect(highlight(input)).toBe(input)
  })

  it('tolerates an info string on the opening fence', () => {
    const input = '```javascript\nlet {a, b} = obj\n```\n'
    expect(highlight(input)).toBe(input)
  })

  it('only closes a fence when the same character is used', () => {
    // ``` must close ``` and not ~~~ (CommonMark rule, kept simple here)
    const input = '```\n{not highlighted}\n~~~\n{still inside fence — not highlighted}\n```\n'
    const out = highlight(input)
    expect(out).toBe(input)
  })

  it('skips indented code lines (4+ leading spaces)', () => {
    const input = '    let {a} = obj\n    const b = {c: 1}\n'
    expect(highlight(input)).toBe(input)
  })

  it('still highlights prose after a fence closes', () => {
    const input = '```\n{x}\n```\nplain {prose}\n'
    const out = highlight(input)
    // The brace palette opener must precede the brace and the reset must
    // follow the brace's content — verify both ends rather than the full
    // byte sequence (colour codes can wrap around braces independently).
    expect(out).toContain('\x1b[95m{')
    expect(out).toContain('}\x1b[24;39m')
    // The fenced {x} line must NOT carry the brace colour.
    expect(out).not.toContain('\x1b[95m{x}')
  })

  it('passes SGR-only lines through unchanged when no plain braces are present', () => {
    // highlight() splits on CSI boundaries and only colours plain segments
    // inside an SGR-only line — so a line with no plain braces is unchanged.
    const input = '\x1b[31mred text\x1b[0m\n'
    expect(highlight(input)).toBe(input)
  })

  it('skips already-colored spans (issue #587) instead of fragmenting them', () => {
    // `ls` colors a directory blue; the app must NOT re-color its digits.
    const input = '\x1b[01;34mchatGLM2-6B\x1b[0m\n'
    expect(highlight(input)).toBe(input)
  })

  it('skips an extended-256-color span like a plain one', () => {
    const input = '\x1b[38;5;39mport8-api\x1b[0m\n'
    expect(highlight(input)).toBe(input)
  })

  it('still highlights default-colored text after and around a colored span', () => {
    // The digit "6" sits outside the colored span, so it must still be styled.
    const input = '\x1b[32mOK\x1b[0m 6\n'
    const out = highlight(input)
    expect(out).toContain('\x1b[96m6')
    expect(out).toContain('\x1b[32mOK\x1b[0m ')
  })

  it('handles multiple fences interleaved with prose', () => {
    const input = 'before {x}\n```\n{inside}\n```\nafter {y}\n'
    const out = highlight(input)
    expect(out).toContain('before ')
    expect(out).toContain('after ')
    // The {x} and {y} get the brace colour; {inside} does not.
    expect(out.split('\x1b[95m').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('is stable when given an empty string', () => {
    expect(highlight('')).toBe('')
  })

  it('is stable when given only a fence pair', () => {
    expect(highlight('```\n```\n')).toBe('```\n```\n')
  })
})