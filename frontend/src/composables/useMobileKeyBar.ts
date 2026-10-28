/**
 * useMobileKeyBar — 移动端软键盘辅助栏 + Android 后台保活 (App.vue 拆分)
 *
 * 从 App.vue 下沉：
 *   - focusedTerminalSessionId / keyBarSessionId
 *   - document focusin/focusout 监听（追踪当前终端焦点）
 *   - visibilitychange 监听 + Android keep-alive 前台服务
 *
 * App.vue 用法：
 *   const mkb = useMobileKeyBar()
 *   // 模板绑定 mkb.keyBarSessionId
 *   // onMounted 中调用 mkb.init()
 *   // onUnmounted 中调用 mkb.dispose()
 */
import { ref, computed } from 'vue'
import { isMobilePlatform } from '../utils/platform'
import { startAndroidKeepAlive, stopAndroidKeepAlive } from '../utils/androidKeepAlive'
import { useSessionStore } from '../stores/sessionStore'
import { useI18n } from '../i18n'

export function useMobileKeyBar() {
  const sessionStore = useSessionStore()
  const { t } = useI18n()

  const isMobile = isMobilePlatform()
  const focusedTerminalSessionId = ref<string | null>(null)

  function updateFocusedTerminal(el: HTMLElement | null) {
    focusedTerminalSessionId.value = el?.classList?.contains('xterm-helper-textarea')
      ? el.closest<HTMLElement>('[data-terminal-session-id]')?.dataset.terminalSessionId || null
      : null
  }

  function onDocFocusIn(e: FocusEvent) {
    updateFocusedTerminal(e.target as HTMLElement | null)
  }
  function onDocFocusOut() {
    // Focus may move between xterm instances or to nothing; re-check after the
    // focusin/focusout pair settles.
    requestAnimationFrame(() => {
      updateFocusedTerminal(document.activeElement as HTMLElement | null)
    })
  }

  // ── Background keep-alive (Android) ──
  // Without a foreground service, Android freezes the cached process shortly
  // after the app is switched away — timers stop and network is suspended,
  // which drops live SSH/SFTP sessions. While the app is hidden with live
  // sessions, run the keep-alive foreground service (notification appears);
  // stop it when the app is visible again.
  function hasLiveSessions(): boolean {
    for (const s of sessionStore.sessions.values()) {
      if (s.status === 'connected' || s.status === 'connecting') return true
    }
    return false
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      if (hasLiveSessions()) {
        startAndroidKeepAlive('uniTerm', t('app.backgroundKeepAlive'))
      }
    } else {
      stopAndroidKeepAlive()
    }
  }

  const keyBarSessionId = computed(() => {
    const sessionId = focusedTerminalSessionId.value
    if (!isMobile || !sessionId) return null
    if (sessionStore.getStatus(sessionId) !== 'connected') return null
    return sessionId
  })

  function init() {
    if (!isMobile) return
    document.addEventListener('focusin', onDocFocusIn)
    document.addEventListener('focusout', onDocFocusOut)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function dispose() {
    if (isMobile) {
      document.removeEventListener('focusin', onDocFocusIn)
      document.removeEventListener('focusout', onDocFocusOut)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    stopAndroidKeepAlive()
  }

  return {
    isMobile,
    keyBarSessionId,
    init,
    dispose,
  }
}