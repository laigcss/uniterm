// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  eventsOnMock, resolveMcpApprovalMock, closeSessionMock, sessionStartMock,
  waitForTerminalSizeMock, tabStoreMock, panelStoreMock, sessionStoreMock, callbacks,
} = vi.hoisted(() => ({
  eventsOnMock: vi.fn(),
  resolveMcpApprovalMock: vi.fn(),
  closeSessionMock: vi.fn(),
  sessionStartMock: vi.fn(),
  waitForTerminalSizeMock: vi.fn(),
  tabStoreMock: {
    activeTab: null as any,
    replaceStartTab: vi.fn(() => ({ id: 'tab-1' })),
    createTerminalTab: vi.fn(() => ({ id: 'tab-1' })),
  },
  panelStoreMock: {
    createPanel: vi.fn(() => ({ id: 'panel-1' })),
    updateTitle: vi.fn(),
    bindSession: vi.fn(),
    movePanelToTab: vi.fn(),
  },
  sessionStoreMock: {
    initSession: vi.fn(),
    updateStatus: vi.fn(),
  },
  callbacks: {} as Record<string, Function>,
}))

vi.mock('@wailsio/runtime', () => ({
  Events: { On: eventsOnMock },
}))
vi.mock('../../bindings/github.com/ys-ll/uniterm/app', () => ({
  ResolveMCPApproval: resolveMcpApprovalMock,
  CloseSession: closeSessionMock,
  SessionStart: sessionStartMock,
}))
vi.mock('../services/terminalManager', () => ({
  waitForTerminalSize: waitForTerminalSizeMock,
}))
vi.mock('../stores/tabStore', () => ({ useTabStore: () => tabStoreMock }))
vi.mock('../stores/panelStore', () => ({ usePanelStore: () => panelStoreMock }))
vi.mock('../stores/sessionStore', () => ({ useSessionStore: () => sessionStoreMock }))

import { useMcpApproval } from './useMcpApproval'

beforeEach(() => {
  vi.clearAllMocks()
  callbacks['mcp:approval-request'] = null as any
  callbacks['mcp:session-created'] = null as any
  eventsOnMock.mockImplementation((evt: string, cb: Function) => {
    callbacks[evt] = cb
    return () => {}
  })
  resolveMcpApprovalMock.mockResolvedValue(undefined)
  closeSessionMock.mockResolvedValue(undefined)
  sessionStartMock.mockResolvedValue(undefined)
  waitForTerminalSizeMock.mockResolvedValue({ cols: 80, rows: 24 })
  tabStoreMock.activeTab = null
})

describe('useMcpApproval — onMcpApprovalResolve', () => {
  it('hides the dialog and resolves the approval when a request is pending', async () => {
    const mcp = useMcpApproval()
    mcp.mcpApprovalRequest.value = { id: 'req-1' } as any
    mcp.mcpApprovalVisible.value = true

    await mcp.onMcpApprovalResolve(true, 'approved')

    expect(mcp.mcpApprovalVisible.value).toBe(false)
    expect(mcp.mcpApprovalRequest.value).toBeNull()
    expect(resolveMcpApprovalMock).toHaveBeenCalledWith('req-1', true, 'approved')
  })

  it('passes false and reason when rejected', async () => {
    const mcp = useMcpApproval()
    mcp.mcpApprovalRequest.value = { id: 'req-2' } as any

    await mcp.onMcpApprovalResolve(false, 'user declined')

    expect(resolveMcpApprovalMock).toHaveBeenCalledWith('req-2', false, 'user declined')
  })

  it('does not call ResolveMCPApproval when no request is pending', async () => {
    const mcp = useMcpApproval()
    mcp.mcpApprovalRequest.value = null

    await mcp.onMcpApprovalResolve(true, '')

    expect(resolveMcpApprovalMock).not.toHaveBeenCalled()
    expect(mcp.mcpApprovalVisible.value).toBe(false)
  })

  it('swallows ResolveMCPApproval errors', async () => {
    resolveMcpApprovalMock.mockRejectedValue(new Error('backend down'))
    const mcp = useMcpApproval()
    mcp.mcpApprovalRequest.value = { id: 'req-3' } as any

    // onMcpApprovalResolve is sync; ResolveMCPApproval errors are swallowed via .catch()
    mcp.onMcpApprovalResolve(true, '')
    expect(mcp.mcpApprovalVisible.value).toBe(false)
    expect(mcp.mcpApprovalRequest.value).toBeNull()
  })
})

describe('useMcpApproval — init', () => {
  it('registers mcp:approval-request and mcp:session-created event handlers', () => {
    const mcp = useMcpApproval()
    mcp.init()
    expect(eventsOnMock).toHaveBeenCalledWith('mcp:approval-request', expect.any(Function))
    expect(eventsOnMock).toHaveBeenCalledWith('mcp:session-created', expect.any(Function))
  })

  it('approval-request handler shows the dialog with the request data', () => {
    const mcp = useMcpApproval()
    mcp.init()
    const req = { id: 'req-1', tool: 'shell' }
    callbacks['mcp:approval-request']({ data: req })
    expect(mcp.mcpApprovalVisible.value).toBe(true)
    expect(mcp.mcpApprovalRequest.value).toEqual(req)
  })
})

describe('useMcpApproval — dispose', () => {
  it('calls both unsubscribe functions', () => {
    const unsub1 = vi.fn()
    const unsub2 = vi.fn()
    let call = 0
    eventsOnMock.mockImplementation(() => {
      call++
      return call === 1 ? unsub1 : unsub2
    })
    const mcp = useMcpApproval()
    mcp.init()
    mcp.dispose()
    expect(unsub1).toHaveBeenCalled()
    expect(unsub2).toHaveBeenCalled()
  })

  it('does not throw when dispose is called without init', () => {
    const mcp = useMcpApproval()
    expect(() => mcp.dispose()).not.toThrow()
  })
})

describe('useMcpApproval — onMcpSessionCreated', () => {
  function makeConfig() {
    return { id: 'c1', type: 'ssh', host: 'h', port: 22, user: 'u', authType: 'password' } as any
  }

  it('creates panel, binds session, and starts the terminal for non-tcp types', async () => {
    const mcp = useMcpApproval()
    mcp.init()
    const cfg = makeConfig()
    cfg.initialCols = 0
    cfg.initialRows = 0

    await callbacks['mcp:session-created']({
      data: { sessionId: 'sess-1', type: 'ssh', name: 'my-ssh', config: cfg },
    })

    expect(panelStoreMock.createPanel).toHaveBeenCalledWith(cfg, 'ssh')
    expect(panelStoreMock.updateTitle).toHaveBeenCalledWith('panel-1', 'my-ssh')
    expect(panelStoreMock.bindSession).toHaveBeenCalledWith('panel-1', 'sess-1')
    expect(sessionStoreMock.initSession).toHaveBeenCalledWith('sess-1')
    expect(sessionStoreMock.updateStatus).toHaveBeenCalledWith('sess-1', 'connecting')
    expect(waitForTerminalSizeMock).toHaveBeenCalledWith('sess-1')
    expect(cfg.initialCols).toBe(80)
    expect(cfg.initialRows).toBe(24)
    expect(sessionStartMock).toHaveBeenCalledWith('sess-1', cfg)
  })

  it('returns early for tcp type without calling SessionStart', async () => {
    const mcp = useMcpApproval()
    mcp.init()
    const cfg = makeConfig()

    await callbacks['mcp:session-created']({
      data: { sessionId: 'sess-tcp', type: 'tcp', host: '1.2.3.4', config: cfg },
    })

    expect(panelStoreMock.createPanel).toHaveBeenCalledWith(cfg, 'tcp')
    expect(sessionStartMock).not.toHaveBeenCalled()
    expect(waitForTerminalSizeMock).not.toHaveBeenCalled()
  })

  it('uses host as title when name is not provided', async () => {
    const mcp = useMcpApproval()
    mcp.init()
    const cfg = makeConfig()

    await callbacks['mcp:session-created']({
      data: { sessionId: 'sess-1', type: 'ssh', host: 'my-host', config: cfg },
    })

    expect(panelStoreMock.updateTitle).toHaveBeenCalledWith('panel-1', 'my-host')
  })

  it('uses type as title when neither name nor host is provided', async () => {
    const mcp = useMcpApproval()
    mcp.init()
    const cfg = makeConfig()

    await callbacks['mcp:session-created']({
      data: { sessionId: 'sess-1', type: 'ssh', config: cfg },
    })

    expect(panelStoreMock.updateTitle).toHaveBeenCalledWith('panel-1', 'ssh')
  })

  it('replaces the start tab when active tab is a start tab', async () => {
    const mcp = useMcpApproval()
    mcp.init()
    tabStoreMock.activeTab = { id: 'start-tab', type: 'start' }
    const cfg = makeConfig()

    await callbacks['mcp:session-created']({
      data: { sessionId: 'sess-1', type: 'ssh', name: 't', config: cfg },
    })

    expect(tabStoreMock.replaceStartTab).toHaveBeenCalledWith('start-tab', 't', 'panel-1')
    expect(tabStoreMock.createTerminalTab).not.toHaveBeenCalled()
  })

  it('creates a new terminal tab when active tab is not a start tab', async () => {
    const mcp = useMcpApproval()
    mcp.init()
    tabStoreMock.activeTab = { id: 'other', type: 'terminal' }
    const cfg = makeConfig()

    await callbacks['mcp:session-created']({
      data: { sessionId: 'sess-1', type: 'ssh', name: 't', config: cfg },
    })

    expect(tabStoreMock.createTerminalTab).toHaveBeenCalledWith('t', 'panel-1')
    expect(tabStoreMock.replaceStartTab).not.toHaveBeenCalled()
  })

  it('closes the session on SessionStart failure', async () => {
    sessionStartMock.mockRejectedValue(new Error('start failed'))
    const mcp = useMcpApproval()
    mcp.init()
    const cfg = makeConfig()

    callbacks['mcp:session-created']({
      data: { sessionId: 'sess-1', type: 'ssh', name: 't', config: cfg },
    })

    // onMcpSessionCreated is fire-and-forget (void); wait for the async chain
    await vi.waitFor(() => expect(closeSessionMock).toHaveBeenCalledWith('sess-1'))
  })
})