# Telnet Connection Options — Design Spec

Date: 2026-08-06
Branch: `feat/telnet-options`

## Summary

Add four telnet-specific connection options currently missing from uniTerm: option negotiation mode (active/passive), local echo, send mode (character/line), and CR/LF translation. Other terminal emulators (Xshell, SecureCRT) commonly expose these; adding them improves compatibility with diverse telnet servers.

## Fields

Four new fields on the shared `ConnectionConfig`:

| Field | Type | Default | Purpose |
|---|---|---|---|
| `telnetNegotiationMode` | `"active"` \| `"passive"` | `"active"` | Who initiates telnet option negotiation |
| `telnetLocalEcho` | `boolean` | `false` | Echo typed chars locally when the server doesn't |
| `telnetSendMode` | `"character"` \| `"line"` | `"character"` | Per-keystroke vs send-on-Enter |
| `telnetNewlineMode` | `"cr"` \| `"crlf"` | `"cr"` | What byte sequence the Enter key produces |

All fields are telnet-only — other session types ignore them. Defaults preserve existing behavior.

## Backend (`backend/session/telnet_session.go`)

### Negotiation Mode

- **active** (default): no change. `Connect()` sends `WILL BINARY`, `DO SGA`, `WILL TTYPE`, and `NAWS` immediately after dial.
- **passive**: skip initial negotiation in `Connect()`, only respond via `handleNegotiation()` when the server initiates.

Edge case: if both sides are passive, no negotiation occurs. Binary mode, terminal type, and window size reporting won't be enabled. This is expected — it's the user's choice and matches Xshell's documented behavior.

### Local Echo

In `Write()`: when `telnetLocalEcho` is true, write the received bytes back to the terminal output after sending them to the server. This simulates server echo.

Implementation: call `s.baseSession.WriteToTerminal(data)` after `s.conn.Write(data)`.

Edge case: if both local echo and server echo are active, characters appear doubled. This is the user's responsibility — the toggle exists precisely for servers that don't echo.

### Send Mode

- **character** (default): no change. Each `Write()` call passes through immediately.
- **line**: buffer incoming writes in `TelnetSession` until a `\r` (Enter) is received, then flush the entire buffered line. During buffering, echo each character locally so the user can see what they're typing (the server won't see it until Enter).

Implementation: add `lineBuf []byte` to `TelnetSession`. In `Write()` for line mode, append to buffer; on `\r`, flush buffer + `\r` (or `\r\n` depending on newline mode).

Edge case: `\n` alone (Ctrl+J) should also flush the buffer, as some terminals send bare LF.

### Newline Mode

- **cr** (default): no change. Enter → `\r`.
- **crlf**: Enter → `\r\n`. Replace `\r` with `\r\n` in the outgoing byte stream.

Implementation: in `Write()`, replace each `\r` with `\r\n`. Do NOT replace `\n` — only `\r` (which is what the Enter key typically produces in xterm.js).

## Frontend

### Types (`frontend/src/types/session.ts`)

Add to `ConnectionConfig` interface:
```ts
telnetNegotiationMode?: 'active' | 'passive'
telnetLocalEcho?: boolean
telnetSendMode?: 'character' | 'line'
telnetNewlineMode?: 'cr' | 'crlf'
```

### Connection Form (`frontend/src/components/ConnectionForm.vue`)

Four new controls in the Advanced section, gated on `form.type === 'telnet'`:

- **Negotiation Mode**: `<el-select>` with two options (Active / Passive)
- **Local Echo**: `<el-switch>` toggle
- **Send Mode**: `<el-select>` (Character-at-a-time / Line-at-a-time)
- **Newline Mode**: `<el-select>` (CR / CR+LF)

Placement: after Encoding, before Backspace Key. Follow existing Element Plus form patterns.

### i18n

Add labels for all 9 locale files: en, zh-CN, zh-TW, de, es, fr, ja, ko, ru.

## Testing

- No existing telnet test file. Add `backend/session/telnet_session_test.go` covering:
  - Passive mode: verify no initial IAC bytes sent
  - Local echo: verify data echoed to terminal output
  - Line mode: verify buffering until `\r`
  - Newline CRLF: verify `\r` → `\r\n` translation

## Migration

Existing telnet connections have no values for the new fields. Defaults (`active`, `false`, `character`, `cr`) match previous behavior exactly — no migration needed.
