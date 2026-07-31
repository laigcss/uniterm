// Strip transport-level noise and binary garbage from a block of terminal
// output before it lands in xterm. Shared by the live `session:data` handler
// and the KeepAlive history-replay path so both see identical input.
//
// All replacements are pure — no side effects, no logger calls — so the
// function is trivially unit-testable. Callers that want a debug log do it
// around the call site.

const ZMODEM_HEX_FRAGMENT = /\*{2,}(?:\x18)?[ABC][0-9a-fA-F]{10,}/g
const ZMODEM_ZDLE_RUN = /\x18+/g
const BACKSPACE_RUN = /\x08+/g
const ASCII_CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g
const REPLACEMENT_CHAR = /�/g
// Keep ASCII + CJK + the Unicode blocks that modern TUIs and Claude Code
// actually render: box drawing, block elements, arrows, math operators,
// braille and misc symbols. Everything else is treated as binary garbage.
const NON_TUI_GARBAGE =
  /[^\x00-\x7f一-鿿぀-ゟ゠-ヿ가-힯─-╿▀-▟←-⇿∀-⋿⟀-⟯⠀-⣿⬀-⯿]/g
const BLANK_LINE_RUN = /\n{3,}/g

export function sanitizeTerminalOutput(text: string): string {
  if (!text) return text
  let cleaned = text
  cleaned = cleaned.replace(ZMODEM_HEX_FRAGMENT, '')
  cleaned = cleaned.replace(ZMODEM_ZDLE_RUN, '')
  cleaned = cleaned.replace(BACKSPACE_RUN, '')
  cleaned = cleaned.replace(ASCII_CTRL, '')
  cleaned = cleaned.replace(REPLACEMENT_CHAR, '')
  cleaned = cleaned.replace(NON_TUI_GARBAGE, '')
  cleaned = cleaned.replace(BLANK_LINE_RUN, '\n\n')
  return cleaned
}

// Live session:data path is identical except the blank-line collapse is
// skipped — running output naturally produces no blank runs, and collapsing
// in the hot path would just churn bytes.
export function sanitizeLiveTerminalOutput(text: string): string {
  if (!text) return text
  let cleaned = text
  cleaned = cleaned.replace(ZMODEM_HEX_FRAGMENT, '')
  cleaned = cleaned.replace(ZMODEM_ZDLE_RUN, '')
  cleaned = cleaned.replace(BACKSPACE_RUN, '')
  cleaned = cleaned.replace(ASCII_CTRL, '')
  cleaned = cleaned.replace(REPLACEMENT_CHAR, '')
  cleaned = cleaned.replace(NON_TUI_GARBAGE, '')
  return cleaned
}