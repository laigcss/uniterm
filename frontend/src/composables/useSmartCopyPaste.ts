/**
 * useSmartCopyPaste — 终端智能复制粘贴 + Backspace 行首防护 composable.
 *
 * 从 BaseTerminal.vue 提取的本地独有键盘行为：
 *
 * 1. 非 Mac Ctrl+V 智能粘贴（Windows Terminal / VS Code 语义）
 *    — PR #1194 被上游拒绝，上游认为 plain Ctrl+V 不应被拦截。
 *    本地保留此行为因为 Windows/Linux/HarmonyOS 2in1 桌面端期望 Ctrl+V 粘贴。
 *
 * 2. 非 Mac Ctrl+C 有选区时复制（Windows Terminal / VS Code 语义）
 *    — 同上，上游不拦截 plain Ctrl+C，本地保留。
 *
 * 3. Backspace 行首防护（issue #814 bugfix）
 *    — 在某些 shell（如 Euler OS）上 stty erase 可能不匹配发送的字节，
 *    导致 Backspace 在行首时会吃掉 shell prompt。此防护在普通屏幕
 *    （非 vim 等全屏应用）且本地行缓冲区光标在位置 0 时抑制 Backspace。
 *    上游移除此防护，认为"Always deliver Backspace and let the remote line
 *    editor enforce its bounds"，但本地保留以修复 Euler OS 上的 bug。
 */


/** xterm 实例所需的最小接口 */
interface TerminalLike {
  getSelection: () => string
  clearSelection: () => void
}

interface SmartCopyPasteOptions {
  /** 是否为 Mac 平台 */
  isMac: boolean
  /** 获取 xterm 实例（可能为 null） */
  getTerminal: () => TerminalLike | null
  /** 获取当前模式（'ssh' | 'local' | ...） */
  getMode: () => string
  /** 读取剪贴板文本 */
  readClipboardText: () => Promise<string>
  /** 写入剪贴板 */
  writeClipboard: (text: string) => void
  /** 粘贴文本到会话 */
  pasteToSession: (text: string) => void
}

export function useSmartCopyPaste(options: SmartCopyPasteOptions) {
  const { isMac, getTerminal, getMode, readClipboardText, writeClipboard, pasteToSession } = options

  /**
   * 智能复制粘贴键盘处理。
   * 在 xterm attachCustomKeyEventHandler 中调用，在其他处理之前。
   *
   * 返回值：
   *   - false: 已处理（阻止默认行为，xterm 不会收到此事件）
   *   - true: 匹配但无选区，继续传递（让 shell 收到 SIGINT 等）
   *   - null: 不匹配此处理器，继续其他键盘处理
   */
  function handleSmartCopyPaste(e: KeyboardEvent): boolean | null {
    // ── 非 Mac Ctrl+V 智能粘贴 ──
    // Windows/Linux/HarmonyOS 2in1 桌面端映射 plain Ctrl+V 到粘贴，
    // mirroring Windows Terminal / VS Code's integrated terminal。
    // quoted-insert 仍可通过 Ctrl+Q 在 readline 中使用。
    // Mac 保持 Cmd+V 路径和 Ctrl+V literal-next。
    if (!isMac && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'v' || e.key === 'V') && e.type === 'keydown') {
      e.preventDefault()
      if (getMode() === 'ssh' || getMode() === 'local') {
        readClipboardText().then(text => {
          if (text) pasteToSession(text)
        })
      }
      return false
    }

    // ── 非 Mac Ctrl+C 有选区时复制 ──
    // 有选区：复制并清除选区（Windows Terminal / VS Code 语义）
    // 无选区：继续传递，让 shell 收到 SIGINT
    if (!isMac && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'c' || e.key === 'C') && e.type === 'keydown') {
      const sel = getTerminal()?.getSelection()
      if (sel) {
        e.preventDefault()
        writeClipboard(sel)
        getTerminal()?.clearSelection()
        return false
      }
      // No selection: pass through so the shell receives SIGINT.
      return true
    }

    return null
  }

  /**
   * Backspace 行首防护（issue #814）。
   * 在 onData 回调中调用，返回 true 表示应抑制此 Backspace。
   *
   * @param data xterm onData 的数据
   * @param inAlt 是否在备用屏幕（vim 等全屏应用）
   * @param cursorIndex 本地行缓冲区的光标位置
   * @returns true 表示应抑制（return），false 表示正常发送
   */
  function shouldSuppressBackspace(data: string, inAlt: boolean, cursorIndex: number): boolean {
    // Defensive guard (issue #814): suppress backspace at the line start
    // so it cannot eat into the shell prompt. Only applies to the normal
    // screen (not full-screen apps like vim) and when the local line
    // buffer's cursor is already at position 0. handleInput() above has
    // already updated cursorIndex, so if it stayed at 0 the backspace
    // would move the cursor into the prompt on certain shells (e.g.
    // Euler OS where stty erase may not match the sent byte).
    return !inAlt && data === '\x7f' && cursorIndex === 0
  }

  return {
    handleSmartCopyPaste,
    shouldSuppressBackspace,
  }
}