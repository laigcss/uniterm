// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'


vi.mock('element-plus', () => ({ ElMessageBox: { confirm: vi.fn() } }))
vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: { value: 'en' } }),
}))

const M = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  closeSessionMock: vi.fn(),
  recordRecentMock: vi.fn(),
  sessionStartMock: vi.fn(),
  waitForTerminalSizeMock: vi.fn(),
  msgErrorMock: vi.fn(),
  parseQuickConnectMock: vi.fn(),
  getShellLabelBaseMock: vi.fn(),
  parseWslFromShellMock: vi.fn(),
  reconnectFileTransferPanelMock: vi.fn(),
  launchConnectionMock: vi.fn(),
  launchFileBrowserMock: vi.fn(),
  launchMonitorMock: vi.fn(),
  launchWslFileBrowserMock: vi.fn(),
  persistConnectionMock: vi.fn(),
  configureLauncherMock: vi.fn(),
  openSavedWorkspaceMock: vi.fn(),
  restoreTabsSnapshotMock: vi.fn(),
  installTabSnapshotSaverMock: vi.fn(),
  createWorkspaceFromSelectionMock: vi.fn(),
  connectionStoreMock: { connections: [] as any[], load: vi.fn(), add: vi.fn(), dispose: vi.fn() },
  tabStoreMock: {
    tabs: [] as any[],
    activeTab: null as any,
    createStartTab: vi.fn(),
    createTerminalTab: vi.fn(() => ({ id: 'tt' })),
    createWorkspaceTab: vi.fn(),
    replaceStartTab: vi.fn(() => ({ id: 'rt' })),
    moveTab: vi.fn(),
    addNewPanelToWorkspace: vi.fn(() => false),
    generateWorkspaceName: vi.fn(() => 'Workspace 1'),
  },
  panelStoreMock: {
    createPanel: vi.fn(() => ({ id: 'p1', title: 't' })),
    updateTitle: vi.fn(),
    bindSession: vi.fn(),
    movePanelToTab: vi.fn(),
    getPanel: vi.fn((_id?: any): any => null),
    removePanel: vi.fn(),
    updateStatus: vi.fn(),
  },
  sessionStoreMock: { initSession: vi.fn(), updateStatus: vi.fn() },
  settingsStoreMock: {
    settings: { restoreTabsPrompt: false } as any,
    save: vi.fn(),
    dispose: vi.fn(),
  },
  localStateStoreMock: {
    state: { sidebarVisible: false, lastTabsSnapshot: null as any } as any,
    init: vi.fn(async () => {}),
    update: vi.fn(),
  },
}))

vi.mock('../../bindings/github.com/ys-ll/uniterm/app', () => ({
  CreateSession: M.createSessionMock,
  CloseSession: M.closeSessionMock,
  RecordRecentConnection: M.recordRecentMock,
  SessionStart: M.sessionStartMock,
}))
vi.mock('../services/terminalManager', () => ({ waitForTerminalSize: M.waitForTerminalSizeMock }))
vi.mock('../services/message', () => ({ msg: { error: M.msgErrorMock } }))
vi.mock('../utils/quickConnect', () => ({ parseQuickConnect: M.parseQuickConnectMock }))
vi.mock('../utils/shellLabel', () => ({
  getShellLabel: M.getShellLabelBaseMock,
  parseWslFromShell: M.parseWslFromShellMock,
}))
vi.mock('./usePanelReconnect', () => ({ reconnectFileTransferPanel: M.reconnectFileTransferPanelMock }))
vi.mock('./connectionLauncher', () => ({
  launchConnection: M.launchConnectionMock,
  launchFileBrowser: M.launchFileBrowserMock,
  launchMonitor: M.launchMonitorMock,
  launchWslFileBrowser: M.launchWslFileBrowserMock,
  persistConnection: M.persistConnectionMock,
  configureLauncher: M.configureLauncherMock,
}))
vi.mock('./savedWorkspace', () => ({ openSavedWorkspace: M.openSavedWorkspaceMock }))
vi.mock('./tabSnapshot', () => ({
  restoreTabsSnapshot: M.restoreTabsSnapshotMock,
  installTabSnapshotSaver: M.installTabSnapshotSaverMock,
}))
vi.mock('./createWorkspace', () => ({ createWorkspaceFromSelection: M.createWorkspaceFromSelectionMock }))
vi.mock('../stores/connectionStore', () => ({ useConnectionStore: () => M.connectionStoreMock }))
vi.mock('../stores/tabStore', () => ({ useTabStore: () => M.tabStoreMock }))
vi.mock('../stores/panelStore', () => ({ usePanelStore: () => M.panelStoreMock }))
vi.mock('../stores/sessionStore', () => ({ useSessionStore: () => M.sessionStoreMock }))
vi.mock('../stores/settingsStore', () => ({ useSettingsStore: () => M.settingsStoreMock }))
vi.mock('../stores/localStateStore', () => ({ useLocalStateStore: () => M.localStateStoreMock }))

import { ElMessageBox } from 'element-plus'
import { useConnectionManager } from './useConnectionManager'

beforeEach(() => {
  vi.clearAllMocks()
  M.tabStoreMock.tabs = []
  M.tabStoreMock.activeTab = null
  M.connectionStoreMock.connections = []
  M.panelStoreMock.getPanel.mockReturnValue(null)
  M.settingsStoreMock.settings.restoreTabsPrompt = false
  M.localStateStoreMock.state.lastTabsSnapshot = null
  M.createSessionMock.mockResolvedValue({ id: 'sess-1' })
  M.closeSessionMock.mockResolvedValue(undefined)
  M.sessionStartMock.mockResolvedValue(undefined)
  M.recordRecentMock.mockResolvedValue(undefined)
  M.waitForTerminalSizeMock.mockResolvedValue({ cols: 100, rows: 30 })
  M.getShellLabelBaseMock.mockReturnValue('Bash')
  M.parseWslFromShellMock.mockReturnValue(null)
  ;(ElMessageBox.confirm as any).mockResolvedValue(true)
})

function makeDeps() {
  return { ensureCredentials: vi.fn(async (c: any) => c) }
}

describe('useConnectionManager — state & getShellLabel', () => {
  it('initializes reactive form state', () => {
    const cm = useConnectionManager(makeDeps())
    expect(cm.showConnectionForm.value).toBe(false)
    expect(cm.editConfig.value).toBeNull()
    expect(cm.pendingGroupId.value).toBeUndefined()
  })

  it('getShellLabel delegates to getShellLabelBase with "Local"', () => {
    M.getShellLabelBaseMock.mockReturnValue('Zsh')
    const cm = useConnectionManager(makeDeps())
    expect(cm.getShellLabel('/bin/zsh')).toBe('Zsh')
    expect(M.getShellLabelBaseMock).toHaveBeenCalledWith('/bin/zsh', 'Local')
  })
})

describe('useConnectionManager — closeStartAndReposition', () => {
  it('removes the start tab and returns a reposition function', () => {
    const startTab = { id: 'start', type: 'start' }
    const other = { id: 'other' }
    M.tabStoreMock.tabs = [startTab, other]
    const cm = useConnectionManager(makeDeps())
    const reposition = cm.closeStartAndReposition(startTab)
    expect(M.tabStoreMock.tabs.length).toBe(1)
    // reposition is a no-op when newTabId is not found
    reposition('nonexistent')
    expect(M.tabStoreMock.tabs.length).toBe(1)
  })
})

describe('useConnectionManager — onSaveOnly', () => {
  it('persists the config and records it as recent', () => {
    const cm = useConnectionManager(makeDeps())
    cm.editConfig.value = null
    const cfg = { id: 'c1' } as any
    cm.onSaveOnly(cfg)
    expect(M.persistConnectionMock).toHaveBeenCalledWith(cfg, false)
    expect(M.recordRecentMock).toHaveBeenCalledWith('c1')
  })

  it('passes wasEdit=true when editConfig has an id', () => {
    const cm = useConnectionManager(makeDeps())
    cm.editConfig.value = { id: 'existing' } as any
    cm.onSaveOnly({ id: 'c2' } as any)
    expect(M.persistConnectionMock).toHaveBeenCalledWith(expect.any(Object), true)
  })
})

describe('useConnectionManager — onSidebarConnect', () => {
  it('routes to openFileBrowser for kind "file"', () => {
    const cm = useConnectionManager(makeDeps())
    const cfg = { id: 'c1' } as any
    cm.onSidebarConnect(cfg, 'file')
    expect(M.launchFileBrowserMock).toHaveBeenCalled()
  })

  it('routes to openMonitorPanel for kind "monitor"', () => {
    const cm = useConnectionManager(makeDeps())
    cm.onSidebarConnect({ id: 'c1' } as any, 'monitor')
    expect(M.launchMonitorMock).toHaveBeenCalled()
  })

  it('routes to launchWslFileBrowser for kind "wsl-file"', () => {
    const cm = useConnectionManager(makeDeps())
    cm.onSidebarConnect({ id: 'c1' } as any, 'wsl-file')
    expect(M.launchWslFileBrowserMock).toHaveBeenCalled()
  })

  it('falls back to onConnect for no kind', () => {
    const cm = useConnectionManager(makeDeps())
    cm.onSidebarConnect({ id: 'c1', type: 'ssh' } as any)
    expect(M.launchConnectionMock).toHaveBeenCalled()
  })
})

describe('useConnectionManager — onConnect', () => {
  it('opens a saved workspace for workspace type', async () => {
    const cm = useConnectionManager(makeDeps())
    await cm.onConnect({ id: 'w1', type: 'workspace' } as any)
    expect(M.openSavedWorkspaceMock).toHaveBeenCalled()
    expect(M.launchConnectionMock).not.toHaveBeenCalled()
  })

  it('launches the connection for non-workspace types', async () => {
    const cm = useConnectionManager(makeDeps())
    await cm.onConnect({ id: 'c1', type: 'ssh' } as any)
    expect(M.launchConnectionMock).toHaveBeenCalled()
  })
})

describe('useConnectionManager — connectTerminalSession', () => {
  function sshConfig() {
    return { id: 'c1', type: 'ssh', name: 'srv', host: 'h', port: 22, user: 'u', authType: 'password' } as any
  }

  it('returns cancelled when ensureCredentials returns null', async () => {
    const deps = makeDeps()
    deps.ensureCredentials.mockResolvedValue(null)
    const cm = useConnectionManager(deps)
    const result = await cm.connectTerminalSession(sshConfig(), true, undefined)
    expect(result.status).toBe('cancelled')
  })

  it('returns failed when CreateSession throws', async () => {
    M.createSessionMock.mockRejectedValue(new Error('no backend'))
    const cm = useConnectionManager(makeDeps())
    const result = await cm.connectTerminalSession(sshConfig(), true, undefined)
    expect(result.status).toBe('failed')
  })

  it('creates session, panel, tab and starts the session on success', async () => {
    const cm = useConnectionManager(makeDeps())
    const cfg = sshConfig()
    const result = await cm.connectTerminalSession(cfg, true, undefined)
    expect(result.status).toBe('ok')
    expect(result.panelId).toBe('p1')
    expect(M.createSessionMock).toHaveBeenCalledWith('ssh', expect.objectContaining({ initialCols: 0, initialRows: 0 }))
    expect(M.panelStoreMock.createPanel).toHaveBeenCalled()
    expect(M.panelStoreMock.bindSession).toHaveBeenCalledWith('p1', 'sess-1')
    expect(M.sessionStoreMock.initSession).toHaveBeenCalledWith('sess-1')
    expect(M.recordRecentMock).toHaveBeenCalledWith('c1')
    expect(M.sessionStartMock).toHaveBeenCalledWith('sess-1', expect.objectContaining({ initialCols: 100, initialRows: 30 }))
  })

  it('closes the session when SessionStart fails', async () => {
    M.sessionStartMock.mockRejectedValue(new Error('start failed'))
    const cm = useConnectionManager(makeDeps())
    const result = await cm.connectTerminalSession(sshConfig(), true, undefined)
    expect(result.status).toBe('ok')
    expect(M.closeSessionMock).toHaveBeenCalledWith('sess-1')
  })

  it('does not record recent connection when persist is false', async () => {
    const cm = useConnectionManager(makeDeps())
    await cm.connectTerminalSession(sshConfig(), false, undefined)
    expect(M.recordRecentMock).not.toHaveBeenCalled()
  })
})

describe('useConnectionManager — onNewWorkspace', () => {
  it('creates a workspace tab', () => {
    const cm = useConnectionManager(makeDeps())
    cm.onNewWorkspace()
    expect(M.tabStoreMock.createWorkspaceTab).toHaveBeenCalled()
  })
})

describe('useConnectionManager — maybeRestoreLastTabs', () => {
  it('returns early when restoreTabsPrompt is disabled', async () => {
    const cm = useConnectionManager(makeDeps())
    await cm.maybeRestoreLastTabs()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })

  it('returns early when no snapshot exists', async () => {
    M.settingsStoreMock.settings.restoreTabsPrompt = true
    const cm = useConnectionManager(makeDeps())
    await cm.maybeRestoreLastTabs()
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
  })

  it('prompts and restores when a snapshot exists and setting is on', async () => {
    M.settingsStoreMock.settings.restoreTabsPrompt = true
    M.localStateStoreMock.state.lastTabsSnapshot = { tabs: [{ id: 't1' }] }
    const cm = useConnectionManager(makeDeps())
    await cm.maybeRestoreLastTabs()
    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(M.restoreTabsSnapshotMock).toHaveBeenCalled()
  })

  it('drops the snapshot when the user declines', async () => {
    M.settingsStoreMock.settings.restoreTabsPrompt = true
    M.localStateStoreMock.state.lastTabsSnapshot = { tabs: [{ id: 't1' }] }
    ;(ElMessageBox.confirm as any).mockRejectedValue('cancel')
    const cm = useConnectionManager(makeDeps())
    await cm.maybeRestoreLastTabs()
    expect(M.localStateStoreMock.update).toHaveBeenCalledWith({ lastTabsSnapshot: null })
    expect(M.restoreTabsSnapshotMock).not.toHaveBeenCalled()
  })
})

describe('useConnectionManager — createLocalTerminalWithShell', () => {
  it('creates a WSL terminal for wsl:// paths', async () => {
    M.parseWslFromShellMock.mockReturnValue('Ubuntu')
    const cm = useConnectionManager(makeDeps())
    await cm.createLocalTerminalWithShell('wsl://Ubuntu')
    expect(M.createSessionMock).toHaveBeenCalledWith('wsl', expect.any(Object))
  })

  it('creates a local terminal for regular shell paths', async () => {
    M.parseWslFromShellMock.mockReturnValue(null)
    const cm = useConnectionManager(makeDeps())
    await cm.createLocalTerminalWithShell('/bin/bash')
    expect(M.createSessionMock).toHaveBeenCalledWith('local', expect.any(Object))
  })
})

describe('useConnectionManager — reconnectDatabasePanel', () => {

  it('onPanelReconnectEvent routes database panels to reconnectDatabasePanel', async () => {
    const cm = useConnectionManager(makeDeps())
    const panel = { id: 'p1', sessionId: 'old', type: 'database', config: { id: 'c1', type: 'database' } }
    M.panelStoreMock.getPanel.mockReturnValue(panel)
    M.createSessionMock.mockResolvedValue({ id: 'new' })
    cm.onPanelReconnectEvent(new CustomEvent('panel:reconnect', { detail: { panelId: 'p1' } }))
    await vi.waitFor(() => expect(M.closeSessionMock).toHaveBeenCalledWith('old'))
  })

  it('onPanelReconnectEvent routes monitor panels to reconnectMonitorPanel', async () => {
    const cm = useConnectionManager(makeDeps())
    const panel = { id: 'p1', sessionId: 'old', type: 'monitor', config: { id: 'c1', type: 'monitor' } }
    M.panelStoreMock.getPanel.mockReturnValue(panel)
    M.createSessionMock.mockResolvedValue({ id: 'new' })
    cm.onPanelReconnectEvent(new CustomEvent('panel:reconnect', { detail: { panelId: 'p1' } }))
    await vi.waitFor(() => expect(M.createSessionMock).toHaveBeenCalledWith('monitor', expect.any(Object)))
  })

  it('onPanelReconnectEvent routes sftp panels to reconnectSftpPanel', async () => {
    const cm = useConnectionManager(makeDeps())
    const panel = { id: 'p1', sessionId: 'old', type: 'sftp', config: { id: 'c1', type: 'sftp' } }
    M.panelStoreMock.getPanel.mockReturnValue(panel)
    M.reconnectFileTransferPanelMock.mockResolvedValue('new-sess')
    cm.onPanelReconnectEvent(new CustomEvent('panel:reconnect', { detail: { panelId: 'p1' } }))
    await vi.waitFor(() => expect(M.reconnectFileTransferPanelMock).toHaveBeenCalledWith('p1'))
  })

  it('onPanelReconnectEvent does nothing without a panelId', () => {
    const cm = useConnectionManager(makeDeps())
    expect(() => cm.onPanelReconnectEvent(new CustomEvent('panel:reconnect', {}))).not.toThrow()
  })
})

describe('useConnectionManager — form entry points', () => {
  it('onNetscanNewConnection sets editConfig and opens the form', () => {
    const cm = useConnectionManager(makeDeps())
    cm.onNetscanNewConnection({ host: '1.2.3.4', port: 22, type: 'ssh' })
    expect(cm.editConfig.value).toEqual(expect.objectContaining({ host: '1.2.3.4', port: 22, type: 'ssh' }))
    expect(cm.showConnectionForm.value).toBe(true)
  })

  it('onNetscanNewConnection defaults port to 22', () => {
    const cm = useConnectionManager(makeDeps())
    cm.onNetscanNewConnection({ host: 'h' })
    expect(cm.editConfig.value).toEqual(expect.objectContaining({ host: 'h', port: 22 }))
  })

  it('onNewConnectionFromStart sets pendingGroupId and opens form', () => {
    const cm = useConnectionManager(makeDeps())
    cm.onNewConnectionFromStart({ groupId: 'g1' })
    expect(cm.pendingGroupId.value).toBe('g1')
    expect(cm.showConnectionForm.value).toBe(true)
  })

  it('onNewConnectionFromStart parses quick connect host', () => {
    M.parseQuickConnectMock.mockReturnValue({ host: 'parsed', user: 'u' })
    const cm = useConnectionManager(makeDeps())
    cm.onNewConnectionFromStart({ host: 'u@h' })
    expect(cm.editConfig.value).toEqual(expect.objectContaining({ host: 'parsed', user: 'u' }))
  })

  it('onNewConnectionFromStart sets type-only config when no host', () => {
    const cm = useConnectionManager(makeDeps())
    cm.onNewConnectionFromStart({ type: 'ssh' })
    expect(cm.editConfig.value).toEqual({ type: 'ssh' })
  })

  it('onNewConnectionFromStart clears editConfig with no payload', () => {
    const cm = useConnectionManager(makeDeps())
    cm.onNewConnectionFromStart()
    expect(cm.editConfig.value).toBeNull()
    expect(cm.showConnectionForm.value).toBe(true)
  })

  it('onEditConnection sets the config and opens the form', () => {
    const cm = useConnectionManager(makeDeps())
    const cfg = { id: 'c1', type: 'ssh' } as any
    cm.onEditConnection(cfg)
    expect(cm.editConfig.value).toEqual(cfg)
    expect(cm.showConnectionForm.value).toBe(true)
  })
})

describe('useConnectionManager — openFileBrowser / openMonitorPanel', () => {
  it('openFileBrowser delegates to launchFileBrowser', () => {
    const cm = useConnectionManager(makeDeps())
    const cfg = { id: 'c1' } as any
    cm.openFileBrowser(cfg, undefined, 'tab-1', '/path')
    expect(M.launchFileBrowserMock).toHaveBeenCalledWith(cfg, { prevStart: undefined, afterTabId: 'tab-1', initialPath: '/path' })
  })

  it('openMonitorPanel delegates to launchMonitor', () => {
    const cm = useConnectionManager(makeDeps())
    cm.openMonitorPanel({ id: 'c1' } as any, undefined, 'tab-1')
    expect(M.launchMonitorMock).toHaveBeenCalledWith({ id: 'c1' }, { prevStart: undefined, afterTabId: 'tab-1' })
  })
})