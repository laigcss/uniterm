// F1 interactionMode 判定测试：
//   - chat 模式：禁执行类工具（EXECUTION_TOOLS），仅允许查看/问答
//   - readonly 模式：仅读类（WRITE_TOOLS/DANGEROUS_TOOLS 拒绝，execute_command 按 localRisk 判定）
//   - agent 模式：全部放行，走 risk + 确认逻辑
//
// 分三层：
//   1) 工具分类集合正确性（纯常量，无 store 依赖）
//   2) assessLocalRisk 与 readonly 模式的交互（readonly 对 execute_command 的命令级判定）
//   3) runAgent 端到端：不同 interactionMode 下工具被拒绝/放行的实际行为

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---- hoisted mock 变量（vi.hoisted 保证 factory 中可引用） ----
const {
  mockChat,
  mockAddMessage,
  mockSetPendingCommand,
  interactionModeRef,
  modeRef,
  stopRequestedRef,
} = vi.hoisted(() => ({
  // chat mock：由每个 test 用 setupChat(toolUse) 配置
  mockChat: vi.fn(),
  // 捕获 addMessage 调用，用于断言拒绝/放行
  mockAddMessage: vi.fn(),
  // 捕获 setPendingCommand 调用，用于断言 agent 模式进入确认流程
  mockSetPendingCommand: vi.fn(),
  // 可变 interactionMode，每个 test 通过 setInteractionMode 设置
  interactionModeRef: { value: 'agent' as 'chat' | 'readonly' | 'agent' },
  // 可变 ExecutionMode（confirm_all/confirm_write/confirm_dangerous/bypass）
  modeRef: { value: 'confirm_all' as 'confirm_all' | 'confirm_write' | 'confirm_dangerous' | 'bypass' },
  // stopRequested 标志
  stopRequestedRef: { value: false },
}))

// ---- mock 外部依赖 ----
vi.mock('@wailsio/runtime', () => ({
  Events: { On: vi.fn(() => () => {}), Off: vi.fn() },
}))

vi.mock('../../bindings/github.com/laigcss/ai-ops-terminal/app', () => ({
  ChatCompletion: vi.fn(),
  GetSkillFile: vi.fn(),
  ListSkillFiles: vi.fn(),
  SessionWrite: vi.fn(),
}))

vi.mock('./terminalManager', () => ({
  getManagedTerminal: vi.fn(),
}))

// mock chat：由 setupChat 配置具体行为
vi.mock('./llm', () => ({
  chat: mockChat,
  ChatCancelledError: class ChatCancelledError extends Error {
    constructor() { super('cancelled'); this.name = 'ChatCancelledError' }
  },
  ChatTimeoutError: class ChatTimeoutError extends Error {
    constructor() { super('timeout'); this.name = 'ChatTimeoutError' }
  },
}))

// mock terminalAgent（agent.ts approveTool 直接用，tools/executeCommand 也用）
vi.mock('./terminalAgent', () => ({
  executeCommand: vi.fn().mockResolvedValue({ output: 'ok', exitCode: 0 }),
  startCommand: vi.fn().mockResolvedValue({ output: 'started' }),
  captureTerminal: vi.fn().mockReturnValue({ output: 'screen' }),
  collectOutput: vi.fn().mockReturnValue({ output: 'collected' }),
  sendTerminalKey: vi.fn().mockResolvedValue(undefined),
  truncateOutput: vi.fn((s: string) => s),
}))

// ---- mock stores ----
// 关键：pinia setup store 中 ref 会被自动解包，store.interactionMode 直接
// 是字符串值（不是 { value: 'chat' }）。用 getter 让 mock 动态返回 ref 的
// 当前值，这样测试中修改 interactionModeRef.value 后所有 useAIStore() 调用
// 都能看到新值。
function makeMockAIStore() {
  const store: Record<string, any> = {
    visible: false,
    messages: [] as any[],
    config: {},
    isRunning: false,
    status: 'thinking',
    sessions: [],
    currentSessionId: 'test-session',
    pendingCommand: null,
    pendingQuestion: null,
    lastPanelContext: null,
    queuedMessages: [] as any[],
    initialized: true,
    lastDebugInfo: null,
    systemPrompt: 'You are a helpful assistant.',
    conversation: [] as any[],
    // 方法
    addMessage: mockAddMessage.mockImplementation((msg: any) => {
      const r = { ...msg }
      return r
    }),
    addSkillCard: vi.fn(),
    addCommandCard: vi.fn(),
    clearMessages: vi.fn(),
    setInteractionMode: vi.fn((m: string) => { interactionModeRef.value = m as any }),
    saveConfig: vi.fn(),
    initConfig: vi.fn(),
    setConfig: vi.fn(),
    stop: vi.fn(),
    resetStop: vi.fn(),
    createSession: vi.fn(),
    switchSession: vi.fn(),
    deleteSession: vi.fn(),
    deleteMessage: vi.fn(),
    truncateFrom: vi.fn(),
    exportSessionMarkdown: vi.fn(),
    renameSession: vi.fn(),
    setDebugInfo: vi.fn(),
    clearDebugInfo: vi.fn(),
    setPendingCommand: mockSetPendingCommand,
    clearPendingCommand: vi.fn(),
    setPendingQuestion: vi.fn(),
    clearPendingQuestion: vi.fn(),
    init: vi.fn(),
    setLastPanelContext: vi.fn(),
    enqueueMessage: vi.fn(),
    removeQueuedMessage: vi.fn(),
    clearQueue: vi.fn(),
    doSave: vi.fn(),
    toggle: vi.fn(),
  }
  // 用 getter 动态返回 ref 值（pinia ref 自动解包语义）
  Object.defineProperty(store, 'interactionMode', {
    get: () => interactionModeRef.value,
    enumerable: true,
  })
  Object.defineProperty(store, 'mode', {
    get: () => modeRef.value,
    enumerable: true,
  })
  Object.defineProperty(store, 'stopRequested', {
    get: () => stopRequestedRef.value,
    enumerable: true,
  })
  return store
}

vi.mock('../stores/aiStore', () => ({
  useAIStore: vi.fn(() => makeMockAIStore()),
}))

vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    settings: {
      ai: {
        maxTurns: 5,
        localRiskGuardEnabled: true,
      },
    },
    activeModel: { apiKey: 'test', baseURL: 'http://test' },
  })),
}))

const mockPanel = {
  id: 'panel-1',
  sessionId: 'session-1',
  title: 'Test Panel',
  type: 'terminal',
  config: { shellPath: '/bin/bash' },
}

vi.mock('../stores/tabStore', () => ({
  useTabStore: vi.fn(() => ({
    getAILockedPanel: vi.fn().mockReturnValue(null),
    getAILockedPanels: vi.fn().mockReturnValue([]),
    activeTab: { type: 'terminal', panelId: 'panel-1' },
  })),
}))

vi.mock('../stores/panelStore', () => ({
  usePanelStore: vi.fn(() => ({
    getPanel: vi.fn().mockReturnValue(mockPanel),
  })),
}))

vi.mock('../stores/sessionStore', () => ({
  useSessionStore: vi.fn(() => ({
    getRemoteOS: vi.fn().mockReturnValue(undefined),
  })),
}))

vi.mock('../stores/skillStore', () => ({
  useSkillStore: vi.fn(() => ({
    enabledSkills: [],
  })),
}))

vi.mock('./mcp/registry', () => ({
  hasMCPTools: vi.fn().mockReturnValue(false),
  getMCPToolSchemas: vi.fn().mockReturnValue([]),
  isMCPTool: vi.fn().mockReturnValue(false),
}))

// ---- 导入被测模块（在所有 mock 之后） ----
import {
  EXECUTION_TOOLS,
  WRITE_TOOLS,
  DANGEROUS_TOOLS,
  READ_ONLY_TOOLS,
} from './tools'
import { assessLocalRisk } from './localRisk'
import { runAgent } from './agent'

// ============================================================================
// 第 1 层：工具分类集合正确性
//    rejectToolByInteractionMode 依赖这些集合做判定，集合内容必须与
//    tools/index.ts 中的定义一致，否则模式过滤会误拒/误放行。
// ============================================================================

describe('工具分类集合 (F1 interactionMode 依赖)', () => {
  describe('EXECUTION_TOOLS (chat 模式禁用)', () => {
    it('包含所有执行类工具', () => {
      expect(EXECUTION_TOOLS.has('execute_command')).toBe(true)
      expect(EXECUTION_TOOLS.has('start_command')).toBe(true)
      expect(EXECUTION_TOOLS.has('send_terminal_key')).toBe(true)
      expect(EXECUTION_TOOLS.has('interrupt_command')).toBe(true)
      expect(EXECUTION_TOOLS.has('save_skill')).toBe(true)
      expect(EXECUTION_TOOLS.has('use_skill')).toBe(true)
    })

    it('不包含纯查看类工具', () => {
      expect(EXECUTION_TOOLS.has('capture_terminal')).toBe(false)
      expect(EXECUTION_TOOLS.has('collect_output')).toBe(false)
      expect(EXECUTION_TOOLS.has('read_skill_file')).toBe(false)
      expect(EXECUTION_TOOLS.has('ask_user')).toBe(false)
    })
  })

  describe('WRITE_TOOLS (readonly 模式禁用)', () => {
    it('包含 save_skill', () => {
      expect(WRITE_TOOLS.has('save_skill')).toBe(true)
    })

    it('不包含读类和执行类工具', () => {
      expect(WRITE_TOOLS.has('execute_command')).toBe(false)
      expect(WRITE_TOOLS.has('capture_terminal')).toBe(false)
      expect(WRITE_TOOLS.has('collect_output')).toBe(false)
    })
  })

  describe('DANGEROUS_TOOLS (readonly 模式禁用)', () => {
    it('包含高危执行类工具', () => {
      expect(DANGEROUS_TOOLS.has('start_command')).toBe(true)
      expect(DANGEROUS_TOOLS.has('send_terminal_key')).toBe(true)
      expect(DANGEROUS_TOOLS.has('interrupt_command')).toBe(true)
    })

    it('不包含 execute_command（按命令 localRisk 判定，不静态归类）', () => {
      expect(DANGEROUS_TOOLS.has('execute_command')).toBe(false)
    })
  })

  describe('READ_ONLY_TOOLS (任何模式都放行)', () => {
    it('包含纯查看类工具', () => {
      expect(READ_ONLY_TOOLS.has('capture_terminal')).toBe(true)
      expect(READ_ONLY_TOOLS.has('collect_output')).toBe(true)
      expect(READ_ONLY_TOOLS.has('read_skill_file')).toBe(true)
    })
  })

  it('ask_user 在所有分类集合外（safe 类，任何模式放行）', () => {
    expect(EXECUTION_TOOLS.has('ask_user')).toBe(false)
    expect(WRITE_TOOLS.has('ask_user')).toBe(false)
    expect(DANGEROUS_TOOLS.has('ask_user')).toBe(false)
  })
})

// ============================================================================
// 第 2 层：assessLocalRisk 与 readonly 模式的交互
//    readonly 模式下 execute_command 按命令本身 localRisk 判定：
//      - 'read'     → 放行
//      - 'write'    → 拒绝
//      - 'dangerous'→ 拒绝
// ============================================================================

describe('assessLocalRisk 与 readonly 模式交互', () => {
  it('读类命令判定为 read → readonly 放行', () => {
    expect(assessLocalRisk('ls -la')).toBe('read')
    expect(assessLocalRisk('cat /etc/hosts')).toBe('read')
    expect(assessLocalRisk('grep pattern file')).toBe('read')
    expect(assessLocalRisk('ps aux')).toBe('read')
    expect(assessLocalRisk('df -h')).toBe('read')
    expect(assessLocalRisk('pwd')).toBe('read')
    expect(assessLocalRisk('whoami')).toBe('read')
    expect(assessLocalRisk('git status')).toBe('read')
    expect(assessLocalRisk('git log --oneline')).toBe('read')
  })

  it('写类命令判定为 write → readonly 拒绝', () => {
    expect(assessLocalRisk('mkdir newdir')).toBe('write')
    expect(assessLocalRisk('touch newfile')).toBe('write')
    expect(assessLocalRisk('mv a b')).toBe('write')
    expect(assessLocalRisk('echo hello > file.txt')).toBe('write')
    expect(assessLocalRisk('npm install')).toBe('write')
    expect(assessLocalRisk('pip install requests')).toBe('write')
  })

  it('危险命令判定为 dangerous → readonly 拒绝', () => {
    expect(assessLocalRisk('rm -rf /')).toBe('dangerous')
    expect(assessLocalRisk('mkfs.ext4 /dev/sda1')).toBe('dangerous')
    expect(assessLocalRisk('dd if=/dev/zero of=/dev/sda')).toBe('dangerous')
    expect(assessLocalRisk('shutdown -h now')).toBe('dangerous')
    expect(assessLocalRisk('chmod -R 777 /')).toBe('dangerous')
  })

  it('反绕过模式一律 dangerous → readonly 拒绝', () => {
    expect(assessLocalRisk('sh -c "rm -rf /"')).toBe('dangerous')
    expect(assessLocalRisk('eval "rm -rf /"')).toBe('dangerous')
    expect(assessLocalRisk('$(rm -rf /)')).toBe('dangerous')
    expect(assessLocalRisk('echo "cm0gLXJmIC8=" | base64 -d | sh')).toBe('dangerous')
  })

  it('空命令和非字符串判定为 read（安全默认）', () => {
    expect(assessLocalRisk('')).toBe('read')
    expect(assessLocalRisk('   ')).toBe('read')
  })
})

// ============================================================================
// 第 3 层：runAgent 端到端 — interactionMode 过滤行为
//    通过 mock chat 控制 onToolUse 回调传入特定工具，
//    捕获 addMessage 调用来验证拒绝/放行。
// ============================================================================

// 辅助：配置 chat mock
// 第一次调用：通过 onToolUse 传入指定工具
// 第二次调用：通过 onChunk 传入文本，使循环正常退出
function setupChat(toolUse: { id: string; name: string; input: Record<string, unknown> }) {
  let callCount = 0
  mockChat.mockImplementation(async (options: any) => {
    callCount++
    if (callCount === 1) {
      // 第一次：传入工具调用
      options.onToolUse?.(toolUse)
    } else {
      // 第二次：传入文本，不传工具 → 循环退出
      options.onChunk?.('Done.')
    }
  })
}

// 辅助：从 addMessage 调用中提取所有 tool 消息的 content
function getToolMessageContents(): string[] {
  return mockAddMessage.mock.calls
    .map((call: any[]) => call[0])
    .filter((msg: any) => msg.role === 'tool')
    .map((msg: any) => msg.content as string)
}

// 辅助：检查是否有 interactionMode 拒绝消息
function hasModeRejectMessage(contents: string[]): boolean {
  return contents.some(c => c.includes('[Chat mode]') || c.includes('[Read-Only mode]'))
}

beforeEach(() => {
  mockAddMessage.mockClear()
  mockSetPendingCommand.mockClear()
  mockChat.mockReset()
  interactionModeRef.value = 'agent'
  modeRef.value = 'confirm_all'
  stopRequestedRef.value = false
})

describe('runAgent × chat 模式', () => {
  beforeEach(() => {
    interactionModeRef.value = 'chat'
  })

  it('拒绝 execute_command（执行类工具）', async () => {
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'ls', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Chat mode]') && c.includes('execute_command'))).toBe(true)
  })

  it('拒绝 start_command（执行类工具）', async () => {
    setupChat({ id: 'tu-1', name: 'start_command', input: { command: 'top', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Chat mode]') && c.includes('start_command'))).toBe(true)
  })

  it('拒绝 send_terminal_key（执行类工具）', async () => {
    setupChat({ id: 'tu-1', name: 'send_terminal_key', input: { control: 'ctrl_c' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Chat mode]') && c.includes('send_terminal_key'))).toBe(true)
  })

  it('拒绝 save_skill（执行类工具）', async () => {
    setupChat({ id: 'tu-1', name: 'save_skill', input: { name: 'test', content: '...' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Chat mode]') && c.includes('save_skill'))).toBe(true)
  })

  it('拒绝 use_skill（执行类工具）', async () => {
    setupChat({ id: 'tu-1', name: 'use_skill', input: { name: 'test' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Chat mode]') && c.includes('use_skill'))).toBe(true)
  })

  it('放行 capture_terminal（查看类工具，不出现 chat 拒绝）', async () => {
    setupChat({ id: 'tu-1', name: 'capture_terminal', input: {} })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
  })

  it('放行 collect_output（查看类工具，不出现 chat 拒绝）', async () => {
    setupChat({ id: 'tu-1', name: 'collect_output', input: {} })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
  })

  it('放行 ask_user（safe 类工具，不出现 chat 拒绝）', async () => {
    setupChat({ id: 'tu-1', name: 'ask_user', input: { question: 'test?', options: [] } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
  })
})

describe('runAgent × readonly 模式', () => {
  beforeEach(() => {
    interactionModeRef.value = 'readonly'
  })

  it('拒绝 save_skill（WRITE_TOOLS）', async () => {
    setupChat({ id: 'tu-1', name: 'save_skill', input: { name: 'test', content: '...' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Read-Only mode]') && c.includes('save_skill'))).toBe(true)
  })

  it('拒绝 start_command（DANGEROUS_TOOLS）', async () => {
    setupChat({ id: 'tu-1', name: 'start_command', input: { command: 'top', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Read-Only mode]') && c.includes('start_command'))).toBe(true)
  })

  it('拒绝 send_terminal_key（DANGEROUS_TOOLS）', async () => {
    setupChat({ id: 'tu-1', name: 'send_terminal_key', input: { control: 'ctrl_c' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Read-Only mode]') && c.includes('send_terminal_key'))).toBe(true)
  })

  it('拒绝 interrupt_command（DANGEROUS_TOOLS）', async () => {
    setupChat({ id: 'tu-1', name: 'interrupt_command', input: {} })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Read-Only mode]') && c.includes('interrupt_command'))).toBe(true)
  })

  it('拒绝 execute_command with 写类命令（mkdir）', async () => {
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'mkdir newdir', risk: 'write' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Read-Only mode]') && c.includes('mkdir'))).toBe(true)
  })

  it('拒绝 execute_command with 危险命令（rm -rf）', async () => {
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'rm -rf /', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Read-Only mode]') && c.includes('rm -rf'))).toBe(true)
  })

  it('放行 execute_command with 读类命令（ls）', async () => {
    // bypass 模式让工具不 pause，直接执行（mock executeCommand 返回 ok）
    modeRef.value = 'bypass'
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'ls -la', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
  })

  it('放行 execute_command with 读类命令（cat）', async () => {
    modeRef.value = 'bypass'
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'cat /etc/hosts', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
  })

  it('放行 capture_terminal（查看类工具）', async () => {
    setupChat({ id: 'tu-1', name: 'capture_terminal', input: {} })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
  })

  it('放行 collect_output（查看类工具）', async () => {
    setupChat({ id: 'tu-1', name: 'collect_output', input: {} })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
  })

  it('拒绝 execute_command with 反绕过命令（sh -c）', async () => {
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'sh -c "rm -rf /"', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(contents.some(c => c.includes('[Read-Only mode]'))).toBe(true)
  })
})

describe('runAgent × agent 模式（走 risk 评估，不按 interactionMode 拒绝）', () => {
  beforeEach(() => {
    interactionModeRef.value = 'agent'
  })

  it('不拒绝 execute_command（走 risk + 确认逻辑）', async () => {
    // confirm_all 模式 → shouldConfirm 返回 true → setPendingCommand 被调用 → pause
    modeRef.value = 'confirm_all'
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'ls', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    // 不应出现 interactionMode 拒绝消息
    expect(hasModeRejectMessage(contents)).toBe(false)
    // 应进入确认流程（setPendingCommand 被调用）
    expect(mockSetPendingCommand).toHaveBeenCalled()
  })

  it('不拒绝 start_command（走 risk + 确认逻辑）', async () => {
    modeRef.value = 'confirm_all'
    setupChat({ id: 'tu-1', name: 'start_command', input: { command: 'top', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
    expect(mockSetPendingCommand).toHaveBeenCalled()
  })

  it('不拒绝 save_skill（agent 模式放行所有工具）', async () => {
    setupChat({ id: 'tu-1', name: 'save_skill', input: { name: 'test', content: '...' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
  })

  it('不拒绝 send_terminal_key（agent 模式放行所有工具）', async () => {
    setupChat({ id: 'tu-1', name: 'send_terminal_key', input: { control: 'ctrl_c' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
  })

  it('bypass 模式下危险命令直接执行（不拒绝、不确认）', async () => {
    modeRef.value = 'bypass'
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'rm -rf /tmp/test', risk: 'dangerous' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
    // bypass 模式不确认
    expect(mockSetPendingCommand).not.toHaveBeenCalled()
  })

  it('confirm_dangerous 模式下读类命令不确认（直接执行）', async () => {
    modeRef.value = 'confirm_dangerous'
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'ls', risk: 'read' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
    // read 类在 confirm_dangerous 模式下不需要确认
    expect(mockSetPendingCommand).not.toHaveBeenCalled()
  })

  it('confirm_dangerous 模式下危险命令需确认', async () => {
    modeRef.value = 'confirm_dangerous'
    setupChat({ id: 'tu-1', name: 'execute_command', input: { command: 'rm -rf /tmp/test', risk: 'dangerous' } })
    await runAgent('test')
    const contents = getToolMessageContents()
    expect(hasModeRejectMessage(contents)).toBe(false)
    expect(mockSetPendingCommand).toHaveBeenCalled()
  })
})

// ============================================================================
// 第 4 层：buildInteractionModePrompt 间接验证
//    system prompt 通过 chatOptions.system 传给 chat，
//    不同 interactionMode 应注入不同的模式约束提示。
// ============================================================================

describe('buildInteractionModePrompt 注入（通过 chatOptions.system 验证）', () => {
  it('chat 模式注入 INTERACTION MODE: CHAT 提示', async () => {
    interactionModeRef.value = 'chat'
    mockChat.mockImplementation(async (options: any) => {
      // 验证 system prompt 包含 chat 模式提示
      expect(options.system).toContain('INTERACTION MODE: CHAT')
      // 不传工具，传文本使循环退出
      options.onChunk?.('Done.')
    })
    await runAgent('test')
  })

  it('readonly 模式注入 INTERACTION MODE: READ-ONLY 提示', async () => {
    interactionModeRef.value = 'readonly'
    mockChat.mockImplementation(async (options: any) => {
      expect(options.system).toContain('INTERACTION MODE: READ-ONLY')
      options.onChunk?.('Done.')
    })
    await runAgent('test')
  })

  it('agent 模式不注入 INTERACTION MODE 提示', async () => {
    interactionModeRef.value = 'agent'
    mockChat.mockImplementation(async (options: any) => {
      expect(options.system).not.toContain('INTERACTION MODE')
      options.onChunk?.('Done.')
    })
    await runAgent('test')
  })
})