/**
 * useRdpEmbedding — RDP ActiveX 嵌入管理 composable.
 *
 * 从 App.vue 提取的 RDP 位置同步 / overlay 跟踪 / 全屏处理 / 快照背景逻辑。
 * 原代码内联在 App.vue 中（~200 行），本 composable 将其封装为可复用的独立单元，
 * 使 App.vue 可以采用上游版本而保持本地 RDP 嵌入功能不变。
 *
 * 职责：
 *   - rdpSyncPosition: 将 .rdp-area 的位置/尺寸同步到原生 RDP 子窗口
 *   - RDPHideForOverlay / RDPShowForOverlay: 引用计数 overlay 遮挡管理
 *     （菜单/对话框/拖拽/resize 时隐藏原生窗口，用快照占位，恢复时先 Show 再清快照）
 *   - 全屏暂停同步 + 恢复
 *   - rdp:adaptive 事件（断开重连期间冻结帧）
 *   - ResizeObserver 监听 .rdp-area 尺寸变化
 *   - tab 切换时 show/hide 原生窗口
 */
import { ref, nextTick, type ComputedRef, type Ref } from 'vue'
import { Events } from '@wailsio/runtime'
import {
  RDPHide,
  RDPShow,
  RDPInvalidate,
  RDPSnapshot,
  RDPSetPosition,
} from '../../bindings/github.com/ys-ll/uniterm/app'

interface RdpTabLike {
  type?: string
  panelId?: string
}

interface RdpEmbeddingOptions {
  /** 当前活动 tab（computed 或 ref） */
  activeTab: ComputedRef<RdpTabLike | undefined> | Ref<RdpTabLike | undefined>
  /** panel store，需提供 getPanel(panelId) → { sessionId?: string } */
  panelStore: {
    getPanel: (panelId?: string) => { sessionId?: string } | undefined
  }
}

export function useRdpEmbedding(options: RdpEmbeddingOptions) {
  const { activeTab, panelStore } = options

  // ── 状态 ──
  /** overlay 引用计数：>0 表示有菜单/对话框/拖拽遮挡，原生窗口应隐藏 */
  const rdpOverlayCount = ref(0)
  /** 原生 ActiveX 全屏激活时为 true，暂停位置同步 */
  const rdpFullScreen = ref(false)
  /** 恢复原生窗口的延迟定时器 */
  let rdpRestoreTimer: ReturnType<typeof setTimeout> | null = null
  /** 监听 .rdp-area 尺寸变化的 observer */
  let rdpAreaObserver: ResizeObserver | null = null

  // ── 事件取消函数 ──
  let unsubRdpFullscreenExit: (() => void) | null = null
  let unsubRdpMoveResizeStart: (() => void) | null = null
  let unsubRdpMoveResizeEnd: (() => void) | null = null
  let unsubRdpAdaptive: (() => void) | null = null

  // ── 辅助 ──

  /** 获取当前活动 RDP tab 的 session ID */
  function getActiveRdpSessionId(): string | null {
    const tab = activeTab.value
    if (!tab || tab.type !== 'rdp') return null
    return panelStore.getPanel(tab.panelId)?.sessionId ?? null
  }

  /** 设置 .rdp-area 的冻结快照背景 */
  function setRdpSnapshotBg(url: string) {
    const area = document.querySelector('.rdp-area') as HTMLElement | null
    if (area) {
      area.style.backgroundImage = `url(${url})`
      area.style.backgroundSize = '100% 100%'
      area.style.backgroundRepeat = 'no-repeat'
    }
  }

  /** 清除 .rdp-area 的冻结快照背景 */
  function clearRdpSnapshotBg() {
    const area = document.querySelector('.rdp-area') as HTMLElement | null
    if (area) {
      area.style.backgroundImage = ''
      area.style.backgroundSize = ''
      area.style.backgroundRepeat = ''
    }
  }

  // ── RDP position sync ──
  // Called explicitly on tab switch and overlay restore; no polling needed.

  /** 将 .rdp-area 的位置/尺寸同步到原生 RDP 子窗口 */
  function rdpSyncPosition() {
    if (rdpOverlayCount.value > 0) return
    // While in native ActiveX full screen, don't fight it with SetPosition.
    if (rdpFullScreen.value) return
    const area = document.querySelector('.rdp-area') as HTMLElement | null
    if (!area) return
    const sid = getActiveRdpSessionId()
    if (!sid) return
    const rect = area.getBoundingClientRect()
    if (rect.width <= 0) return
    const dpr = window.devicePixelRatio || 1
    // Parent-client-relative offset: the RDP window is a WS_CHILD of the main
    // window, so rect.left/top (webview viewport coords == client-area coords)
    // are used directly by the backend's placeAtChild. No window.screenLeft/screenTop
    // — those are top-level window coords and were the cause of the RDP popup
    // lagging behind / sticking on a moved main window.
    const x = Math.round(rect.left * dpr)
    const y = Math.round(rect.top * dpr)

    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    RDPSetPosition(sid, x, y, w, h)
  }

  /** 下一帧同步位置 */
  function rdpResetTracking() {
    nextTick(() => rdpSyncPosition())
  }

  // Native ActiveX full-screen: pause position sync while active, restore on exit.
  function onRdpFullScreenEnter() {
    rdpFullScreen.value = true
  }
  function onRdpFullScreenExit() {
    rdpFullScreen.value = false
    nextTick(() => rdpSyncPosition())
  }

  // ── RDP overlay tracking: unified show/hide entry points ──
  // ALL triggers (context menus, dialogs, drag, resize, external events)
  // MUST call RDPHideForOverlay() to hide and RDPShowForOverlay() to restore.
  // Reference-counted: nesting works correctly across multiple concurrent triggers.

  /** 遮挡开始：引用计数 +1，首次时截屏并隐藏原生窗口 */
  function RDPHideForOverlay() {
    rdpOverlayCount.value++
    if (rdpOverlayCount.value === 1) {
      const sid = getActiveRdpSessionId()
      if (sid) {
        // Capture the current RDP frame while the window is still visible,
        // show it as a frozen .rdp-area background, THEN hide the live window
        // — so the area shows a snapshot instead of a black placeholder while
        // a menu/dialog is open. The image is pre-decoded via <img> so the
        // frozen frame is available the instant the live window drops away
        // (avoids a decode gap → dark flash).
        RDPSnapshot(sid)
          .then((snap: string) => {
            if (!snap) { RDPHide(sid); return }
            const url = `data:image/png;base64,${snap}`
            const img = new Image()
            img.onload = () => {
              setRdpSnapshotBg(url)
              RDPHide(sid)
            }
            img.onerror = () => { RDPHide(sid) }
            img.src = url
          })
          .catch(() => { RDPHide(sid) })
      }
    }
  }

  /** 遮挡结束：引用计数 -1，归零时恢复原生窗口并清除快照 */
  function RDPShowForOverlay() {
    if (rdpOverlayCount.value > 0) rdpOverlayCount.value--
    if (rdpRestoreTimer) clearTimeout(rdpRestoreTimer)
    rdpRestoreTimer = setTimeout(() => {
      rdpRestoreTimer = null
      if (rdpOverlayCount.value === 0) {
        const tab = activeTab.value
        if (!tab || tab.type !== 'rdp') return
        const sid = panelStore.getPanel(tab.panelId)?.sessionId
        if (sid) {
          // Restore the live window FIRST (it covers .rdp-area), then clear
          // the frozen snapshot only after it is confirmed back on top —
          // clearing while the live frame is visible is invisible, so there
          // is no dark gap between the snapshot and the live frame.
          rdpResetTracking()
          nextTick(() => {
            RDPShow(sid)
            // Kick a repaint: Show() early-returns on the re-show path (the
            // position sync already set the window visible), so this is what
            // forces mstscax to present its frame and avoids a black flash.
            RDPInvalidate(sid)
            setTimeout(() => {
              rdpSyncPosition()
              clearRdpSnapshotBg()
            }, 200)
          })
        }
      }
    }, 150)
  }

  // ── 生命周期 ──

  /** 在 onMounted 中调用：注册所有 RDP 事件监听和 observer */
  function setup() {
    // RDP overlay tracking
    window.addEventListener('rdp:overlay-push', RDPHideForOverlay)
    window.addEventListener('rdp:overlay-pop', RDPShowForOverlay)
    window.addEventListener('split:resize-start', RDPHideForOverlay)
    window.addEventListener('split:resize-end', RDPShowForOverlay)
    window.addEventListener('rdp:sync-position', rdpResetTracking)
    // RDP native full-screen enter/exit
    window.addEventListener('rdp:fullscreen-enter', onRdpFullScreenEnter)
    // Exit is emitted from Go when the user uses the connection bar's restore button.
    unsubRdpFullscreenExit = Events.On('rdp:fullscreen-exit', () => onRdpFullScreenExit())

    // Go-side WndProc events: window move/resize start/end. The RDP window is a
    // WS_CHILD, so it moves with the main window automatically; only a resize of
    // the .rdp-area (or a re-show after an overlay) needs a position sync.
    unsubRdpMoveResizeStart = Events.On('rdp:move-resize-start', () => {}) // no-op: child follows; don't hide it mid-drag
    unsubRdpMoveResizeEnd = Events.On('rdp:move-resize-end', () => {
      setTimeout(() => {
        rdpSyncPosition()
        const tab = activeTab.value
        if (tab?.type === 'rdp') {
          const sid = panelStore.getPanel(tab.panelId)?.sessionId
          if (sid) nextTick(() => RDPShow(sid))
        }
      }, 100)
    })

    // Keep native RDP window position in sync when the .rdp-area changes size
    rdpAreaObserver = new ResizeObserver(() => rdpSyncPosition())
    const observeRdpArea = () => {
      const area = document.querySelector('.rdp-area')
      if (area) rdpAreaObserver!.observe(area)
    }
    observeRdpArea()
    nextTick(observeRdpArea)

    // Adaptive resize lifecycle: freeze the last good frame over .rdp-area for
    // the disconnect/reconnect cycle, restore the live window at the end.
    unsubRdpAdaptive = Events.On('rdp:adaptive', (ev: any) => {
      const d = ev?.data as { id: string; event: string; snapshot?: string }
      if (!d?.id || d.id !== getActiveRdpSessionId()) return
      if (d.event === 'start') {
        if (rdpOverlayCount.value > 0 || !d.snapshot) return
        const url = `data:image/png;base64,${d.snapshot}`
        const img = new Image()
        img.onload = () => {
          const sid = getActiveRdpSessionId()
          if (!sid) return
          setRdpSnapshotBg(url)
          RDPHide(sid)
        }
        img.src = url
      } else if (d.event === 'end') {
        if (rdpOverlayCount.value > 0) return
        const sid = getActiveRdpSessionId()
        if (sid) {
          RDPShow(sid)
          RDPInvalidate(sid)
        }
        setTimeout(() => {
          rdpSyncPosition()
          clearRdpSnapshotBg()
        }, 300)
      }
    })
  }

  /** 在 onUnmounted 中调用：清理所有事件监听和 observer */
  function teardown() {
    // RDP overlay tracking
    window.removeEventListener('rdp:overlay-push', RDPHideForOverlay)
    window.removeEventListener('rdp:overlay-pop', RDPShowForOverlay)
    window.removeEventListener('split:resize-start', RDPHideForOverlay)
    window.removeEventListener('split:resize-end', RDPShowForOverlay)
    window.removeEventListener('rdp:sync-position', rdpResetTracking)
    window.removeEventListener('rdp:fullscreen-enter', onRdpFullScreenEnter)
    // Wails EventsOn teardown
    unsubRdpFullscreenExit?.()
    unsubRdpMoveResizeStart?.()
    unsubRdpMoveResizeEnd?.()
    unsubRdpAdaptive?.()
    rdpAreaObserver?.disconnect()
    if (rdpRestoreTimer) { clearTimeout(rdpRestoreTimer); rdpRestoreTimer = null }
  }

  /**
   * 在 tab switch watch 中调用。
   * 返回 false 表示已处理（不需要 auto-focus），true 表示需要继续 auto-focus。
   * 实际上总是返回 true（auto-focus 逻辑由调用方处理），这里只做 RDP show/hide。
   */
  function onTabSwitch(newTab: RdpTabLike | undefined, oldTab: RdpTabLike | undefined) {
    if (oldTab?.type === 'rdp') {
      const p = panelStore.getPanel(oldTab.panelId)
      if (p?.sessionId) RDPHide(p.sessionId)
    }
    // Clear pending restore timer on tab switch
    if (rdpRestoreTimer) { clearTimeout(rdpRestoreTimer); rdpRestoreTimer = null }
    if (newTab?.type === 'rdp') {
      rdpResetTracking()
      const sid = panelStore.getPanel(newTab.panelId)?.sessionId
      if (sid) nextTick(() => RDPShow(sid))
    }
  }

  return {
    // overlay 管理
    RDPHideForOverlay,
    RDPShowForOverlay,
    // 位置同步
    rdpSyncPosition,
    rdpResetTracking,
    // 生命周期
    setup,
    teardown,
    // tab 切换
    onTabSwitch,
  }
}