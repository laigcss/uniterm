/**
 * useConnectionManager — 连接管理逻辑 (App.vue 拆分)
 *
 * 从 App.vue 下沉所有连接创建/启动/重连/恢复逻辑：
 *   - onConnect / onConnectOnly / onSidebarConnect / onSaveOnly
 *   - connectTerminalSession / workspaceConnectMember / openConnectionAtIndex
 *   - onCreateWorkspaceFromConfigs / onNewWorkspace
 *   - createLocalTerminal / createWslTerminal / createLocalTerminalWithShell
 *   - reconnectDatabasePanel / reconnectMonitorPanel / reconnectSftpPanel / onPanelReconnectEvent
 *   - maybeRestoreLastTabs / closeStartAndReposition
 *   - onNetscanNewConnection / onNewConnectionFromStart / onEditConnection
 *   - openFileBrowser / openMonitorPanel / getShellLabel
 *   - editConfig / showConnectionForm / pendingGroupId（响应式状态，模板绑定）
 *   - configureLauncher 调用（注入 ensureCredentials + closeStartAndReposition）
 *
 * App.vue 用法：
 *   const conn = useConnectionManager({ ensureCredentials, showCredentialDialog })
 *   // 模板绑定 conn.editConfig / conn.showConnectionForm / conn.pendingGroupId
 *   // 事件绑定 conn.onConnect / conn.onSidebarConnect / ...
 */
import { ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useConnectionStore } from '../stores/connectionStore'
import { useTabStore } from '../stores/tabStore'
import { usePanelStore } from '../stores/panelStore'
import { useSessionStore } from '../stores/sessionStore'

import { useSettingsStore } from '../stores/settingsStore'
import { useLocalStateStore } from '../stores/localStateStore'
import { useI18n } from '../i18n'
import {
  CreateSession, CloseSession, RecordRecentConnection, SessionStart,
} from '../../bindings/github.com/ys-ll/uniterm/app'
import { waitForTerminalSize } from '../services/terminalManager'
import { msg } from '../services/message'
import { parseQuickConnect } from '../utils/quickConnect'
import { getShellLabel as getShellLabelBase, parseWslFromShell } from '../utils/shellLabel'
import { reconnectFileTransferPanel } from './usePanelReconnect'
import {
  launchConnection, launchFileBrowser, launchMonitor, launchWslFileBrowser,
  persistConnection, configureLauncher,
} from './connectionLauncher'
import { openSavedWorkspace } from './savedWorkspace'
import { restoreTabsSnapshot, installTabSnapshotSaver } from './tabSnapshot'
import { createWorkspaceFromSelection } from './createWorkspace'
import type { ConnectionConfig } from '../types/session'

// placement (workspace targets only): where the new panel splits in relative
// to targetPanelId — used by the sidebar-connection-onto-workspace-panel drop.
interface WorkspacePlacement {
  targetPanelId: string
  direction: 'horizontal' | 'vertical'
  insertBefore: boolean
}

export interface ConnectionManagerDeps {
  ensureCredentials: (config: ConnectionConfig) => Promise<ConnectionConfig | null>
}

export function useConnectionManager(deps: ConnectionManagerDeps) {
  const connectionStore = useConnectionStore()
  const tabStore = useTabStore()
  const panelStore = usePanelStore()
  const sessionStore = useSessionStore()

  const settingsStore = useSettingsStore()
  const localStateStore = useLocalStateStore()
  const { t } = useI18n()
  const { ensureCredentials } = deps

  // ── Connection form state (bound to template) ──
  const showConnectionForm = ref(false)
  const editConfig = ref<ConnectionConfig | null>(null)
  const pendingGroupId = ref<string | undefined>(undefined)

  function getShellLabel(path: string): string {
    return getShellLabelBase(path, 'Local')
  }

  // Atomically remove a start tab and place a newly-created tab in its position.
  // Returns a cleanup function: call it AFTER creating the tab to reposition it.
  function closeStartAndReposition(prevTab: any): (newTabId: string) => void {
    const idx = tabStore.tabs.indexOf(prevTab)
    if (idx >= 0) tabStore.tabs.splice(idx, 1)
    return (newTabId: string) => {
      if (idx < 0) return
      const newIdx = tabStore.tabs.findIndex((t: any) => t.id === newTabId)
      if (newIdx < 0 || newIdx === idx) return
      const [moved] = tabStore.tabs.splice(newIdx, 1)
      tabStore.tabs.splice(Math.min(idx, tabStore.tabs.length), 0, moved)
    }
  }

  // Wire connectionLauncher with App-provided dependencies.
  configureLauncher({ ensureCredentials, closeStartAndReposition })

  function onSaveOnly(saveOnlyConfig: ConnectionConfig) {
    persistConnection(saveOnlyConfig, !!editConfig.value?.id)
    RecordRecentConnection(saveOnlyConfig.id)
  }

  // Transient connection ("connect only"): connect a new form config without
  // persisting it to the connection list. Reuses onConnect with persist=false.
  function onConnectOnly(config: ConnectionConfig) {
    editConfig.value = null
    onConnect(config, undefined, false, false)
  }

  // Companion entries that force a spec regardless of config.type (used by the
  // sidebar's `kind` routing and the app:connect-sftp / app:connect-monitor
  // window events).
  function onSidebarConnect(config: ConnectionConfig, kind?: 'file' | 'wsl-file' | 'monitor') {
    const prev = tabStore.activeTab
    const prevStart = prev?.type === 'start' ? prev : undefined
    if (kind === 'file') return void openFileBrowser(config, prevStart)
    if (kind === 'monitor') return void openMonitorPanel(config, prevStart)
    if (kind === 'wsl-file') return void launchWslFileBrowser(config, { prevStart })
    return onConnect(config)
  }

  function openFileBrowser(config: ConnectionConfig, prevStart?: any, afterTabId?: string, initialPath?: string) {
    return launchFileBrowser(config, { prevStart, afterTabId, initialPath })
  }

  function openMonitorPanel(config: ConnectionConfig, prevStart?: any, afterTabId?: string) {
    return launchMonitor(config, { prevStart, afterTabId })
  }

  async function onConnect(config: ConnectionConfig, keepOpen?: boolean, wasEdit?: boolean, persist = true, targetWorkspaceId?: string) {
    // Saved workspace connection: open it as a live workspace instead of the
    // per-type launch flow (no spec exists — and must not exist — for this type).
    if (config.type === 'workspace') {
      await openSavedWorkspace(config, { connectMember: workspaceConnectMember })
      return
    }
    const prev = tabStore.activeTab
    const prevStart = (prev?.type === 'start' && !keepOpen) ? prev : undefined
    await launchConnection(config, {
      persist,
      wasEdit,
      prevStart,
      connectTerminal: (c, p) => connectTerminalSession(c, p, prev, targetWorkspaceId),
    })
  }

  // Generic terminal connect path (ssh/telnet/mosh/local/wsl/tcp/serial).
  // Persistence bookkeeping happened in launchConnection. The type-specific
  // non-terminal specs live in connectionLauncher.ts.
  // Returns the created panel id so workspace orchestration (create/restore)
  // can remap layouts; status distinguishes credential-cancel from failure.
  async function connectTerminalSession(config: ConnectionConfig, persist: boolean, prev: any, targetWorkspaceId?: string, placement?: WorkspacePlacement): Promise<{ status: 'ok' | 'cancelled' | 'failed'; panelId?: string }> {
    // Credential check
    const resolved = await ensureCredentials(config)
    if (!resolved) return { status: 'cancelled' }
    config = resolved

    // Create session BEFORE panel so the terminal has a sessionId when it first
    // fires SessionResize. Otherwise the resize is silently dropped because the
    // terminal calls getSessionId() too early and never retries.
    //
    // Defer the actual Connect until BaseTerminal has mounted, fitAddon has
    // measured the real xterm cols/rows, and we can write that into
    // config.initialCols/Rows — otherwise the SSH/local PTY starts at the
    // default 80x24 and Claude Code draws its first batch of tables at that
    // width, drifting relative to later output that wraps at the real cols.
    let sessionId = ''
    try {
      const info = await CreateSession(config.type, {
        ...config,
        initialCols: 0,
        initialRows: 0,
      })
      sessionId = info.id
    } catch (e) {
      console.error('Failed to create session:', e)
      return { status: 'failed' }
    }

    const panel = panelStore.createPanel(config, config.type as any)
    const displayTitle = config.name || (config.type === 'local' || config.type === 'wsl'
      ? getShellLabel(config.shellPath || '')
      : config.type === 'serial'
      ? `${config.serialPort || 'Serial'} (${config.serialBaudRate || 115200})`
      : config.type === 'telnet'
      ? `${config.host}:${config.port}`
      : `${config.user}@${config.host}`)
    panelStore.updateTitle(panel.id, displayTitle)
    panelStore.bindSession(panel.id, sessionId)
    sessionStore.initSession(sessionId)
    const addedToWorkspace = targetWorkspaceId
      ? tabStore.addNewPanelToWorkspace(
          targetWorkspaceId,
          panel.id,
          placement?.targetPanelId,
          placement?.direction ?? 'horizontal',
          placement?.insertBefore ?? false
        )
      : false
    const tab = addedToWorkspace
      ? tabStore.tabs.find(t => t.id === targetWorkspaceId)!
      : prev?.type === 'start'
        ? tabStore.replaceStartTab(prev.id, panel.title, panel.id)
        : tabStore.createTerminalTab(panel.title, panel.id)
    panelStore.movePanelToTab(panel.id, tab.id)
    if (persist) RecordRecentConnection(config.id)

    // Wait for BaseTerminal to mount + fitAddon.fit() to compute the real
    // xterm cols/rows (which itself waits for document.fonts.ready + 2 rAFs
    // to ensure the actually-loaded font is being measured). Then start the
    // session with those dimensions so the remote PTY matches from byte 0.
    const size = await waitForTerminalSize(sessionId)
    if (size.cols > 0 && size.rows > 0) {
      config.initialCols = size.cols
      config.initialRows = size.rows
    }
    try {
      await SessionStart(sessionId, config)
    } catch (e) {
      console.error('Failed to start session:', e)
      // Session is registered in the backend but never connected — close it
      // so it doesn't leak until app shutdown. UI rollback is the caller's
      // responsibility (this helper is reused across connect / duplicate).
      CloseSession(sessionId).catch(() => {})
    }
    return { status: 'ok', panelId: panel.id }
  }

  // ── Workspace orchestration ──
  // One connect Member primitive shared by create-from-selection and open-saved;
  // wraps the generic terminal path with workspace targeting.
  function workspaceConnectMember(config: ConnectionConfig, workspaceTabId: string, persist: boolean) {
    return connectTerminalSession(config, persist, undefined, workspaceTabId)
  }

  // Sidebar connection dropped onto the tab bar: open it as a new tab at the
  // requested position. Works for every connection type — the connect flow is
  // the same as clicking the connection (workspace type opens as a workspace).
  // The new tab is created wherever the flow puts it, then moved into place.
  async function openConnectionAtIndex(config: ConnectionConfig, index: number) {
    const before = new Set(tabStore.tabs.map(t => t.id))
    await onConnect(config)
    const newTab = tabStore.tabs.find(t => !before.has(t.id))
    if (!newTab) return // nothing opened (credential cancelled / connect failed)
    const fromIdx = tabStore.tabs.findIndex(t => t.id === newTab.id)
    const toIdx = Math.max(0, Math.min(index, tabStore.tabs.length - 1))
    if (fromIdx !== toIdx) tabStore.moveTab(fromIdx, toIdx)
  }

  // Entry: 「在工作区打开 → 新建工作区」 from the sidebar/start-page context
  // menu (targets = the multi-selection or the right-clicked connection).
  async function onCreateWorkspaceFromConfigs(configs: ConnectionConfig[]) {
    await createWorkspaceFromSelection('', [], configs, { connectMember: workspaceConnectMember })
  }

  // Entry: 新建工作区 button (start page) — opens an empty workspace tab the
  // user fills by dragging connections / terminal tabs in. Point-and-click
  // creation from a selection lives in the「在工作区打开」context menu.
  function onNewWorkspace() {
    tabStore.createWorkspaceTab(tabStore.generateWorkspaceName(tabStore.tabs), [], { root: { type: 'leaf', panelId: '' } })
  }

  // ── Reopen last session's tabs (issue #937-4) ──
  // The snapshot itself is written continuously by installTabSnapshotSaver;
  // this is the startup half: prompt (when the setting is on) and re-open the
  // recorded tabs through the regular connect flows.
  async function maybeRestoreLastTabs() {
    if (!settingsStore.settings.restoreTabsPrompt) return
    const snapshot = localStateStore.state.lastTabsSnapshot
    if (!snapshot?.tabs?.length) return
    try {
      await ElMessageBox.confirm(
        t('start.restoreTabsMessage', { count: snapshot.tabs.length }),
        t('start.restoreTabsTitle'),
        {
          confirmButtonText: t('start.restoreTabsConfirm'),
          cancelButtonText: t('common.cancel'),
          type: 'info'
        }
      )
    } catch {
      // One-shot prompt: a decline means "don't offer these tabs again", so
      // drop the snapshot. It only re-accumulates once the user actually opens
      // tabs (the watcher in installTabSnapshotSaver re-records on change).
      localStateStore.update({ lastTabsSnapshot: null })
      return // user declined
    }
    await restoreTabsSnapshot(snapshot, {
      connectTerminal: (c, p) => connectTerminalSession(c, p, undefined),
      connectMember: workspaceConnectMember
    })
  }

  // ── Local / WSL terminal creation ──
  async function createLocalTerminalWithShell(shellPath: string, keepOpen?: boolean) {
    // A `wsl://<distro>` shell opens a dedicated WSL terminal (own session type),
    // everything else stays a normal local terminal.
    const distro = parseWslFromShell(shellPath)
    if (distro) return createWslTerminal(distro, keepOpen)
    await createLocalTerminal(shellPath, keepOpen)
  }

  async function createLocalTerminal(shellPath?: string, keepOpen?: boolean) {
    const panel = panelStore.createPanel(null, 'local')
    const shellName = getShellLabel(shellPath || '')
    panelStore.updateTitle(panel.id, shellName)

    try {
      // Use a stable ID based on shell type so repeated local terminals
      // merge into one recent-history entry instead of creating a new one
      // every time.
      const stableId = `local-terminal:${shellName.toLowerCase().replace(/\s+/g, '-')}`
      const config: ConnectionConfig = {
        id: stableId,
        name: shellName,
        type: 'local' as any,
        host: '',
        port: 0,
        user: '',
        authType: 'password' as any,
        shellPath: shellPath || undefined,
        initialCols: 0,
        initialRows: 0,
      }
      panel.config = config
      connectionStore.add(config)
      // Local terminal sessions are temporary — don't record in history
      const info = await CreateSession('local', config)
      panelStore.bindSession(panel.id, info.id)
      sessionStore.initSession(info.id)
      // Create tab AFTER session is bound so BaseTerminal mounts with valid sessionId
      const prev = tabStore.activeTab
      const tab = prev?.type === 'start' && !keepOpen
        ? tabStore.replaceStartTab(prev.id, panel.title, panel.id)
        : tabStore.createTerminalTab(panel.title, panel.id)
      panelStore.movePanelToTab(panel.id, tab.id)

      // Same as onConnect: measure the real xterm size, then start the PTY
      // at those dimensions.
      const size = await waitForTerminalSize(info.id)
      if (size.cols > 0 && size.rows > 0) {
        config.initialCols = size.cols
        config.initialRows = size.rows
      }
      try {
        await SessionStart(info.id, config)
      } catch (e) {
        console.error('Failed to start local session:', e)
        CloseSession(info.id).catch(() => {})
      }
    } catch (e) {
      console.error('Failed to create local terminal:', e)
      panelStore.removePanel(panel.id)
    }
  }

  // WSL terminal: a dedicated session type (`wsl`) that launches wsl.exe inside
  // the distro and supports the file sidebar via its companion WSL file session.
  async function createWslTerminal(distro: string, keepOpen?: boolean) {
    const shellPath = 'wsl://' + distro
    const panel = panelStore.createPanel(null, 'wsl')
    const shellName = getShellLabel(shellPath)
    panelStore.updateTitle(panel.id, shellName)

    try {
      const stableId = `wsl-terminal:${distro.toLowerCase().replace(/\s+/g, '-')}`
      const config: ConnectionConfig = {
        id: stableId,
        name: shellName,
        type: 'wsl' as any,
        host: '',
        port: 0,
        user: '',
        authType: 'password' as any,
        shellPath,
        initialCols: 0,
        initialRows: 0,
      }
      panel.config = config
      connectionStore.add(config)
      // WSL terminal sessions are temporary — don't record in history
      const info = await CreateSession('wsl', config)
      panelStore.bindSession(panel.id, info.id)
      sessionStore.initSession(info.id)
      const prev = tabStore.activeTab
      const tab = prev?.type === 'start' && !keepOpen
        ? tabStore.replaceStartTab(prev.id, panel.title, panel.id)
        : tabStore.createTerminalTab(panel.title, panel.id)
      panelStore.movePanelToTab(panel.id, tab.id)

      const size = await waitForTerminalSize(info.id)
      if (size.cols > 0 && size.rows > 0) {
        config.initialCols = size.cols
        config.initialRows = size.rows
      }
      try {
        await SessionStart(info.id, config)
      } catch (e) {
        console.error('Failed to start wsl session:', e)
        CloseSession(info.id).catch(() => {})
      }
    } catch (e) {
      console.error('Failed to create wsl terminal:', e)
      panelStore.removePanel(panel.id)
    }
  }

  // ── Panel reconnect (right-click 「重连」) ──
  // Force-reconnect a database-family panel (database/redis/mongodb/
  // elasticsearch) from the tab's right-click 「重连」(Reconnect) menu. These
  // sessions are created in connectionLauncher (runSpec), so — unlike terminal/
  // desktop panels — no content component owns the lifecycle: close the old
  // session, then create a fresh one and rebind the same panel.
  async function reconnectDatabasePanel(panel: { id: string; sessionId: string | null; config: ConnectionConfig | null }) {
    const oldId = panel.sessionId
    if (oldId) {
      try { await CloseSession(oldId) } catch (_) {}
    }
    const cfg = panel.config
    if (!cfg) return
    // Standalone NoSQL types carry their session type in config.type; the SQL
    // family stays on the generic 'database' session.
    const sessionType = cfg.type === 'redis' || cfg.type === 'mongodb' || cfg.type === 'elasticsearch'
      ? cfg.type
      : 'database'
    try {
      const info = await CreateSession(sessionType, cfg)
      panelStore.bindSession(panel.id, info.id)
      sessionStore.initSession(info.id)
    } catch (e: any) {
      panelStore.updateStatus(panel.id, 'error')
      msg.error(`${t('db.connectFailed')}: ${e?.message || String(e)}`)
    }
  }

  // Force-reconnect a monitor panel. The session is created in
  // connectionLauncher (runSpec), so it's re-initiated here like the database panels.
  async function reconnectMonitorPanel(panel: { id: string; sessionId: string | null; config: ConnectionConfig | null }) {
    const oldId = panel.sessionId
    if (oldId) {
      try { await CloseSession(oldId) } catch (_) {}
    }
    const cfg = panel.config
    if (!cfg) return
    try {
      const info = await CreateSession('monitor', cfg)
      panelStore.bindSession(panel.id, info.id)
      sessionStore.initSession(info.id)
    } catch (e: any) {
      panelStore.updateStatus(panel.id, 'error')
      msg.error(`${t('tab.reconnectFailed')}: ${e?.message || String(e)}`)
    }
  }

  // Force-reconnect a file-transfer panel (sftp/ftp/smb/webdav/s3). The actual
  // close→create→rebind orchestration lives in usePanelReconnect, shared with
  // the refresh-triggered auto-reconnect in the file tab content.
  async function reconnectSftpPanel(panel: { id: string; sessionId: string | null; config: ConnectionConfig | null }) {
    try {
      const newId = await reconnectFileTransferPanel(panel.id)
      if (!newId) panelStore.updateStatus(panel.id, 'error')
    } catch (e: any) {
      panelStore.updateStatus(panel.id, 'error')
      msg.error(`${t('tab.reconnectFailed')}: ${e?.message || String(e)}`)
    }
  }

  // Panel kinds whose sessions are created in connectionLauncher's database
  // family spec (shared 'database' panel type + own session kind).
  const DB_FAMILY_PANEL_TYPES = ['database', 'redis', 'mongodb', 'elasticsearch']

  function onPanelReconnectEvent(e: Event) {
    const panelId = (e as CustomEvent)?.detail?.panelId
    if (!panelId) return
    const panel = panelStore.getPanel(panelId)
    if (!panel) return
    // These session types are created in connectionLauncher (not in a content
    // component), so their right-click 「重连」(Reconnect) is handled here.
    // Terminal and desktop-protocol panels handle the same event themselves.
    if (DB_FAMILY_PANEL_TYPES.includes(panel.type)) reconnectDatabasePanel(panel)
    else if (panel.type === 'monitor') reconnectMonitorPanel(panel)
    else if (panel.type === 'sftp') reconnectSftpPanel(panel)
  }

  // ── Connection form entry points ──
  // Open the shared connection form prefilled with a network-scan result.
  // editConfig without an id means "new connection, prefilled" in ConnectionForm;
  // the type is mapped from the service port when it is a known one, otherwise
  // the form's default type applies and the user picks it themselves.
  function onNetscanNewConnection(d: { host: string; port?: number; type?: string }) {
    const cfg: any = { host: d.host, port: d.port ?? 22 }
    if (d.type) cfg.type = d.type
    editConfig.value = cfg as ConnectionConfig
    showConnectionForm.value = true
  }

  function onNewConnectionFromStart(payload?: { host?: string; groupId?: string; type?: string }) {
    pendingGroupId.value = payload?.groupId
    if (payload?.host) {
      const parsed = parseQuickConnect(payload.host)
      editConfig.value = (parsed || { host: payload.host }) as ConnectionConfig
    } else if (payload?.type) {
      editConfig.value = { type: payload.type } as ConnectionConfig
    } else {
      editConfig.value = null
    }
    showConnectionForm.value = true
  }

  function onEditConnection(config: ConnectionConfig) {
    editConfig.value = config
    showConnectionForm.value = true
  }

  return {
    // state
    showConnectionForm,
    editConfig,
    pendingGroupId,
    // connection flows
    onConnect,
    onConnectOnly,
    onSidebarConnect,
    onSaveOnly,
    connectTerminalSession,
    workspaceConnectMember,
    openConnectionAtIndex,
    onCreateWorkspaceFromConfigs,
    onNewWorkspace,
    maybeRestoreLastTabs,
    closeStartAndReposition,
    // local terminal
    createLocalTerminal,
    createWslTerminal,
    createLocalTerminalWithShell,
    getShellLabel,
    // reconnect
    onPanelReconnectEvent,
    // connection form entry points
    onNetscanNewConnection,
    onNewConnectionFromStart,
    onEditConnection,
    // file browser / monitor
    openFileBrowser,
    openMonitorPanel,
    // snapshot
    installTabSnapshotSaver,
  }
}