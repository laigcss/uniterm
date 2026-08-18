import { ElMessage } from 'element-plus'

const CLOSABLE = { showClose: true, duration: 5000, offset: 50 }

// persist=true keeps the toast until the user closes it (duration 0) instead of
// auto-dismissing — e.g. a connection-test result whose outcome must be readable.
type PersistMsg = (m: string, persist?: boolean) => void

const persistMsg =
  (kind: 'success' | 'error' | 'warning' | 'info'): PersistMsg =>
  (m, persist = false) =>
    ElMessage[kind]({ message: m, ...CLOSABLE, duration: persist ? 0 : CLOSABLE.duration })

export const msg = {
  success: persistMsg('success'),
  error: persistMsg('error'),
  warning: persistMsg('warning'),
  info: persistMsg('info'),
  // Stays until closed so a long path can be read and copied. The message is
  // wrapped in a span with inline no-drag so the WKWebView hands mouse events
  // back to the DOM instead of initiating a window drag on macOS frameless
  // windows. CSS customClass alone isn't enough — the mousedown lands on a
  // text node inside .el-message__content and Wails walks up to find no-drag;
  // an inline style on the immediate parent is the most reliable target. The
  // msg-copyable class lets the focus guard and right-click menu target it.
  copyable(m: string, type: 'success' | 'info' | 'warning' | 'error' = 'success') {
    const safe = m.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    ElMessage({
      dangerouslyUseHTMLString: true,
      message: `<span style="--wails-draggable:no-drag;user-select:text;-webkit-user-select:text;cursor:text">${safe}</span>`,
      type,
      showClose: true,
      duration: 0,
      offset: 56,
      customClass: 'msg-copyable',
    })
  },
}
