/**
 * Pure line-number computation for the terminal gutter.
 *
 * Kept free of DOM/xterm so the numbering rules can be unit-tested without a
 * terminal instance. The gutter component adapts xterm's buffer to this model.
 */

/** Default timestamp format, e.g. "12:34:56". */
export const DEFAULT_TIMESTAMP_FORMAT = 'HH:mm:ss'

export interface GutterRow {
  /** Stable identity for the DOM row (lineOffset + absolute buffer row). */
  key: number
  /** The number to display; empty for rows that carry no number. */
  lineNumber: string
  /** Timestamp to display for the row's logical line; empty when none. */
  timestamp: string
}

export interface GutterLineSource {
  isWrapped: boolean
}

export interface BuildGutterLinesOptions {
  /** Number of visible rows on the terminal screen (terminal.rows). */
  rows: number
  /** Index of the top visible buffer row (terminal.buffer.active.viewportY). */
  viewportY: number
  /** Absolute-row offset accumulated from scrollback trimming
   * (0 in the alternate screen, where numbering restarts from 1). */
  lineOffset: number
  /** Absolute index of the cursor row (baseY + cursorY); rows below it
   * have not been rendered yet and carry no number. */
  cursorAbsoluteY: number
  /** Fetch the wrapping flag for a given absolute buffer row. */
  getLine: (bufferLine: number) => GutterLineSource | null | undefined
  /** When true and a getTimestamp is provided, populate the time column. */
  showTimestamps?: boolean
  /** Birth timestamp (ms) of a logical line by its absolute start index. */
  getTimestamp?: (absoluteStartIndex: number) => number | undefined
  /** Convert a birth timestamp to display text. Defaults to [HH:mm:ss]. */
  formatTimestamp?: (ms: number) => string
}

export interface GutterBuildResult {
  lines: GutterRow[]
  /** Largest number on screen, used to size the column (>= 1). */
  maxLineNumber: number
}

/**
 * Format a birth timestamp per a tokenized template. Supported tokens:
 * YYYY/YY (year), MM/DD (month/day), HH/mm/ss (hour/minute/second); everything
 * else (e.g. ":") passes through unchanged.
 */
export function formatTimestampMs(ms: number, format: string = DEFAULT_TIMESTAMP_FORMAT): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  }
  return format.replace(/YYYY|YY|MM|DD|HH|mm|ss/g, (t) => tokens[t])
}

/** Sample timestamp whose rendered length bounds a format's column width. */
export const TIMESTAMP_WIDTH_SAMPLE_MS = new Date(2099, 11, 28, 23, 59, 59).getTime()

/**
 * Resolve the birth timestamp of a visible row's logical line. Walks back
 * through the wrapped group: the timestamp lives on the first (non-wrapped)
 * row, so wrapped continuation rows inherit the group's start.
 */
export function resolveRowTimestamp(
  bufferLine: number,
  lineOffset: number,
  getLine: (bufferLine: number) => GutterLineSource | null | undefined,
  getTimestamp: (absoluteStartIndex: number) => number | undefined,
): number | undefined {
  let y = bufferLine
  for (;;) {
    const ts = getTimestamp(lineOffset + y)
    if (ts) return ts
    const line = getLine(y)
    if (!line?.isWrapped) break
    y -= 1
  }
  return undefined
}

export function buildGutterLines(opts: BuildGutterLinesOptions): GutterBuildResult {
  const lines: GutterRow[] = []
  let maxLineNumber = 1
  const fmt = opts.formatTimestamp ?? formatTimestampMs

  for (let i = 0; i < opts.rows; i += 1) {
    const bufferLine = opts.viewportY + i
    const isWrapped = opts.getLine(bufferLine)?.isWrapped ?? false
    const isRendered = bufferLine <= opts.cursorAbsoluteY

    // Wrapped continuation rows and rows the cursor hasn't reached yet get no
    // number — the former would otherwise look like fresh lines, the latter
    // would show a phantom number below the last written row.
    const showNumber = isRendered && !isWrapped
    const key = opts.lineOffset + bufferLine

    let timestamp = ''
    if (opts.showTimestamps && showNumber && opts.getTimestamp) {
      const ts = resolveRowTimestamp(bufferLine, opts.lineOffset, opts.getLine, opts.getTimestamp)
      if (ts) timestamp = fmt(ts)
    }

    if (showNumber) {
      const number = opts.lineOffset + bufferLine + 1
      maxLineNumber = Math.max(maxLineNumber, number)
      lines.push({ key, lineNumber: String(number), timestamp })
    } else {
      lines.push({ key, lineNumber: '', timestamp })
    }
  }

  return { lines, maxLineNumber }
}