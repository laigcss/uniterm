import { getManagedTerminal } from './terminalManager'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * Per-line birth timestamps for the terminal gutter's time column.
 *
 * xterm has no notion of "when a line was written", so we record it ourselves:
 * - Write path: capture the absolute line index before and after each
 *   `terminal.write()` and stamp any rows that appeared in between with the
 *   arrival time (first write wins).
 * - Command submit: when Enter is pressed, stamp the current command line (its
 *   wrapped group) with that moment so the prompt line carries "when the
 *   command was executed".
 *
 * Rows are keyed by absolute row index inside the managed terminal's shared
 * Map, so the data survives KeepAlive and drag-across-panes. Only the first
 * stamp of a row is kept, symbolising when that terminal line appeared.
 *
 * Recording is UNCONDITIONAL: we stamp every line regardless of the
 * showTimestamps setting, so enabling the column mid-session still shows
 * timestamps for lines that already appeared. The display setting only decides
 * whether the gutter paints the time column (and whether we bother to poke the
 * gutter to refresh immediately).
 */

// Ask the gutter to re-read the (now updated) timestamp Map.
function notifyGutter() {
  window.dispatchEvent(new CustomEvent('terminal:refresh-gutter'))
}

function timestampsEnabled(): boolean {
  return useSettingsStore().settings.terminal.showTimestamps ?? false
}

/** Absolute buffer row index of the cursor, compensating for scrollback trim. */
function absoluteCursorLine(sessionId: string, lineOffset: number): number {
  const managed = getManagedTerminal(sessionId)
  const t = managed?.terminal
  if (!t) return lineOffset
  const buf = t.buffer.active
  return lineOffset + buf.baseY + buf.cursorY
}

/**
 * Stamp every row written between `fromLine` and `toLine` (inclusive, any
 * order) that hasn't been stamped yet. Call this around a terminal.write(),
 * with `fromLine` captured before the write and `toLine` after it completes.
 */
export function stampWrittenLines(sessionId: string, fromLine: number, toLine: number, ts: number): void {
  const managed = getManagedTerminal(sessionId)
  if (!managed) return
  if (managed.terminal.buffer.active.type === 'alternate') return

  const map = managed.lineTimestamps
  const start = Math.min(fromLine, toLine)
  const end = Math.max(fromLine, toLine)
  for (let y = start; y <= end; y += 1) {
    if (!map.has(y)) map.set(y, ts)
  }

  // Bound memory: keep the rolled-in map no larger than the recent window.
  const keepFrom = Math.max(0, start - 3000)
  for (const key of Array.from(map.keys())) {
    if (key < keepFrom) map.delete(key)
  }

  if (timestampsEnabled()) notifyGutter()
}

/**
 * Stamp the current command line with `ts` — called when the user submits a
 * command (Enter), so the prompt line records when it was executed. Walks back
 * through the wrapped group so a wrapped command shares one timestamp.
 */
export function stampCommandLine(sessionId: string, ts: number): void {
  const managed = getManagedTerminal(sessionId)
  if (!managed) return
  if (managed.terminal.buffer.active.type === 'alternate') return

  const t = managed.terminal
  const buf = t.buffer.active
  const map = managed.lineTimestamps
  const offset = managed.lineOffset
  const cursorLine = buf.baseY + buf.cursorY

  let startLine = cursorLine
  while (startLine > 0) {
    const line = buf.getLine(startLine)
    if (line && !line.isWrapped) break
    startLine -= 1
  }

  for (let y = startLine; y <= cursorLine; y += 1) {
    map.set(offset + y, ts)
  }
  if (timestampsEnabled()) notifyGutter()
}

/** Return the cursor's absolute line index for the current terminal. */
export function currentAbsoluteLine(sessionId: string): number {
  const managed = getManagedTerminal(sessionId)
  return managed ? absoluteCursorLine(sessionId, managed.lineOffset) : 0
}