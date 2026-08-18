import { describe, it, expect } from 'vitest'
import { buildGutterLines, formatTimestampMs, resolveRowTimestamp, type BuildGutterLinesOptions } from './terminalGutter'

/** Build options from a compact list of isWrapped flags indexed by buffer row. */
function mk(
  wrapped: boolean[],
  over?: Partial<Omit<BuildGutterLinesOptions, 'getLine' | 'record'>>
): BuildGutterLinesOptions {
  return {
    rows: wrapped.length,
    viewportY: 0,
    lineOffset: 0,
    cursorAbsoluteY: wrapped.length - 1,
    getLine: (n) => ({ isWrapped: wrapped[n] ?? false }),
    ...over,
  }
}

describe('buildGutterLines()', () => {
  it('numbers every non-wrapped row from 1', () => {
    const { lines } = buildGutterLines(mk([false, false, false]))
    expect(lines.map((l) => l.lineNumber)).toEqual(['1', '2', '3'])
  })

  it('leaves wrapped continuation rows blank so a wrapped line reads as one', () => {
    // A long command wraps onto rows 0,1,2; row 3 begins the real next line.
    const { lines } = buildGutterLines(mk([false, true, true, false, false, false]))
    expect(lines.map((l) => l.lineNumber)).toEqual(['1', '', '', '4', '5', '6'])
  })

  it('leaves rows below the cursor blank (screen not fully written yet)', () => {
    // cursor is at buffer row 3 (0-based); the 5th row is unwritten.
    const { lines } = buildGutterLines(mk([false, false, false, false], { rows: 5, cursorAbsoluteY: 3 }))
    expect(lines.map((l) => l.lineNumber)).toEqual(['1', '2', '3', '4', ''])
  })

  it('applies the trim offset so numbers stay continuous after scrollback trimming', () => {
    const { lines } = buildGutterLines(mk([false, false, false], { lineOffset: 97 }))
    expect(lines.map((l) => l.lineNumber)).toEqual(['98', '99', '100'])
  })

  it('reflects a scrolled viewport (buffer row offset from viewportY)', () => {
    const { lines } = buildGutterLines(mk([false, false, false, false, false], {
      viewportY: 2,
      rows: 3,
      cursorAbsoluteY: 4,
    }))
    expect(lines.map((l) => l.lineNumber)).toEqual(['3', '4', '5'])
  })

  it('reports the largest visible number for column sizing', () => {
    const { maxLineNumber } = buildGutterLines(mk([false, true, false, false], { lineOffset: 1000 }))
    expect(maxLineNumber).toBe(1004)
  })
})

describe('formatTimestampMs', () => {
  it('renders HH:mm:ss by default', () => {
    const d = new Date(2026, 7, 18, 6, 5, 9)
    expect(formatTimestampMs(d.getTime())).toBe('06:05:09')
  })

  it('renders a YYYY-MM-DD HH:mm:ss template', () => {
    const d = new Date(2026, 7, 18, 6, 5, 9)
    expect(formatTimestampMs(d.getTime(), 'YYYY-MM-DD HH:mm:ss')).toBe('2026-08-18 06:05:09')
  })

  it('keeps literals and pads single-digit fields', () => {
    const d = new Date(2026, 0, 3, 9, 4, 5)
    expect(formatTimestampMs(d.getTime(), 'HH:mm')).toBe('09:04')
  })
})

describe('resolveRowTimestamp', () => {
  const wrapped = [false, true, true, false] // rows 1,2 are continuation of row 0
  const getLine = (n: number) => ({ isWrapped: wrapped[n] ?? false })

  it('finds the timestamp from the wrapped group start', () => {
    // rows 1 and 2 belong to group started at row 0 (timestamp 111).
    const ts = resolveRowTimestamp(2, 0, getLine, (i) => (i === 0 ? 111 : undefined))
    expect(ts).toBe(111)
  })

  it('uses the row itself when it carries the timestamp', () => {
    const ts = resolveRowTimestamp(3, 0, getLine, (i) => (i === 3 ? 999 : undefined))
    expect(ts).toBe(999)
  })

  it('returns undefined when no row in the group was stamped', () => {
    const ts = resolveRowTimestamp(1, 0, getLine, () => undefined)
    expect(ts).toBeUndefined()
  })
})

describe('buildGutterLines() with timestamps', () => {
  it('shows the group timestamp only on non-wrapped rendered rows', () => {
    // row 0 stamped; rows 1,2 wrapped (inherit group time); row 3 own stamp.
    // Local Date construction keeps the assertion timezone-independent.
    const stamp = new Map<number, number>([
      [0, new Date(2026, 7, 18, 12, 34, 56).getTime()],
      [3, new Date(2026, 7, 18, 13, 0, 1).getTime()],
    ])
    const { lines } = buildGutterLines(mk([false, true, true, false], {
      showTimestamps: true,
      getTimestamp: (i) => stamp.get(i),
    }))
    expect(lines.map((l) => l.timestamp)).toEqual(['12:34:56', '', '', '13:00:01'])
  })

  it('shows nothing when showTimestamps is off', () => {
    const { lines } = buildGutterLines(mk([false, false], { getTimestamp: () => 5000 }))
    expect(lines.map((l) => l.timestamp)).toEqual(['', ''])
  })
})