/**
 * useTabManager — Tab 管理逻辑 (App.vue 拆分)
 *
 * 从 App.vue 下沉：
 *   - createNewTab（"+" 按钮 / newConnection 快捷键）
 *   - closeTab / closeTabBatch（关闭单个/批量，含连接确认对话框）
 *   - onTabDragStart
 *   - getPanelConfig / getPanelSessionId / k8sConnectionForTab（模板辅助）
 *
 * App.vue 用法：
 *   const tabMgr = useTabManager({ rdpEmbedding, createLocalTerminalWithShell })
 *   // 模板/事件绑定 tabMgr.closeTab / tabMgr.closeTabBatch / tabMgr.createNewTab / ...
 */
import { ref, h, nextTick } from 'vue'
import { ElMessageBox, ElCheckbox } from 'element-plus'
import { useTabStore } from '../stores/tabStore'
import { usePanelStore } from '../stores/panelStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useContainerStore } from '../stores/containerStore'
import { useCompanionStore } from '../stores/companionStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useI18n } from '../i18n'
import { CloseSession } from '../../bindings/github.com/ys-ll/uniterm/app'
import { unregisterTransferRoute } from '../services/transferTaskCenter'
import type { ConnectionConfig } from '../types/session'

export interface TabManagerDeps {
  rdpEmbedding: {
    RDPHideForOverlay: () => void
    RDPShowForOverlay: () => void
  }
  createLocalTerminalWithShell: (shellPath: string, keepOpen?: boolean) => Promise<void>
}

export function useTabManager(deps: TabManagerDeps) {
  const tabStore = useTabStore()
  const panelStore = usePanelStore()
  const sessionStore = useSessionStore()
  const settingsStore = useSettingsStore()
  const containerStore = useContainerStore()
  const companionStore = useCompanionStore()
  const connectionStore = useConnectionStore()
  const { t } = useI18n()
  const { rdpEmbedding, createLocalTerminalWithShell } = deps

  // What the tab bar "+" button (relayed from TabsList) and the newConnection
  // shortcut open (issue #1043): the start page by default, or a local terminal
  // with the default shell when newTabAction says so. No shell available ->
  // fall back to the start page.
  function createNewTab() {
    if (settingsStore.settings.newTabAction === 'localTerminal') {
      const shells = settingsStore.availableShells
      const preferred = settingsStore.settings.defaultLocalShell
      const shell = preferred && shells.includes(preferred) ? preferred : shells[0]
      if (shell) {
        createLocalTerminalWithShell(shell)
        return
      }
    }
    tabStore.createStartTab()
  }

  async function closeTab(tabId: string, opts: { skipConfirm?: boolean } = {}) {
    // Close session before removing panel to clean up Go-side resources
    const tab = tabStore.tabs.find(t => t.id === tabId)
    if (tab?.locked) return
    if (tab && tab.type === 'start') {
      tabStore.closeTab(tabId)
      nextTick(() => {
        if (tabStore.tabs.length === 0) {
          tabStore.createStartTab()
        }
      })
      return
    }
    // Confirm before closing connected sessions to prevent accidental disconnect
    if (tab && tab.type !== 'settings' && tab.type !== 'netscan' && !opts.skipConfirm) {
      const panelIds = tab.type === 'workspace' ? tab.panelIds : 'panelId' in tab ? [tab.panelId] : []
      const hasConnected = panelIds.some(pid => {
        const p = panelStore.getPanel(pid)
        if (!p?.sessionId) return false
        return sessionStore.getStatus(p.sessionId) === 'connected'
      })
      if (hasConnected) {
        if (!settingsStore.settings.closeTabPrompt) {
          // skip dialog, proceed to close
        } else {
          const dontShowAgain = ref(false)
          // Hide the native RDP window so the dialog isn't covered by it (issue #346)
          rdpEmbedding.RDPHideForOverlay()
          try {
            await ElMessageBox.confirm(
              h('div', { style: 'display:flex;flex-direction:column;gap:0.625rem' }, [
                h('span', t('tab.closeConnectedConfirm')),
                h(ElCheckbox, {
                  'onUpdate:modelValue': (v: boolean) => { dontShowAgain.value = v }
                } as any, () => t('tab.dontShowAgain'))
              ]),
              t('tab.closeConfirmTitle'),
              { confirmButtonText: t('tab.close'), cancelButtonText: t('conn.cancel'), type: 'warning' }
            )
          } catch {
            return
          } finally {
            rdpEmbedding.RDPShowForOverlay()
          }
          if (dontShowAgain.value) {
            settingsStore.settings.closeTabPrompt = false
            settingsStore.save()
          }
        }
      }
    }
    if (tab && tab.type === 'rdp') {
      const p = panelStore.getPanel(tab.panelId)
      if (p?.sessionId) {
        try { await CloseSession(p.sessionId) } catch (_) {}
      }
    }
    // Close VNC session
    if (tab && tab.type === 'vnc') {
      const p = panelStore.getPanel(tab.panelId)
      if (p?.sessionId) {
        try { await CloseSession(p.sessionId) } catch (_) {}
      }
      panelStore.disconnectVNCCache(tab.panelId)
      panelStore.removeVNCCache(tab.panelId)
    }
    // Close SPICE session
    if (tab && tab.type === 'spice') {
      const p = panelStore.getPanel(tab.panelId)
      if (p?.sessionId) {
        try { await CloseSession(p.sessionId) } catch (_) {}
      }
      panelStore.disconnectSPICECache(tab.panelId)
      panelStore.removeSPICECache(tab.panelId)
    }
    // Close database session
    if (tab && tab.type === 'database') {
      const p = panelStore.getPanel(tab.panelId)
      if (p?.sessionId) {
        try { await CloseSession(p.sessionId) } catch (_) {}
      }
    }
    // Close redis session
    if (tab && (tab.type === 'redis' || tab.type === 'mongodb' || tab.type === 'elasticsearch')) {
      const p = panelStore.getPanel(tab.panelId)
      if (p?.sessionId) {
        try { await CloseSession(p.sessionId) } catch (_) {}
      }
    }
    // Close monitor session
    if (tab && tab.type === 'monitor') {
      const p = panelStore.getPanel(tab.panelId)
      if (p?.sessionId) {
        try { await CloseSession(p.sessionId) } catch (_) {}
      }
    }
    // Close container session (KeepAlive may keep the component mounted, so the
    // poll timer + backend connection in containerStore must be closed explicitly)
    if (tab && tab.type === 'container') {
      containerStore.close(tab.id)
    }
    // Terminal sessions must be explicitly closed to terminate the connection/shell process
    if (tab && tab.type === 'terminal') {
      const p = panelStore.getPanel(tab.panelId)
      if (p?.sessionId) {
        try { await CloseSession(p.sessionId) } catch (_) {}
      }
    }
    // Workspace: close each panel session
    if (tab && tab.type === 'workspace') {
      for (const pid of tab.panelIds) {
        const p = panelStore.getPanel(pid)
        if (p?.sessionId) {
          try { await CloseSession(p.sessionId) } catch (_) {}
        }
      }
    }
    // X11 desktop session cleanup
    if (tab && tab.type === 'x11-desktop') {
      const p = panelStore.getPanel(tab.panelId)
      if (p?.sessionId) {
        try { await CloseSession(p.sessionId) } catch (_) {}
      }
    }
    const panelIds = tabStore.closeTab(tabId)
    // Dispose SSH companion sidebars (sftp/monitor) bound to these panels
    companionStore.disposeForPanels(panelIds).catch(() => {})
    panelIds.forEach(pid => {
      // Drop transfer-event routing and the panel's task list at close time —
      // KeepAlive may keep the tab component cached, so its onUnmounted (if any)
      // can run much later or never.
      const p = panelStore.getPanel(pid)
      if (p?.sessionId) unregisterTransferRoute(p.sessionId)
      panelStore.removeTransferTasks(pid)
    })
    panelIds.forEach(pid => panelStore.removePanel(pid))
    nextTick(() => {
      if (tabStore.tabs.length === 0) {
        tabStore.createStartTab()
      }
    })
  }

  // Batch close (close left/right/others). Consolidate the "has connected
  // sessions" confirmation into a single dialog so users don't get one prompt
  // per tab, and honor "don't show again" for the current batch too.
  async function closeTabBatch(tabIds: string[]) {
    if (!tabIds.length) return
    const targets = tabIds
      .map(id => tabStore.tabs.find(t => t.id === id))
      .filter((t): t is NonNullable<typeof t> => !!t && !t.locked)
    if (!targets.length) return

    const connectedCount = targets.reduce((n, tab) => {
      if (tab.type === 'settings' || tab.type === 'start' || tab.type === 'netscan') return n
      const panelIds = tab.type === 'workspace' ? tab.panelIds : 'panelId' in tab ? [tab.panelId] : []
      const hit = panelIds.some(pid => {
        const p = panelStore.getPanel(pid)
        if (!p?.sessionId) return false
        return sessionStore.getStatus(p.sessionId) === 'connected'
      })
      return hit ? n + 1 : n
    }, 0)

    if (connectedCount > 0 && settingsStore.settings.closeTabPrompt) {
      const dontShowAgain = ref(false)
      try {
        await ElMessageBox.confirm(
          h('div', { style: 'display:flex;flex-direction:column;gap:0.625rem' }, [
            h('span', t('tab.closeConnectedBatchConfirm', { count: connectedCount })),
            h(ElCheckbox, {
              'onUpdate:modelValue': (v: boolean) => { dontShowAgain.value = v }
            } as any, () => t('tab.dontShowAgain'))
          ]),
          t('tab.closeConfirmTitle'),
          { confirmButtonText: t('tab.close'), cancelButtonText: t('conn.cancel'), type: 'warning' }
        )
      } catch {
        return
      }
      if (dontShowAgain.value) {
        settingsStore.settings.closeTabPrompt = false
        settingsStore.save()
      }
    }

    for (const tab of targets) {
      await closeTab(tab.id, { skipConfirm: true })
    }
  }

  function onTabDragStart(_e: DragEvent, _tabId: string) {
    // Data is set in TabItem
  }

  function getPanelConfig(panelId: string | undefined): ConnectionConfig | null {
    if (!panelId) return null
    return panelStore.getPanel(panelId)?.config || null
  }

  function getPanelSessionId(panelId: string | undefined): string | null {
    if (!panelId) return null
    return panelStore.getPanel(panelId)?.sessionId || null
  }

  function k8sConnectionForTab(tab: any): ConnectionConfig {
    const conn = connectionStore.connections.find((c: ConnectionConfig) => c.id === tab.connectionId)
    return conn || ({
      id: tab.connectionId,
      name: tab.name,
      type: 'k8s',
      host: '',
      port: 0,
      user: '',
      authType: 'password',
      k8sConfigPath: '',
      k8sConfigInline: '',
      k8sContext: '',
      k8sNamespace: '',
    } as ConnectionConfig)
  }

  return {
    createNewTab,
    closeTab,
    closeTabBatch,
    onTabDragStart,
    getPanelConfig,
    getPanelSessionId,
    k8sConnectionForTab,
  }
}