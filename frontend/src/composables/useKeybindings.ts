/**
 * 全局快捷键与终端字体缩放逻辑 (A1 重构)
 *
 * 从 App.vue 下沉：
 *   - adjustFontSize / onWheel（Ctrl/Cmd+wheel 缩放）
 *   - macOS 系统快捷键（Cmd+Q / Cmd+W）
 *   - actionHandlers（ShortcutAction → 处理器）+ applyKeybindings
 *   - navigatePanel（分屏面板切换）
 *
 * App.vue 只需调用 useKeybindings(deps) 并在 onMounted 中 install，
 * 在 watch(settings.keyboard) 中调用返回的 applyKeybindings。
 */
import { ref, nextTick, type Ref } from 'vue'
import { Application } from '@wailsio/runtime'
import { useTabStore } from '../stores/tabStore'
import { usePanelStore } from '../stores/panelStore'
import { useCompanionStore } from '../stores/companionStore'
import { useAIStore } from '../stores/aiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { CloseSession } from '../../bindings/github.com/ys-ll/uniterm/app'
import { focusPanelTerminal } from './useFocusTerminal'
import { loadKeybindings, installGlobalListener, uninstallGlobalListener } from './useKeyboardShortcuts'
import type { ShortcutAction } from '../types/settings'

export interface KeybindingDeps {
  sidebarVisible: Ref<boolean>
  sidebarRef: Ref<any>
  aiSidebarRef: Ref<any>
  closeTab: (id: string) => void
  openSettings: () => void
  duplicateSession: (tab: any) => void
  onToggleAiLock: (panelId: string) => void
}

export function useKeybindings(deps: KeybindingDeps) {
  const tabStore = useTabStore()
  const panelStore = usePanelStore()
  const companionStore = useCompanionStore()
  const aiStore = useAIStore()
  const settingsStore = useSettingsStore()
  const { sidebarVisible, sidebarRef, aiSidebarRef, closeTab, openSettings, duplicateSession, onToggleAiLock } = deps

  // Adjust the terminal font size, clamped to the valid range. Shared by the
  // Ctrl/Cmd+wheel zoom and the zoom-font-in/out shortcuts.
  function adjustFontSize(delta: number) {
    const ts = settingsStore.settings.terminal
    const next = Math.max(8, Math.min(32, ts.fontSize + delta))
    if (next !== ts.fontSize) {
      ts.fontSize = next
      settingsStore.save()
    }
  }

  function onWheel(e: WheelEvent) {
    // Ctrl/Cmd + wheel zooms the terminal font — macOS (Cmd) and Windows/Linux
    // (Ctrl) alike. Skipped when the user disables it (issue #671, e.g. for
    // scroll-sensitive Mac mice); without preventDefault the wheel then scrolls
    // normally.
    if ((e.ctrlKey || e.metaKey) && settingsStore.settings.terminal.ctrlWheelZoom !== false) {
      e.preventDefault()
      adjustFontSize(e.deltaY < 0 ? 1 : -1)
    }
  }

  // macOS-only system shortcuts (issue #339): Cmd+Q quits, Cmd+W closes the
  // active tab. Guarded by isMac so Windows/Linux never see this behaviour —
  // there Ctrl+Q/W stay free for the terminal and the existing keybindings.
  const isMac = ref(false)
  function onMacSystemShortcut(e: KeyboardEvent) {
    if (!isMac.value || e.defaultPrevented) return
    if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    const key = e.key.toLowerCase()
    if (key === 'q') {
      e.preventDefault()
      Application.Quit()
    } else if (key === 'w') {
      e.preventDefault()
      const t = tabStore.activeTab
      if (t) closeTab(t.id)
    }
  }

  function navigatePanel(dir: number) {
    const t = tabStore.activeTab
    if (!t || t.type !== 'workspace') return
    if (t.panelIds.length <= 1) return
    const current = t.activePanelId || t.panelIds[0]
    const idx = t.panelIds.indexOf(current)
    if (idx < 0) return
    const next = t.panelIds[(idx + dir + t.panelIds.length) % t.panelIds.length]
    tabStore.setActivePanel(t.id, next)
  }

  // ── Keyboard shortcut handlers (module-level so watch can access them) ──
  const actionHandlers: Record<ShortcutAction, () => void> = {
    nextTab: () => tabStore.nextTab(),
    prevTab: () => tabStore.prevTab(),
    newConnection: () => { tabStore.createStartTab() },
    toggleSidebar: () => {
      if (sidebarVisible.value) {
        sidebarVisible.value = false
        const pid = tabStore.getActivePanelId()
        if (pid) nextTick(() => focusPanelTerminal(pid))
      } else {
        sidebarVisible.value = true
        nextTick(() => sidebarRef.value?.focusSearch())
      }
    },
    focusTerminal: () => {
      const pid = tabStore.getActivePanelId()
      if (pid) focusPanelTerminal(pid)
    },
    lockAI: () => {
      const t = tabStore.activeTab
      if (!t) return
      let panelId: string | null = null
      if (t.type === 'workspace') {
        panelId = t.activePanelId || t.panelIds[0] || null
      } else if (t.type === 'terminal') {
        panelId = t.panelId
      }
      if (panelId) onToggleAiLock(panelId)
    },
    focusAI: () => {
      if (aiStore.visible) {
        aiStore.visible = false
        const pid = tabStore.getActivePanelId()
        if (pid) nextTick(() => focusPanelTerminal(pid))
      } else {
        aiStore.visible = true
        nextTick(() => aiSidebarRef.value?.focusInput())
      }
    },
    closePanel: () => {
      const t = tabStore.activeTab
      if (!t) return
      if (t.locked) return
      if (t.type === 'workspace' && t.panelIds.length > 1) {
        const panelId = t.activePanelId || t.panelIds[t.panelIds.length - 1]
        const p = panelStore.getPanel(panelId)
        if (p?.sessionId) CloseSession(p.sessionId).catch(() => {})
        companionStore.disposeForPanel(panelId).catch(() => {})
        tabStore.removePanelFromWorkspaceTab(t.id, panelId)
        panelStore.removePanel(panelId)
      } else if (t.type === 'workspace' && t.panelIds.length === 1) {
        const panelId = t.panelIds[0]
        const p = panelStore.getPanel(panelId)
        if (p?.sessionId) CloseSession(p.sessionId).catch(() => {})
        companionStore.disposeForPanel(panelId).catch(() => {})
        tabStore.removePanelFromWorkspaceTab(t.id, panelId)
        panelStore.removePanel(panelId)
      } else {
        closeTab(t.id)
      }
    },
    terminalSearch: () => {
      const pid = tabStore.getActivePanelId()
      if (pid) window.dispatchEvent(new CustomEvent('terminal:open-search', { detail: { panelId: pid } }))
    },
    copy: () => {
      const pid = tabStore.getActivePanelId()
      if (pid) window.dispatchEvent(new CustomEvent('terminal:copy', { detail: { panelId: pid } }))
    },
    toggleLineNumbers: () => {
      // Line numbers / timestamps are global terminal settings, so these toggle
      // them directly rather than dispatching a per-panel event.
      const cur = settingsStore.settings.terminal.showLineNumbers ?? false
      settingsStore.updateTerminal({ showLineNumbers: !cur })
    },
    toggleTimestamps: () => {
      const cur = settingsStore.settings.terminal.showTimestamps ?? false
      settingsStore.updateTerminal({ showTimestamps: !cur })
    },
    zoomFontIn: () => adjustFontSize(1),
    zoomFontOut: () => adjustFontSize(-1),
    paste: () => {
      const pid = tabStore.getActivePanelId()
      if (pid) window.dispatchEvent(new CustomEvent('terminal:paste', { detail: { panelId: pid } }))
    },
    navigatePrev: () => navigatePanel(-1),
    navigateNext: () => navigatePanel(1),
    openSettings: () => openSettings(),
    duplicateSession: () => {
      // Same logic as the tab context menu's "复制会话": delegate to the shared
      // duplicate routine so both entry points behave identically.
      const tab = tabStore.activeTab
      if (!tab) return
      if (tab.type === 'workspace') {
        // A workspace holds several panels; the shortcut duplicates the focused
        // one (a terminal). Feed it to the shared routine as a terminal tab.
        const pid = tabStore.getActivePanelId()
        const panel = pid ? panelStore.getPanel(pid) : undefined
        if (panel) duplicateSession({ type: 'terminal', panelId: pid, title: panel.title })
        return
      }
      duplicateSession(tab)
    },
    openQuickCommands: () => {
      sidebarVisible.value = true
      nextTick(() => sidebarRef.value?.openQuickCommands())
    },
    maximizePanel: () => {
      const tab = tabStore.activeTab
      if (!tab || tab.type !== 'workspace' || !tab.activePanelId) return
      const panelId = tab.activePanelId
      tabStore.toggleWorkspacePanelMaximize(tab.id)
      nextTick(() => focusPanelTerminal(panelId))
    },
    toggleFilePanel: () => {
      companionStore.toggleFiles()
    },
    toggleMonitor: () => {
      companionStore.toggleMonitor()
    },
  }

  function applyKeybindings() {
    loadKeybindings(settingsStore.settings.keyboard, actionHandlers)
  }

  return {
    adjustFontSize,
    onWheel,
    isMac,
    onMacSystemShortcut,
    navigatePanel,
    actionHandlers,
    applyKeybindings,
    installGlobalListener,
    uninstallGlobalListener,
  }
}