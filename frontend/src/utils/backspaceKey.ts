// Translate xterm.js's default backspace byte (ASCII DEL, 0x7F) into the byte
// sequence the remote end expects. xterm.js always emits 0x7F for the physical
// Backspace key, which works on most modern Linux/macOS PTYs but is silently
// dropped on Huawei/H3C/Cisco network gear and some serial consoles. Those
// devices expect 0x08 (ASCII BS) or ESC[3~ (VT220 Delete).
//
// Only applies to terminal-stream connection types. Non-terminal protocols
// (SFTP, FTP, database, RDP…) never pass through xterm's onData, but the
// defensive type check makes the function safe to call from any code path.
//
// `mode === undefined` falls back to the new default ('bs') to match the
// behavior the ConnectionForm applies to new connections; this is the
// intentional behavior change for issue #456 (MobaXterm ships the same
// default — "Backspace sends ^H" is on by default).
const TERMINAL_STREAM_TYPES = new Set([
  'ssh',
  'telnet',
  'serial',
  'mosh',
  'local',
  'k8s',
  'container',
])

export type BackspaceKeyMode = 'del' | 'bs' | 'vt220'

export function applyBackspaceKey(
  data: string,
  mode: BackspaceKeyMode | undefined,
  connType: string | undefined,
): string {
  if (!connType || !TERMINAL_STREAM_TYPES.has(connType)) return data
  // Undefined → default to 'bs' for terminal-stream types (see file header).
  const effective: BackspaceKeyMode = mode ?? 'bs'
  if (effective === 'del') return data
  if (!data.includes('\x7f')) return data
  const replacement = effective === 'bs' ? '\x08' : '\x1b[3~'
  return data.split('\x7f').join(replacement)
}
