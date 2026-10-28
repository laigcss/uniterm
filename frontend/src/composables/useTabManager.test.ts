// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('element-plus', () => ({
  ElMessageBox: { confirm: vi.fn() },
  ElCheckbox: { name: 'ElCheckbox' },
}))
vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: { value: 'en' } }),
}))

const {
  closeSessionMock, unregisterTransferRouteMock,
  tabStoreMock, panelStoreMock, sessionStoreMock, settingsStoreMock,
  containerStoreMock, companionStoreMock, connectionStoreMock,
} = vi.hoisted(() => ({
  closeSessionMock: vi.fn(),
  unregisterTransferRouteMock: vi.fn(),
  tabStoreMock: {
    tabs: [] as any[],
    activeTab: null as any,
    closeTab: vi.fn((): any => []),
    createStartTab: vi.fn(),
    createTerminalTab: vi.fn(() => ({ id: 'new2' })),
    replaceStartTab: vi.fn(() => ({ id: 'tab-r' })),
    moveTab: vi.fn(),
  },
  panelStoreMock: {
    getPanel: vi.fn((_id?: any): any => null),
    removePanel: vi.fn(),
    removeTransferTasks: vi.fn(),
    disconnectVNCCache: vi.fn(),
    removeVNCCache: vi.fn(),
    disconnectSPICECache: vi.fn(),
    removeSPICECache: vi.fn(),
  },
  sessionStoreMock: { getStatus: vi.fn(() => 'disconnected') },
  settingsStoreMock: {
    settings: { newTabAction: 'start', closeTabPrompt: true, defaultLocalShell: '' },
    availableShells: [] as string[],
    save: vi.fn(),
  },
  containerStoreMock: { close: vi.fn() },
  companionStoreMock: { disposeForPanels: vi.fn(async () => {}) },
  connectionStoreMock: { connections: [] as any[] },
}))

vi.mock('../../bindings/github.com/ys-ll/uniterm/app', () => ({ CloseSession: closeSessionMock }))
vi.mock('../services/transferTaskCenter', () => ({ unregisterTransferRoute: unregisterTransferRouteMock }))
vi.mock('../stores/tabStore', () => ({ useTabStore: () => tabStoreMock }))
vi.mock('../stores/panelStore', () => ({ usePanelStore: () => panelStoreMock }))
vi.mock('../stores/sessionStore', () => ({ useSessionStore: () => sessionStoreMock }))
vi.mock('../stores/settingsStore', () => ({ useSettingsStore: () => settingsStoreMock }))
vi.mock('../stores/containerStore', () => ({ useContainerStore: () => containerStoreMock }))
vi.mock('../stores/companionStore', () => ({ useCompanionStore: () => companionStoreMock }))
vi.mock('../stores/connectionStore', () => ({ useConnectionStore: () => connectionStoreMock }))

import { ElMessageBox } from 'element-plus'
import { useTabManager } from './useTabManager'

beforeEach(() => {
  vi.clearAllMocks()
  tabStoreMock.tabs = []
  tabStoreMock.activeTab = null
  panelStoreMock.getPanel.mockReturnValue(null)
  sessionStoreMock.getStatus.mockReturnValue('disconnected')
  settingsStoreMock.settings.newTabAction = 'start'
  settingsStoreMock.settings.closeTabPrompt = true
  settingsStoreMock.availableShells = []
  connectionStoreMock.connections = []
  closeSessionMock.mockResolvedValue(undefined)
  ;(ElMessageBox.confirm as any).mockResolvedValue(true)
})

function makeDeps() {
  return {
    rdpEmbedding: { RDPHideForOverlay: vi.fn(), RDPShowForOverlay: vi.fn() },
    createLocalTerminalWithShell: vi.fn(async () => {}),
  }
}

describe('useTabManager — createNewTab', () => {
  it('creates a start tab when newTabAction is not localTerminal', () => {
    settingsStoreMock.settings.newTabAction = 'start'
    const tm = useTabManager(makeDeps())
    tm.createNewTab()
    expect(tabStoreMock.createStartTab).toHaveBeenCalled()
  })

  it('creates a local terminal when newTabAction is localTerminal and shells available', () => {
    settingsStoreMock.settings.newTabAction = 'localTerminal'
    settingsStoreMock.availableShells = ['/bin/bash', '/bin/zsh']
    const deps = makeDeps()
    const tm = useTabManager(deps)
    tm.createNewTab()
    expect(deps.createLocalTerminalWithShell).toHaveBeenCalledWith('/bin/bash')
    expect(tabStoreMock.createStartTab).not.toHaveBeenCalled()
  })

  it('uses the preferred shell when it is in the available list', () => {
    settingsStoreMock.settings.newTabAction = 'localTerminal'
    settingsStoreMock.availableShells = ['/bin/bash', '/bin/zsh']
    settingsStoreMock.settings.defaultLocalShell = '/bin/zsh'
    const deps = makeDeps()
    const tm = useTabManager(deps)
    tm.createNewTab()
    expect(deps.createLocalTerminalWithShell).toHaveBeenCalledWith('/bin/zsh')
  })

  it('falls back to start tab when no shells are available', () => {
    settingsStoreMock.settings.newTabAction = 'localTerminal'
    settingsStoreMock.availableShells = []
    const tm = useTabManager(makeDeps())
    tm.createNewTab()
    expect(tabStoreMock.createStartTab).toHaveBeenCalled()
  })
})

describe('useTabManager — closeTab', () => {
  it('does nothing when the tab is locked', async () => {
    tabStoreMock.tabs = [{ id: 't1', locked: true }]
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1')
    expect(tabStoreMock.closeTab).not.toHaveBeenCalled()
  })

  it('closes a start tab directly', async () => {
    tabStoreMock.tabs = [{ id: 't1', type: 'start' }]
    tabStoreMock.closeTab.mockReturnValue([])
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1')
    expect(tabStoreMock.closeTab).toHaveBeenCalledWith('t1')
  })

  it('closes a terminal tab and its session', async () => {
    const tab = { id: 't1', type: 'terminal', panelId: 'p1' }
    tabStoreMock.tabs = [tab]
    panelStoreMock.getPanel.mockReturnValue({ sessionId: 'sess-1' })
    tabStoreMock.closeTab.mockReturnValue(['p1'])
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1', { skipConfirm: true })
    expect(closeSessionMock).toHaveBeenCalledWith('sess-1')
    expect(tabStoreMock.closeTab).toHaveBeenCalledWith('t1')
  })

  it('closes an rdp tab session', async () => {
    const tab = { id: 't1', type: 'rdp', panelId: 'p1' }
    tabStoreMock.tabs = [tab]
    panelStoreMock.getPanel.mockReturnValue({ sessionId: 'sess-rdp' })
    tabStoreMock.closeTab.mockReturnValue(['p1'])
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1', { skipConfirm: true })
    expect(closeSessionMock).toHaveBeenCalledWith('sess-rdp')
  })

  it('closes a vnc tab and cleans up vnc cache', async () => {
    const tab = { id: 't1', type: 'vnc', panelId: 'p1' }
    tabStoreMock.tabs = [tab]
    panelStoreMock.getPanel.mockReturnValue({ sessionId: 'sess-vnc' })
    tabStoreMock.closeTab.mockReturnValue(['p1'])
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1', { skipConfirm: true })
    expect(closeSessionMock).toHaveBeenCalledWith('sess-vnc')
    expect(panelStoreMock.disconnectVNCCache).toHaveBeenCalledWith('p1')
    expect(panelStoreMock.removeVNCCache).toHaveBeenCalledWith('p1')
  })

  it('closes a container tab via containerStore', async () => {
    const tab = { id: 't1', type: 'container', panelId: 'p1' }
    tabStoreMock.tabs = [tab]
    tabStoreMock.closeTab.mockReturnValue(['p1'])
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1', { skipConfirm: true })
    expect(containerStoreMock.close).toHaveBeenCalledWith('t1')
  })

  it('closes a workspace tab and all panel sessions', async () => {
    const tab = { id: 't1', type: 'workspace', panelIds: ['p1', 'p2'] }
    tabStoreMock.tabs = [tab]
    panelStoreMock.getPanel.mockImplementation((pid: any) =>
      pid === 'p1' ? { sessionId: 's1' } : pid === 'p2' ? { sessionId: 's2' } : null
    )
    tabStoreMock.closeTab.mockReturnValue(['p1', 'p2'])
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1', { skipConfirm: true })
    expect(closeSessionMock).toHaveBeenCalledWith('s1')
    expect(closeSessionMock).toHaveBeenCalledWith('s2')
  })

  it('shows confirm dialog when closing a connected terminal tab', async () => {
    const tab = { id: 't1', type: 'terminal', panelId: 'p1' }
    tabStoreMock.tabs = [tab]
    panelStoreMock.getPanel.mockReturnValue({ sessionId: 'sess-1' })
    sessionStoreMock.getStatus.mockReturnValue('connected')
    tabStoreMock.closeTab.mockReturnValue(['p1'])
    const deps = makeDeps()
    const tm = useTabManager(deps)
    await tm.closeTab('t1')
    expect(deps.rdpEmbedding.RDPHideForOverlay).toHaveBeenCalled()
    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(deps.rdpEmbedding.RDPShowForOverlay).toHaveBeenCalled()
  })

  it('aborts close when the confirm dialog is cancelled', async () => {
    const tab = { id: 't1', type: 'terminal', panelId: 'p1' }
    tabStoreMock.tabs = [tab]
    panelStoreMock.getPanel.mockReturnValue({ sessionId: 'sess-1' })
    sessionStoreMock.getStatus.mockReturnValue('connected')
    ;(ElMessageBox.confirm as any).mockRejectedValue('cancel')
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1')
    expect(tabStoreMock.closeTab).not.toHaveBeenCalled()
  })

  it('skips confirm dialog when closeTabPrompt is false', async () => {
    const tab = { id: 't1', type: 'terminal', panelId: 'p1' }
    tabStoreMock.tabs = [tab]
    panelStoreMock.getPanel.mockReturnValue({ sessionId: 'sess-1' })
    sessionStoreMock.getStatus.mockReturnValue('connected')
    settingsStoreMock.settings.closeTabPrompt = false
    tabStoreMock.closeTab.mockReturnValue(['p1'])
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1')
    expect(ElMessageBox.confirm).not.toHaveBeenCalled()
    expect(tabStoreMock.closeTab).toHaveBeenCalled()
  })

  it('disposes companion sidebars and transfer routes for closed panels', async () => {
    const tab = { id: 't1', type: 'terminal', panelId: 'p1' }
    tabStoreMock.tabs = [tab]
    panelStoreMock.getPanel.mockReturnValue({ sessionId: 'sess-1' })
    tabStoreMock.closeTab.mockReturnValue(['p1'])
    const tm = useTabManager(makeDeps())
    await tm.closeTab('t1', { skipConfirm: true })
    expect(companionStoreMock.disposeForPanels).toHaveBeenCalledWith(['p1'])
    expect(unregisterTransferRouteMock).toHaveBeenCalledWith('sess-1')
    expect(panelStoreMock.removeTransferTasks).toHaveBeenCalledWith('p1')
    expect(panelStoreMock.removePanel).toHaveBeenCalledWith('p1')
  })
})

describe('useTabManager — closeTabBatch', () => {
  it('does nothing for an empty list', async () => {
    const tm = useTabManager(makeDeps())
    await tm.closeTabBatch([])
    expect(tabStoreMock.closeTab).not.toHaveBeenCalled()
  })

  it('closes all non-locked tabs', async () => {
    tabStoreMock.tabs = [
      { id: 't1', type: 'terminal', panelId: 'p1' },
      { id: 't2', type: 'terminal', panelId: 'p2', locked: true },
    ]
    panelStoreMock.getPanel.mockReturnValue(null)
    tabStoreMock.closeTab.mockReturnValue(['p1'])
    const tm = useTabManager(makeDeps())
    await tm.closeTabBatch(['t1', 't2'])
    expect(tabStoreMock.closeTab).toHaveBeenCalledTimes(1)
    expect(tabStoreMock.closeTab).toHaveBeenCalledWith('t1')
  })

  it('shows a single confirm dialog when multiple connected tabs are closed', async () => {
    tabStoreMock.tabs = [
      { id: 't1', type: 'terminal', panelId: 'p1' },
      { id: 't2', type: 'terminal', panelId: 'p2' },
    ]
    panelStoreMock.getPanel.mockImplementation((pid: any) => ({ sessionId: `sess-${pid}` }))
    sessionStoreMock.getStatus.mockReturnValue('connected')
    tabStoreMock.closeTab.mockReturnValue([])
    const tm = useTabManager(makeDeps())
    await tm.closeTabBatch(['t1', 't2'])
    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
  })

  it('aborts when the batch confirm dialog is cancelled', async () => {
    tabStoreMock.tabs = [
      { id: 't1', type: 'terminal', panelId: 'p1' },
    ]
    panelStoreMock.getPanel.mockReturnValue({ sessionId: 's1' })
    sessionStoreMock.getStatus.mockReturnValue('connected')
    ;(ElMessageBox.confirm as any).mockRejectedValue('cancel')
    const tm = useTabManager(makeDeps())
    await tm.closeTabBatch(['t1'])
    expect(tabStoreMock.closeTab).not.toHaveBeenCalled()
  })
})

describe('useTabManager — onTabDragStart', () => {
  it('is a no-op function', () => {
    const tm = useTabManager(makeDeps())
    expect(() => tm.onTabDragStart({} as DragEvent, 't1')).not.toThrow()
  })
})

describe('useTabManager — getPanelConfig', () => {
  it('returns null when panelId is undefined', () => {
    const tm = useTabManager(makeDeps())
    expect(tm.getPanelConfig(undefined)).toBeNull()
  })

  it('returns the panel config', () => {
    panelStoreMock.getPanel.mockReturnValue({ config: { id: 'c1', host: 'h' } })
    const tm = useTabManager(makeDeps())
    expect(tm.getPanelConfig('p1')).toEqual({ id: 'c1', host: 'h' })
  })

  it('returns null when the panel has no config', () => {
    panelStoreMock.getPanel.mockReturnValue({})
    const tm = useTabManager(makeDeps())
    expect(tm.getPanelConfig('p1')).toBeNull()
  })
})

describe('useTabManager — getPanelSessionId', () => {
  it('returns null when panelId is undefined', () => {
    const tm = useTabManager(makeDeps())
    expect(tm.getPanelSessionId(undefined)).toBeNull()
  })

  it('returns the session id', () => {
    panelStoreMock.getPanel.mockReturnValue({ sessionId: 'sess-1' })
    const tm = useTabManager(makeDeps())
    expect(tm.getPanelSessionId('p1')).toBe('sess-1')
  })

  it('returns null when the panel has no session', () => {
    panelStoreMock.getPanel.mockReturnValue({})
    const tm = useTabManager(makeDeps())
    expect(tm.getPanelSessionId('p1')).toBeNull()
  })
})

describe('useTabManager — k8sConnectionForTab', () => {
  it('returns the matching connection from the connection store', () => {
    const conn = { id: 'k8s-1', name: 'my-cluster', typeA: 'k8s' }
    connectionStoreMock.connections = [conn]
    const tm = useTabManager(makeDeps())
    const result = tm.k8sConnectionForTab({ connectionId: 'k8s-1', name: 'x' })
    expect(result).toBe(conn)
  })

  it('creates a default k8s connection when no match is found', () => {
    connectionStoreMock.connections = []
    const tm = useTabManager(makeDeps())
    const result = tm.k8sConnectionForTab({ connectionId: 'missing', name: 'cluster-x' }) as any
    expect(result.id).toBe('missing')
    expect(result.name).toBe('cluster-x')
    expect(result.type).toBe('k8s')
    expect(result.host).toBe('')
    expect(result.port).toBe(0)
    expect(result.authType).toBe('password')
  })
})