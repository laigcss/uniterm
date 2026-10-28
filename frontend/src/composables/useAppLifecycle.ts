/**
 * useAppLifecycle — onMounted/onUnmounted 事件注册与清理 (App.vue 拆分)
 *
 * 从 App.vue 下沉 onMounted 中的初始化/事件注册逻辑和 onUnmounted 中的清理逻辑：
 *   - stores 初始化 (connection/ai/updateCheck/localState/quickCommand/tunnel)
 *   - 背景图加载、sidebar 状态恢复、start tab 自动打开
 *   - tab 快照恢复 + 持续保存
 *   - noVNC 预加载
 *   - document/window 事件监听 (wheel/keydown/input:contextmenu/panel:reconnect)
 *   - Wails EventsOn (tray menu / terminal:cwd)
 *   - app:connect-* 系列窗口事件（sidebar/start 拖放连接）
 *   - 平台检测 (GetPlatform → isMac / dataset.platform)
 *   - terminal focus restore 安装
 *   - RDP embedding setup/teardown
 *   - onUnmounted 清理所有监听 + store dispose
 *
 * App.vue 用法：
 *   const lifecycle = useAppLifecycle(deps)
 *   onMounted(() => lifecycle.init())
 *   onUnmounted(() => lifecycle.dispose())
 */
import { type Ref } from 'vue'
import { Events } from '@wailsio/runtime'
import { isMobilePlatform } from '../utils/platform'
import { useConnectionStore } from '../stores/connectionStore'
import { useTabStore } from '../stores/tabStore'
import { useAIStore } from '../stores/aiStore'
import { useCompanionStore } from '../stores/companionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useQuickCommandStore } from '../stores/quickCommandStore'
import { useTunnelStore } from '../stores/tunnelStore'
import { useLocalStateStore } from '../stores/localStateStore'
import { useSyncStore } from '../stores/syncStore'
import { useSkillStore } from '../stores/skillStore'
import { useCommandStore } from '../stores/commandStore'
import { disposeSessionStore } from '../stores/sessionStore'
import { useCredentialStore } from '../stores/credentialStore'
import { useUpdateCheck } from './useUpdateCheck'
import { installTerminalFocusRestore } from './useFocusTerminal'
import { launchConnection, launchWslFileBrowser, launchContainerFileBrowser } from './connectionLauncher'
import { GetPlatform, SessionGetCwd } from '../../bindings/github.com/ys-ll/uniterm/app'
import type { ConnectionConfig } from '../types/session'

export interface AppLifecycleDeps {
  sidebarVisible: Ref<boolean>
  // 来自 useMobileKeyBar
  mobileKeyBar: { init: () => void; dispose: () => void; isMobile: boolean }
  // 来自 useContextMenu
  contextMenu: { init: () => void; dispose: () => void }
  // 来自 useMcpApproval
  mcpApproval: { init: () => void; dispose: () => void }
  // 来自 useKeybindings
  keybindings: {
    isMac: Ref<boolean>
    onWheel: (e: WheelEvent) => void
    onPlatformSystemShortcut: (e: KeyboardEvent) => void
    applyKeybindings: () => void
    installGlobalListener: () => void
    uninstallGlobalListener: () => void
  }
  // rdpEmbedding
  rdpEmbedding: { setup: () => void; teardown: () => void }
  // 来自 useConnectionManager
  connectionManager: {
    maybeRestoreLastTabs: () => Promise<void>
    installTabSnapshotSaver: () => void
    onConnect: (config: ConnectionConfig, keepOpen?: boolean, wasEdit?: boolean, persist?: boolean, targetWorkspaceId?: string) => Promise<void>
    connectTerminalSession: (config: ConnectionConfig, persist: boolean, prev: any, targetWorkspaceId?: string, placement?: any) => Promise<any>
    openConnectionAtIndex: (config: ConnectionConfig, index: number) => Promise<void>
    openFileBrowser: (config: ConnectionConfig, prevStart?: any, afterTabId?: string, initialPath?: string) => any
    openMonitorPanel: (config: ConnectionConfig, prevStart?: any, afterTabId?: string) => any
    onPanelReconnectEvent: (e: Event) => void
  }
  // 来自 useAppDialogs
  dialogs: {
    openSettings: (category?: string) => void
    openNetscan: () => void
  }
  // 凭据检查
  checkCredentials: () => Promise<void>
  // 背景图加载
  loadBackgroundImage: () => Promise<void>
}

export function useAppLifecycle(deps: AppLifecycleDeps) {
  const connectionStore = useConnectionStore()
  const tabStore = useTabStore()
  const aiStore = useAIStore()
  const companionStore = useCompanionStore()
  const settingsStore = useSettingsStore()
  const localStateStore = useLocalStateStore()
  const syncStore = useSyncStore()
  const tunnelStore = useTunnelStore()
  const credStore = useCredentialStore()
  const updateCheck = useUpdateCheck()

  let uninstallFocusRestore: (() => void) | null = null
  let unsubTrayOpenSettings: (() => void) | null = null
  let unsubTrayOpenAbout: (() => void) | null = null
  let unsubTrayOpenNetscan: (() => void) | null = null
  let unsubTerminalCwd: (() => void) | null = null

  const { sidebarVisible, mobileKeyBar, contextMenu, mcpApproval, keybindings, rdpEmbedding, connectionManager, dialogs, checkCredentials, loadBackgroundImage } = deps

  async function init() {
    connectionStore.load()
    aiStore.init()
    updateCheck.initAutoCheck()

    // Load local-only state (sidebar visibility, background image, etc.)
    await localStateStore.init()
    await loadBackgroundImage()
    // Mobile always opens with both sidebars closed, regardless of the
    // persisted desktop state — screen space is too tight to restore panels.
    sidebarVisible.value = isMobilePlatform()
      ? false
      : (localStateStore.state.sidebarVisible ?? false)
    // Pre-load quick commands so suggestions can read them immediately
    useQuickCommandStore().load()
    // Pre-load tunnels so auto-start state and the panel are ready
    useTunnelStore().load()
    // Auto-open start tab if no tabs are open
    if (tabStore.tabs.length === 0) {
      tabStore.createStartTab()
    }
    // Reopen-last-session prompt (issue #937): ask before touching tabs, then
    // start recording so the snapshot always mirrors what's open. Not awaited —
    // the dialog must not block the rest of the mount sequence.
    connectionManager.maybeRestoreLastTabs()
    connectionManager.installTabSnapshotSaver()
    // Pre-load noVNC so VNC tab switches don't pay the dynamic import cost.
    import('@novnc/novnc').then((m: any) => {
      ;(window as any).__novnc_RFB = m.default || m
    }).catch(() => {})

    // ── Event listeners ──
    mobileKeyBar.init()
    contextMenu.init()
    mcpApproval.init()

    // Capture phase: xterm v6's viewport stopPropagation()s wheel events it
    // scrolls, but bails on defaultPrevented — so we must preempt it.
    document.addEventListener('wheel', keybindings.onWheel, { passive: false, capture: true })

    // macOS system shortcuts (Cmd+Q / Cmd+W) — the digit shortcuts in
    // onPlatformSystemShortcut are armed on every platform.
    try {
      const platform = await GetPlatform()
      keybindings.isMac.value = platform === 'darwin'
      // Expose for platform-specific CSS (e.g. dialog close-button styles)
      document.documentElement.dataset.platform = platform
    } catch {
      keybindings.isMac.value = false
    }
    document.addEventListener('keydown', keybindings.onPlatformSystemShortcut, true)

    // Keyboard shortcuts — load once on mount, watch for settings changes
    keybindings.applyKeybindings()
    keybindings.installGlobalListener()

    // Restore terminal focus after window drags and sidebar scrollbar clicks
    // (issue #285) — see composables/useFocusTerminal.ts for the policy.
    uninstallFocusRestore = installTerminalFocusRestore()

    // RDP ActiveX embedding: position sync, overlay tracking, fullscreen, snapshot
    rdpEmbedding.setup()

    // ── Wails EventsOn ──
    // Tray menu: "Settings" / "About" show the window (Go side) then land here.
    unsubTrayOpenSettings = Events.On('app:open-settings', () => dialogs.openSettings())
    unsubTrayOpenAbout = Events.On('app:open-about', () => dialogs.openSettings('about'))
    unsubTrayOpenNetscan = Events.On('app:open-netscan', () => dialogs.openNetscan())

    // Remember every terminal session's last reported cwd (OSC 7) regardless of
    // the file sidebar's follow toggle — enabling follow or opening an SFTP view
    // jumps straight to this directory.
    unsubTerminalCwd = Events.On('terminal:cwd', (ev) => {
      const p = ev?.data as { sessionId?: string; cwd?: string } | undefined
      if (p?.sessionId && p.cwd) companionStore.recordSessionCwd(p.sessionId, p.cwd)
    })

    // ── Panel/Tab/StartTab menu actions ──
    registerAppConnectEvents()

    // DB/Redis/Mongo tabs create their connection via connectionLauncher (runSpec),
    // not in a content component, so their right-click 「重连」(Reconnect) is handled here.
    // Terminal and desktop-protocol panels handle the same event themselves.
    window.addEventListener('panel:reconnect', connectionManager.onPanelReconnectEvent)

    await checkCredentials()
  }

  // Register all app:connect-* window events (sidebar/start drag-drop connections).
  function registerAppConnectEvents() {
    // Sidebar connection dropped onto a workspace panel: connect it and split
    // in at the drop position (see WorkspaceContent.onPanelDrop Case 0).
    window.addEventListener('app:connect-workspace-panel', ((e: CustomEvent) => {
      const { config, workspaceTabId, targetPanelId, direction, insertBefore } = e.detail || {}
      if (config && workspaceTabId) {
        connectionManager.connectTerminalSession(config, true, undefined, workspaceTabId, { targetPanelId, direction, insertBefore })
      }
    }) as EventListener)
    window.addEventListener('app:open-connection-at', ((e: CustomEvent) => {
      const { connId, index } = e.detail || {}
      const c = connId ? connectionStore.connections.find(x => x.id === connId) : undefined
      if (c) void connectionManager.openConnectionAtIndex(c, typeof index === 'number' ? index : tabStore.tabs.length)
    }) as EventListener)
    window.addEventListener('app:connect-sftp', (async (e: CustomEvent) => {
      const d = e.detail; const c = d?.config || d
      if (c) {
        const prev = tabStore.activeTab
        // Explicit initialPath (sidebar "open standalone tab") wins; otherwise
        // fall back to the terminal's last recorded cwd (right-click "open SFTP").
        let initialPath = d?.initialPath || (d?.sessionId ? companionStore.sessionCwd[d.sessionId] : '')
        if (!d?.initialPath && d?.sessionId) {
          try {
            const current = await SessionGetCwd(d.sessionId)
            if (current) {
              initialPath = current
              companionStore.recordSessionCwd(d.sessionId, current)
            }
          } catch { /* The recorded directory remains the fallback. */ }
        }
        connectionManager.openFileBrowser(c, prev?.type === 'start' ? prev : undefined, d?.sourceTabId, initialPath)
      }
    }) as unknown as EventListener)
    window.addEventListener('app:connect-terminal', ((e: CustomEvent) => {
      const d = e.detail; const c = d?.config || d; if (c) connectionManager.onConnect(c)
    }) as EventListener)
    window.addEventListener('app:connect-wsl-file', ((e: CustomEvent) => {
      const d = e.detail; const c = d?.config || d; if (c) { const prev = tabStore.activeTab; launchWslFileBrowser(c, { prevStart: prev?.type === 'start' ? prev : undefined, afterTabId: d?.sourceTabId, initialPath: d?.initialPath }) }
    }) as EventListener)
    window.addEventListener('app:connect-container-file', ((e: CustomEvent) => {
      const d = e.detail; const c = d?.config || d; if (c) { const prev = tabStore.activeTab; launchContainerFileBrowser(c, { prevStart: prev?.type === 'start' ? prev : undefined, afterTabId: d?.sourceTabId, initialPath: d?.initialPath }) }
    }) as EventListener)
    window.addEventListener('app:connect-monitor', ((e: CustomEvent) => {
      const d = e.detail; const c = d?.config || d; if (c) { const prev = tabStore.activeTab; connectionManager.openMonitorPanel(c, prev?.type === 'start' ? prev : undefined, d?.sourceTabId) }
    }) as EventListener)
    // Desktop protocol / DB / K8s / file-transfer protocol connections all go through launchConnection.
    for (const evt of ['app:connect-rdp', 'app:connect-vnc', 'app:connect-spice', 'app:connect-x11-desktop', 'app:connect-db', 'app:connect-k8s', 'app:connect-ftp', 'app:connect-smb', 'app:connect-webdav', 'app:connect-s3']) {
      window.addEventListener(evt, ((e: CustomEvent) => {
        const d = e.detail; const c = d?.config || d; if (c) { const prev = tabStore.activeTab; launchConnection(c, { prevStart: prev?.type === 'start' ? prev : undefined }) }
      }) as EventListener)
    }
  }

  function dispose() {
    keybindings.uninstallGlobalListener()
    uninstallFocusRestore?.()
    updateCheck.dispose()
    mobileKeyBar.dispose()
    contextMenu.dispose()
    mcpApproval.dispose()
    document.removeEventListener('wheel', keybindings.onWheel, { capture: true })
    document.removeEventListener('keydown', keybindings.onPlatformSystemShortcut, true)
    window.removeEventListener('panel:reconnect', connectionManager.onPanelReconnectEvent)
    // RDP ActiveX embedding teardown
    rdpEmbedding.teardown()
    // Wails EventsOn teardown (FE-03)
    unsubTrayOpenSettings?.()
    unsubTrayOpenAbout?.()
    unsubTrayOpenNetscan?.()
    unsubTerminalCwd?.()
    settingsStore.dispose?.()
    connectionStore.dispose?.()
    syncStore.dispose?.()
    tunnelStore.dispose?.()
    useSkillStore().dispose?.()
    useCommandStore().$dispose()
    disposeSessionStore?.()
    credStore.dispose()
  }

  return { init, dispose }
}