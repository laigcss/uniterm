// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

const M = vi.hoisted(() => ({
  eventsOnMock: vi.fn(() => () => {}),
  isMobileMock: vi.fn(() => false),
  getPlatformMock: vi.fn(async () => 'linux'),
  sessionGetCwdMock: vi.fn(async () => ''),
  installFocusRestoreMock: vi.fn(() => () => {}),
  launchConnectionMock: vi.fn(),
  launchWslFileBrowserMock: vi.fn(),
  launchContainerFileBrowserMock: vi.fn(),
  updateCheckMock: { initAutoCheck: vi.fn(), dispose: vi.fn() },
  connectionStoreMock: { load: vi.fn(), dispose: vi.fn() },
  tabStoreMock: { tabs: [] as any[], createStartTab: vi.fn(), activeTab: null as any },
  aiStoreMock: { init: vi.fn(), visible: false },
  companionStoreMock: { recordSessionCwd: vi.fn(), sessionCwd: {} },
  settingsStoreMock: { settings: {}, dispose: vi.fn() },
  localStateStoreMock: { state: { sidebarVisible: false }, init: vi.fn(async () => {}) },
  syncStoreMock: { dispose: vi.fn() },
  tunnelStoreMock: { load: vi.fn(), dispose: vi.fn() },
  credStoreMock: { dispose: vi.fn() },
  quickCommandStoreMock: { load: vi.fn() },
  skillStoreMock: { dispose: vi.fn() },
  commandStoreMock: { $dispose: vi.fn() },
}))

vi.mock('@wailsio/runtime', () => ({ Events: { On: M.eventsOnMock } }))
vi.mock('../utils/platform', () => ({
  isMobilePlatform: M.isMobileMock,
  detectPlatformSync: vi.fn(() => 'linux'),
  isPhoneLayout: ref(false),
  isNarrowScreen: ref(false),
}))
vi.mock('../../bindings/github.com/ys-ll/uniterm/app', () => ({
  GetPlatform: M.getPlatformMock,
  SessionGetCwd: M.sessionGetCwdMock,
}))
vi.mock('./useUpdateCheck', () => ({ useUpdateCheck: () => M.updateCheckMock }))
vi.mock('./useFocusTerminal', () => ({
  installTerminalFocusRestore: M.installFocusRestoreMock,
  focusPanelTerminal: vi.fn(),
}))
vi.mock('./connectionLauncher', () => ({
  launchConnection: M.launchConnectionMock,
  launchWslFileBrowser: M.launchWslFileBrowserMock,
  launchContainerFileBrowser: M.launchContainerFileBrowserMock,
}))
vi.mock('../stores/connectionStore', () => ({ useConnectionStore: () => M.connectionStoreMock }))
vi.mock('../stores/tabStore', () => ({ useTabStore: () => M.tabStoreMock }))
vi.mock('../stores/aiStore', () => ({ useAIStore: () => M.aiStoreMock }))
vi.mock('../stores/companionStore', () => ({ useCompanionStore: () => M.companionStoreMock }))
vi.mock('../stores/settingsStore', () => ({ useSettingsStore: () => M.settingsStoreMock }))
vi.mock('../stores/localStateStore', () => ({ useLocalStateStore: () => M.localStateStoreMock }))
vi.mock('../stores/syncStore', () => ({ useSyncStore: () => M.syncStoreMock }))
vi.mock('../stores/tunnelStore', () => ({ useTunnelStore: () => M.tunnelStoreMock }))
vi.mock('../stores/credentialStore', () => ({ useCredentialStore: () => M.credStoreMock }))
vi.mock('../stores/quickCommandStore', () => ({ useQuickCommandStore: () => M.quickCommandStoreMock }))
vi.mock('../stores/skillStore', () => ({ useSkillStore: () => M.skillStoreMock }))
vi.mock('../stores/commandStore', () => ({ useCommandStore: () => M.commandStoreMock }))
vi.mock('../stores/sessionStore', () => ({ disposeSessionStore: vi.fn() }))

import { useAppLifecycle } from './useAppLifecycle'

beforeEach(() => {
  vi.clearAllMocks()
  M.tabStoreMock.tabs = []
  M.tabStoreMock.activeTab = null
  M.isMobileMock.mockReturnValue(false)
  M.getPlatformMock.mockResolvedValue('linux')
  M.localStateStoreMock.state.sidebarVisible = false
  M.aiStoreMock.visible = false
})

function makeDeps() {
  return {
    sidebarVisible: ref(false),
    mobileKeyBar: { init: vi.fn(), dispose: vi.fn(), isMobile: false },
    contextMenu: { init: vi.fn(), dispose: vi.fn() },
    mcpApproval: { init: vi.fn(), dispose: vi.fn() },
    keybindings: {
      isMac: ref(false),
      onWheel: vi.fn(),
      onPlatformSystemShortcut: vi.fn(),
      applyKeybindings: vi.fn(),
      installGlobalListener: vi.fn(),
      uninstallGlobalListener: vi.fn(),
    },
    rdpEmbedding: { setup: vi.fn(), teardown: vi.fn() },
    connectionManager: {
      maybeRestoreLastTabs: vi.fn(async () => {}),
      installTabSnapshotSaver: vi.fn(),
      onConnect: vi.fn(async () => {}),
      connectTerminalSession: vi.fn(async () => ({ status: 'ok' })),
      openConnectionAtIndex: vi.fn(async () => {}),
      openFileBrowser: vi.fn(),
      openMonitorPanel: vi.fn(),
      onPanelReconnectEvent: vi.fn(),
    },
    dialogs: { openSettings: vi.fn(), openNetscan: vi.fn() },
    checkCredentials: vi.fn(async () => {}),
    loadBackgroundImage: vi.fn(async () => {}),
  }
}

describe('useAppLifecycle — init', () => {
  it('loads stores and initializes state', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(M.connectionStoreMock.load).toHaveBeenCalled()
    expect(M.aiStoreMock.init).toHaveBeenCalled()
    expect(M.updateCheckMock.initAutoCheck).toHaveBeenCalled()
    expect(M.localStateStoreMock.init).toHaveBeenCalled()
    expect(deps.loadBackgroundImage).toHaveBeenCalled()
  })

  it('creates a start tab when no tabs are open', async () => {
    M.tabStoreMock.tabs = []
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(M.tabStoreMock.createStartTab).toHaveBeenCalled()
  })

  it('does not create a start tab when tabs already exist', async () => {
    M.tabStoreMock.tabs = [{ id: 't1' }]
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(M.tabStoreMock.createStartTab).not.toHaveBeenCalled()
  })

  it('sets sidebarVisible from localState on desktop', async () => {
    M.isMobileMock.mockReturnValue(false)
    M.localStateStoreMock.state.sidebarVisible = true
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(deps.sidebarVisible.value).toBe(true)
  })

  it('forces sidebarVisible false on mobile', async () => {
    M.isMobileMock.mockReturnValue(true)
    M.localStateStoreMock.state.sidebarVisible = true
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(deps.sidebarVisible.value).toBe(false)
  })

  it('initializes mobile keybar, context menu, and mcp approval', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(deps.mobileKeyBar.init).toHaveBeenCalled()
    expect(deps.contextMenu.init).toHaveBeenCalled()
    expect(deps.mcpApproval.init).toHaveBeenCalled()
  })

  it('detects platform and sets isMac for darwin', async () => {
    M.getPlatformMock.mockResolvedValue('darwin')
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(deps.keybindings.isMac.value).toBe(true)
    expect(document.documentElement.dataset.platform).toBe('darwin')
  })

  it('sets isMac false when GetPlatform fails', async () => {
    M.getPlatformMock.mockRejectedValue(new Error('fail'))
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(deps.keybindings.isMac.value).toBe(false)
  })

  it('applies keybindings and installs global listener', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(deps.keybindings.applyKeybindings).toHaveBeenCalled()
    expect(deps.keybindings.installGlobalListener).toHaveBeenCalled()
  })

  it('sets up RDP embedding', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(deps.rdpEmbedding.setup).toHaveBeenCalled()
  })

  it('registers Wails tray and terminal:cwd events', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(M.eventsOnMock).toHaveBeenCalledWith('app:open-settings', expect.any(Function))
    expect(M.eventsOnMock).toHaveBeenCalledWith('app:open-about', expect.any(Function))
    expect(M.eventsOnMock).toHaveBeenCalledWith('app:open-netscan', expect.any(Function))
    expect(M.eventsOnMock).toHaveBeenCalledWith('terminal:cwd', expect.any(Function))
  })

  it('registers panel:reconnect window event', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(addSpy).toHaveBeenCalledWith('panel:reconnect', deps.connectionManager.onPanelReconnectEvent)
    addSpy.mockRestore()
  })

  it('calls checkCredentials at the end of init', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    expect(deps.checkCredentials).toHaveBeenCalled()
  })

  it('tray open-settings event calls dialogs.openSettings', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    // Find the callback registered for app:open-settings
    const calls = M.eventsOnMock.mock.calls as any[]
    const settingsCb = calls.find((c: any[]) => c[0] === 'app:open-settings')?.[1] as Function
    settingsCb()
    expect(deps.dialogs.openSettings).toHaveBeenCalledWith()
  })

  it('tray open-about event calls dialogs.openSettings with "about"', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    const calls = M.eventsOnMock.mock.calls as any[]
    const aboutCb = calls.find((c: any[]) => c[0] === 'app:open-about')?.[1] as Function
    aboutCb()
    expect(deps.dialogs.openSettings).toHaveBeenCalledWith('about')
  })

  it('terminal:cwd event records the cwd in companionStore', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    const calls = M.eventsOnMock.mock.calls as any[]
    const cwdCb = calls.find((c: any[]) => c[0] === 'terminal:cwd')?.[1] as Function
    cwdCb({ data: { sessionId: 's1', cwd: '/home' } })
    expect(M.companionStoreMock.recordSessionCwd).toHaveBeenCalledWith('s1', '/home')
  })
})

describe('useAppLifecycle — dispose', () => {
  it('cleans up keybindings, focus restore, and update check', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    lc.dispose()
    expect(deps.keybindings.uninstallGlobalListener).toHaveBeenCalled()
    expect(M.updateCheckMock.dispose).toHaveBeenCalled()
  })

  it('disposes mobile keybar, context menu, and mcp approval', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    lc.dispose()
    expect(deps.mobileKeyBar.dispose).toHaveBeenCalled()
    expect(deps.contextMenu.dispose).toHaveBeenCalled()
    expect(deps.mcpApproval.dispose).toHaveBeenCalled()
  })

  it('tears down RDP embedding', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    lc.dispose()
    expect(deps.rdpEmbedding.teardown).toHaveBeenCalled()
  })

  it('removes panel:reconnect window event', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    lc.dispose()
    expect(removeSpy).toHaveBeenCalledWith('panel:reconnect', deps.connectionManager.onPanelReconnectEvent)
    removeSpy.mockRestore()
  })

  it('disposes stores', async () => {
    const deps = makeDeps()
    const lc = useAppLifecycle(deps)
    await lc.init()
    lc.dispose()
    expect(M.settingsStoreMock.dispose).toHaveBeenCalled()
    expect(M.connectionStoreMock.dispose).toHaveBeenCalled()
    expect(M.syncStoreMock.dispose).toHaveBeenCalled()
    expect(M.tunnelStoreMock.dispose).toHaveBeenCalled()
    expect(M.credStoreMock.dispose).toHaveBeenCalled()
  })
})