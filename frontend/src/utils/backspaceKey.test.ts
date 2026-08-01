import { describe, it, expect } from 'vitest'
import { applyBackspaceKey } from './backspaceKey'

const DEL = '\x7f'
const BS = '\x08'
const VT220 = '\x1b[3~'

describe('applyBackspaceKey', () => {
  describe('connection type filtering', () => {
    it('passes through for non-terminal-stream types', () => {
      expect(applyBackspaceKey(`a${DEL}b`, 'bs', 'sftp')).toBe(`a${DEL}b`)
      expect(applyBackspaceKey(`a${DEL}b`, 'bs', 'ftp')).toBe(`a${DEL}b`)
      expect(applyBackspaceKey(`a${DEL}b`, 'bs', 'database')).toBe(`a${DEL}b`)
      expect(applyBackspaceKey(`a${DEL}b`, 'bs', 'rdp')).toBe(`a${DEL}b`)
      expect(applyBackspaceKey(`a${DEL}b`, 'bs', 'vnc')).toBe(`a${DEL}b`)
      expect(applyBackspaceKey(`a${DEL}b`, 'bs', 'monitor')).toBe(`a${DEL}b`)
    })

    it('passes through when connType is undefined', () => {
      expect(applyBackspaceKey(`a${DEL}b`, 'bs', undefined)).toBe(`a${DEL}b`)
    })

    it('applies for terminal-stream types', () => {
      for (const t of ['ssh', 'telnet', 'serial', 'mosh', 'local', 'k8s', 'container']) {
        expect(applyBackspaceKey(`a${DEL}b`, 'bs', t)).toBe(`a${BS}b`)
        expect(applyBackspaceKey(`a${DEL}b`, 'vt220', t)).toBe(`a${VT220}b`)
      }
    })
  })

  describe('mode handling', () => {
    it('passes through when mode is "del"', () => {
      expect(applyBackspaceKey(`a${DEL}b`, 'del', 'ssh')).toBe(`a${DEL}b`)
    })

    it('defaults to "bs" for terminal-stream types when mode is undefined', () => {
      expect(applyBackspaceKey(`a${DEL}b`, undefined, 'ssh')).toBe(`a${BS}b`)
      expect(applyBackspaceKey(`a${DEL}b`, undefined, 'telnet')).toBe(`a${BS}b`)
      expect(applyBackspaceKey(`a${DEL}b`, undefined, 'serial')).toBe(`a${BS}b`)
    })

    it('replaces 0x7F with 0x08 when mode is "bs"', () => {
      expect(applyBackspaceKey(`a${DEL}b`, 'bs', 'ssh')).toBe(`a${BS}b`)
    })

    it('replaces 0x7F with ESC[3~ when mode is "vt220"', () => {
      expect(applyBackspaceKey(`a${DEL}b`, 'vt220', 'ssh')).toBe(`a${VT220}b`)
    })
  })

  describe('input shape', () => {
    it('returns data unchanged when no 0x7F is present', () => {
      const data = 'hello world\r\nls -la'
      expect(applyBackspaceKey(data, 'bs', 'ssh')).toBe(data)
      expect(applyBackspaceKey(data, 'vt220', 'ssh')).toBe(data)
      expect(applyBackspaceKey(data, 'del', 'ssh')).toBe(data)
    })

    it('replaces every 0x7F in a multi-byte string', () => {
      expect(applyBackspaceKey(`${DEL}${DEL}${DEL}`, 'bs', 'ssh')).toBe(`${BS}${BS}${BS}`)
      expect(applyBackspaceKey(`a${DEL}b${DEL}c`, 'bs', 'ssh')).toBe(`a${BS}b${BS}c`)
    })

    it('replaces every 0x7F with VT220 sequence', () => {
      expect(applyBackspaceKey(`a${DEL}b${DEL}c`, 'vt220', 'ssh')).toBe(
        `a${VT220}b${VT220}c`,
      )
    })

    it('handles empty string', () => {
      expect(applyBackspaceKey('', 'bs', 'ssh')).toBe('')
    })

    it('does not touch other control characters', () => {
      // Tab (0x09) and Enter (\r) must pass through untouched.
      const data = `a\tb\rc${DEL}d`
      expect(applyBackspaceKey(data, 'bs', 'ssh')).toBe(`a\tb\rc${BS}d`)
    })

    it('preserves escape sequences surrounding the backspace', () => {
      // e.g. arrow keys from xterm come in as ESC[A — only the bare 0x7F should
      // be translated, not the escape bytes.
      const data = `prefix${DEL}ESC${DEL}`
      expect(applyBackspaceKey(data, 'bs', 'ssh')).toBe(`prefix${BS}ESC${BS}`)
    })
  })
})
