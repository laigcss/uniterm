// Strip transport-level noise and binary garbage from a block of terminal
// output before it lands in xterm. Shared by the live `session:data` handler
// and the KeepAlive history-replay path so both see identical input.
//
// All replacements are pure — no side effects, no logger calls — so the
// function is trivially unit-testable. Callers that want a debug log do it
// around the call site.

// Single alternation covering every "drop this garbage" pass plus the
// \n{3,}→\n\n collapse. Six sequential .replace() calls each allocated a
// fresh copy of the (large) scrollback string and walked the whole buffer
// again; one global scan with a callback that dispatches on whether the
// match starts with \n keeps the same result for ~1/7 of the work.
//
// The garbage class is defined by Unicode property escapes rather than a
// hand-rolled list of blocks. Claude Code (Ink-based) emits glyphs like
// ● ⏺ ⏵ ⌘ ⌥ ⌫ ↵ ⏎ ✓ ✗ ■ □ ▶ ◆ ★ — a block allow-list silently ate most of
// them on history restore, so table borders, spinners and keyboard hints
// vanished on tab switch. Keeping every printable Letter / Number /
// Punctuation / Symbol / Separator / Mark passes those through along with
// CJK Extension A, full-width Latin, half-width Katakana and braille,
// while unassigned code points and lone surrogates still get dropped.
// \x09 \x0a \x0d \x1b are listed explicitly: they are control characters
// (no Unicode property matches them) that xterm needs.
const SANITIZE_STRIP_RE =
  /\*{2,}(?:\x18)?[ABC][0-9a-fA-F]{10,}|\x18+|\x08+|[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]|�|[^\x09\x0a\x0d\x1b\p{L}\p{N}\p{P}\p{S}\p{Z}\p{M}]|\n{3,}/gu

// Same alternation minus the trailing \n{3,} branch. Running output does not
// accumulate blank runs, so collapsing them in the hot path would only churn
// bytes.
const SANITIZE_STRIP_LIVE_RE =
  /\*{2,}(?:\x18)?[ABC][0-9a-fA-F]{10,}|\x18+|\x08+|[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]|�|[^\x09\x0a\x0d\x1b\p{L}\p{N}\p{P}\p{S}\p{Z}\p{M}]/gu

export function sanitizeTerminalOutput(text: string): string {
  if (!text) return text
  return text.replace(SANITIZE_STRIP_RE, (m) => (m.charCodeAt(0) === 0x0a ? '\n\n' : ''))
}

// Live session:data path is identical except the blank-line collapse is
// skipped — see SANITIZE_STRIP_LIVE_RE.
export function sanitizeLiveTerminalOutput(text: string): string {
  if (!text) return text
  return text.replace(SANITIZE_STRIP_LIVE_RE, '')
}
