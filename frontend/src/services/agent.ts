import { chat, ChatCancelledError, ChatTimeoutError } from './llm'
import { executeCommand, startCommand } from './terminalAgent'
import { useAIStore } from '../stores/aiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTabStore } from '../stores/tabStore'
import { usePanelStore } from '../stores/panelStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSkillStore } from '../stores/skillStore'
import type { AIMessage } from '../types/ai'
import { Events } from '@wailsio/runtime'
import { InputValidationError } from '../utils/runtimeTypeCheck'
import { assessLocalRisk } from './localRisk'
import { toolRegistry, AVAILABLE_TOOLS, EXECUTION_TOOLS, WRITE_TOOLS, DANGEROUS_TOOLS } from './tools'
import { capToolResult, formatExecuteResult } from './tools/_shared'
import type { ToolContext, RiskLevel } from './tools/types'
import { hasMCPTools, getMCPToolSchemas, isMCPTool } from './mcp/registry'

// Global token listener management: only one runAgent instance should receive
// ai:token events at a time. Registering a new listener automatically cancels
// the previous one, preventing duplicate streaming into multiple assistant
// messages when a stop/continue sequence races. F-315: each register call
// bumps a generation counter; the returned cleanup only clears module state
// when its generation still matches, so an early-return path that gets
// superseded by a re-entry (approveTool → runAgent; rejectTool / answer /
// dismissQuestion setTimeout→runAgent) can't accidentally clobber a newer
// pair by running its stale cleanup.
let activeTokenUnsubscribe: (() => void) | null = null
let activeAssistantMsg: AIMessage | null = null
let activeGeneration = 0

function registerTokenListener(callback: (data: any) => void): () => void {
  activeTokenUnsubscribe?.()
  activeTokenUnsubscribe =Events.On('ai:token', (ev) => callback(ev.data))
  activeGeneration++
  const myGeneration = activeGeneration
  return () => {
    if (myGeneration !== activeGeneration) return
    activeTokenUnsubscribe?.()
    activeTokenUnsubscribe = null
    activeAssistantMsg = null
  }
}

function setActiveAssistantMsg(msg: AIMessage | null) {
  activeAssistantMsg = msg
}

function getActivePanel() {
  const tabStore = useTabStore()
  const panelStore = usePanelStore()

  // Check for AI-locked panel first
  const lockedPanelId = tabStore.getAILockedPanel()
  if (lockedPanelId) {
    return panelStore.getPanel(lockedPanelId)
  }

  // Fall back to active panel based on tab type
  const activeTab = tabStore.activeTab
  if (!activeTab) return undefined

  if (activeTab.type === 'terminal' || activeTab.type === 'settings') {
    return panelStore.getPanel(activeTab.panelId)
  }

  if (activeTab.type === 'workspace' && activeTab.activePanelId) {
    return panelStore.getPanel(activeTab.activePanelId)
  }

  return undefined
}

function hasActiveSession(): boolean {
  const panel = getActivePanel()
  return !!panel?.sessionId
}

// RiskLevel is now imported from ./tools/types (A3 refactor).

export const VALID_RISK: readonly RiskLevel[] = ['read', 'write', 'dangerous']

// S2: normalize the model-declared risk field into one of the three literal
// levels. Unknown / missing / wrong-typed → 'dangerous' (default-closed).
function normalizeRisk(risk: unknown): RiskLevel {
  if (risk === 'read' || risk === 'write' || risk === 'dangerous') return risk
  return 'dangerous'
}

// S2: take the stricter of two risk levels (dangerous > write > read).
function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = { read: 0, write: 1, dangerous: 2 }
  return order[a] >= order[b] ? a : b
}

// S2: read the local-risk-guard toggle from settings. Defaults to true when
// the store isn't initialised yet (e.g. unit tests without pinia) or when the
// field is absent — the guard is opt-OUT, not opt-IN.
function isLocalRiskGuardEnabled(): boolean {
  try {
    return useSettingsStore().settings.ai.localRiskGuardEnabled !== false
  } catch {
    return true
  }
}

// `command` is optional so existing callers/tests that only pass the tool-use
// shape still work; when omitted, the local pattern guard is skipped and we
// fall back to trusting the model-declared risk alone (backwards-compatible).
export function getRisk(tu: { name: string; input: Record<string, unknown> }, command?: string): RiskLevel {
  if (tu.name !== 'execute_command' && tu.name !== 'start_command') return 'dangerous'
  const modelRisk = normalizeRisk(tu.input.risk)
  if (!command) return modelRisk
  if (!isLocalRiskGuardEnabled()) return modelRisk
  const localRisk = assessLocalRisk(command)
  // 本地防线永不低于模型声明：取更严格者。
  return maxRisk(modelRisk, localRisk)
}

function shouldConfirm(risk: RiskLevel): boolean {
  const store = useAIStore()
  switch (store.mode) {
    case 'confirm_all': return true
    case 'confirm_write': return risk !== 'read'
    case 'confirm_dangerous': return risk === 'dangerous'
    case 'bypass': return false
    default: return risk !== 'read'
  }
}

// ---- Tool input validators (FE-P0-3) ----
// Tool input validators + capToolResult + formatExecuteResult have been moved
// to ./tools/*.ts (A3 refactor). agent.ts now dispatches via toolRegistry.

function getShellName(path?: string): string {
  if (!path) return 'Unknown'
  const lower = path.toLowerCase()
  if (lower.includes('pwsh')) return 'PowerShell'
  if (lower.includes('powershell')) return 'Windows PowerShell'
  if (lower.includes('bash')) return 'Bash'
  if (lower.includes('zsh')) return 'Zsh'
  if (lower.includes('fish')) return 'Fish'
  if (lower.includes('cmd')) return 'CMD'
  if (lower.includes('sh')) return 'Sh'
  return path.split(/[\\/]/).pop() || 'Unknown'
}

/**
 * Shell-specific suffix: appended to system rules dynamically (NOT cached).
 * Lightweight enough that it doesn't significantly impact cache efficiency.
 */
function getShellGuidance(shellPath?: string, isWindowsShell?: boolean, isWindowsOpenSSH?: boolean): string {
  if (isWindowsOpenSSH) {
    return '\n\nThe active terminal is a Windows OpenSSH remote. Its shell could be CMD or PowerShell — determine which first (e.g. run `echo %COMSPEC%` / `ver` for CMD, or `$PSVersionTable` for PowerShell), then use the matching syntax: CMD (dir, type, cd, wmic) or PowerShell (Get-ChildItem, Get-Content, Set-Location).'
  }
  if (isWindowsShell) {
    const isCmd = shellPath?.toLowerCase().includes('cmd')
    return isCmd
      ? '\n\nThe active terminal is Windows CMD. Use CMD syntax (dir, cd, type, wmic, etc.).'
      : '\n\nThe active terminal is Windows PowerShell. Use cmdlets like Get-ChildItem, Set-Location, Get-Content, etc.'
  }
  return '\n\nThe active terminal is a Unix-like shell. Use standard Unix syntax (ls, cat, grep, find, etc.).'
}

/**
 * Whether the given panel is a Windows OpenSSH remote, as detected by the
 * backend from the SSH server identification string and reported via the
 * session:status event. Only meaningful once the connection is established.
 */
function isWindowsOpenSSHPanel(p: { sessionId: string | null } | undefined): boolean {
  if (!p?.sessionId) return false
  return useSessionStore().getRemoteOS(p.sessionId) === 'windows-openssh'
}

/**
 * Build the dynamic context header injected into the latest user message.
 * Carries current shell/terminal state WITHOUT polluting the system prompt.
 */
function buildDynamicContext(): string {
  const store = useAIStore()
  const tabStore = useTabStore()
  const panelStore = usePanelStore()

  const lockedPanels = tabStore.getAILockedPanels()
  const panelIds = lockedPanels.length > 0
    ? lockedPanels
    : (() => {
        const activePanel = getActivePanel()
        return activePanel ? [activePanel.id] : []
      })()

  if (panelIds.length === 0) return ''

  const parts: string[] = []
  parts.push('AVAILABLE PANELS:')

  // Collect panels, dedupe titles with id suffix
  const titleCounts = new Map<string, number>()
  const panels = panelIds.map(id => panelStore.getPanel(id)).filter(Boolean)

  // First pass: count titles to detect duplicates
  for (const p of panels) {
    titleCounts.set(p!.title, (titleCounts.get(p!.title) || 0) + 1)
  }

  // Second pass: build display names
  let idx = 1
  for (const p of panels) {
    if (!p) continue
    const shellPath = p.config?.shellPath
    const shellName = shellPath
      ? getShellName(shellPath)
      : (p.type === 'ssh' ? (isWindowsOpenSSHPanel(p) ? 'SSH (Windows OpenSSH)' : 'SSH (Unix-like)') : 'Unknown')

    const displayName = titleCounts.get(p.title)! > 1
      ? `${p.title} (id: ${p.id})`
      : p.title

    const lineParts: string[] = []
    lineParts.push(`  ${idx}. "${displayName}" [${shellName}]`)

    if (p.type === 'ssh' && p.config) {
      lineParts.push(` [SSH: ${p.config.user}@${p.config.host}:${p.config.port}]`)
    }

    parts.push(lineParts.join(''))
    idx++
  }

  parts.push('\n' + '='.repeat(40))

  // Terminal switch detection
  const lastCtx = store.lastPanelContext
  if (lastCtx && lockedPanels.length > 0 && !lockedPanels.includes(lastCtx.panelId)) {
    const prev = lastCtx.shellPath ? getShellName(lastCtx.shellPath) : 'another terminal'
    const firstPanel = panelStore.getPanel(lockedPanels[0])
    const currShell = firstPanel?.config?.shellPath
    const curr = currShell ? getShellName(currShell) : (firstPanel?.type === 'ssh' ? 'SSH' : 'local terminal')
    parts.push(`\n【NOTICE】User changed AI panel selection from "${prev}" to "${curr}". Now targeting "${firstPanel?.title || 'unknown'}". Reassess the environment from scratch.`)
  }

  return parts.join('\n')
}

/**
 * Build the system prompt: static rules from store + lightweight shell guidance.
 * Dynamic context (shell banner, switch notices) goes into the user message.
 */
function buildSystemPrompt(): string {
  const store = useAIStore()
  const activePanel = getActivePanel()
  const shellPath = activePanel?.config?.shellPath
  const isWindowsShell = !!shellPath && (
    shellPath.toLowerCase().includes('powershell') ||
    shellPath.toLowerCase().includes('pwsh') ||
    shellPath.toLowerCase().includes('cmd')
  )
  const isWindowsOpenSSH = isWindowsOpenSSHPanel(activePanel)
  return store.systemPrompt + getShellGuidance(shellPath, isWindowsShell, isWindowsOpenSSH) + buildSkillIndex() + buildInteractionModePrompt() + buildMCPToolsPrompt()
}

/**
 * F3: 当有 MCP 工具注册时，在 system prompt 末尾注入 MCP 工具说明。
 * 让 AI 知道它有外部工具可用，并提示这些工具来自外部 server。
 */
function buildMCPToolsPrompt(): string {
  if (!hasMCPTools()) return ''
  return '\n\n=== MCP TOOLS ===\nYou also have access to MCP tools from external servers. These tools extend your capabilities with additional functions provided by external MCP servers. Tool names follow the pattern mcp__<server>__<tool>. Call them like any other tool when the task matches their description.'
}

/**
 * F1: 根据 interactionMode 在 system prompt 末尾注入模式约束提示。
 * agent 模式不注入（走现有 risk + 确认逻辑，保持向后兼容）。
 */
function buildInteractionModePrompt(): string {
  const store = useAIStore()
  switch (store.interactionMode) {
    case 'chat':
      return '\n\n=== INTERACTION MODE: CHAT ===\nYou are in Chat mode. You CANNOT execute any commands. You can only view terminal output (capture_terminal/collect_output) and answer questions. Do NOT call execute_command, start_command, send_terminal_key, interrupt_command, save_skill, or use_skill. If the user asks you to perform an action that requires running a command, explain what command they should run themselves.'
    case 'readonly':
      return '\n\n=== INTERACTION MODE: READ-ONLY ===\nYou are in Read-Only mode. You can only execute READ-ONLY commands (e.g., ls, cat, grep, ps, df). Write and dangerous commands (rm, mv, chmod, kill, >redirect, save_skill, start_command, send_terminal_key, interrupt_command) are PROHIBITED and will be rejected. If a task requires a write/dangerous command, tell the user what to run instead.'
    case 'agent':
    default:
      return '' // 走现有 risk + 确认逻辑
  }
}

/**
 * F1: 根据 interactionMode 判定是否拒绝该工具调用。
 * 返回拒绝原因字符串；返回 null 表示放行。
 * agent 模式永远放行（走现有 risk + 确认逻辑）。
 *
 * readonly 模式下 execute_command 按命令本身 localRisk 判定：
 *   - read 类命令（ls/cat/grep/...）放行
 *   - write/dangerous 类命令拒绝
 */
function rejectToolByInteractionMode(tu: { name: string; input: Record<string, unknown> }): string | null {
  const store = useAIStore()
  switch (store.interactionMode) {
    case 'chat':
      if (EXECUTION_TOOLS.has(tu.name)) {
        return `[Chat mode] Tool "${tu.name}" is disabled. Chat mode only allows viewing terminal output and answering questions. Tell the user what command to run themselves.`
      }
      // F3: MCP 工具与外部进程交互，chat 模式下禁用。
      if (isMCPTool(tu.name)) {
        return `[Chat mode] MCP tool "${tu.name}" is disabled. Chat mode only allows viewing terminal output and answering questions.`
      }
      return null
    case 'readonly':
      // 写类 + 危险类工具一律拒绝
      if (WRITE_TOOLS.has(tu.name) || DANGEROUS_TOOLS.has(tu.name)) {
        return `[Read-Only mode] Tool "${tu.name}" is prohibited. Read-Only mode only allows read-only commands. Tell the user what command to run themselves.`
      }
      // F3: MCP 工具归为写类（与外部进程交互），readonly 模式下禁用。
      if (isMCPTool(tu.name)) {
        return `[Read-Only mode] MCP tool "${tu.name}" is prohibited. Read-Only mode only allows read-only commands.`
      }
      // execute_command 按命令 localRisk 判定
      if (tu.name === 'execute_command' || tu.name === 'start_command') {
        const cmd = typeof tu.input.command === 'string' ? tu.input.command : ''
        if (cmd) {
          const localRisk = assessLocalRisk(cmd)
          if (localRisk !== 'read') {
            return `[Read-Only mode] Command "${cmd.slice(0, 80)}" was assessed as ${localRisk}. Read-Only mode only allows read-only commands. Tell the user what command to run themselves.`
          }
        }
      }
      return null
    case 'agent':
    default:
      return null
  }
}

/**
 * L1 skill index: name + description of enabled skills, appended to the system
 * prompt so the model knows which skills exist (to invoke or avoid duplicating).
 */
function buildSkillIndex(): string {
  const skillStore = useSkillStore()
  const list = skillStore.enabledSkills.filter(s => s.modelInvocable)
  if (list.length === 0) return ''
  const lines = list.map(s => `- /${s.name}: ${s.description}`).join('\n')
  return `\n\nAVAILABLE SKILLS (when one matches the task, call the use_skill tool with its name to load its full instructions before acting; do NOT duplicate an existing one with save_skill):\n${lines}`
}

export async function runAgent(userInput: string, skillName?: string, skillBody?: string, commandBody?: string) {
  const store = useAIStore()

  if (!hasActiveSession()) {
    // 输入框已禁用，正常流程不会走到这里；兜底直接返回，不写入任何消息
    return
  }

  // Auto-reject any pending command/question from previous turn
  if (userInput && store.pendingCommand) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: 'User started a new conversation. Previous command was cancelled.',
      tool_call_id: store.pendingCommand.toolId
    })
    store.clearPendingCommand()
  }
  if (userInput && store.pendingQuestion) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: 'User started a new conversation. Previous question was dismissed.',
      tool_call_id: store.pendingQuestion.toolId
    })
    store.clearPendingQuestion()
  }

  store.resetStop()
  store.isRunning = true
  store.status = 'thinking'

  // Record current panel context so buildDynamicContext can detect terminal switches
  const tabStore = useTabStore()
  const lockedPanels = tabStore.getAILockedPanels()
  const activePanel = getActivePanel()
  const trackPanelId = lockedPanels.length > 0 ? lockedPanels[0] : activePanel?.id
  if (trackPanelId) {
    const panelStore = usePanelStore()
    const tp = panelStore.getPanel(trackPanelId)
    store.setLastPanelContext(trackPanelId, tp?.config?.shellPath || '')
  }

  if (userInput || (skillName && skillBody) || commandBody) {
    const dynamicCtx = buildDynamicContext()
    // skill/command 正文进 _contextHeader（发给模型但 UI 隐藏），content 只留用户原始输入
    let header = dynamicCtx || ''
    if (skillName && skillBody) {
      const skillCtx = `[Skill: ${skillName}]\n${skillBody}`
      header = header ? `${skillCtx}\n\n${header}` : skillCtx
      store.addSkillCard(skillName, 'explicit')
    }
    if (commandBody) {
      const cmdCtx = `[Command]\n${commandBody}`
      header = header ? `${cmdCtx}\n\n${header}` : cmdCtx
    }
    // 仅选 skill/命令未输入文字时，给一句明确指令作为 content，避免发送空的 user 消息
    const content = userInput || (skillName ? `请执行 skill「${skillName}」。` : `请执行命令。`)
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      _contextHeader: header || undefined
    })
  }

  // Track whether streaming already delivered text, to skip onChunk duplication
  let streamedText = ''

  // Register stream event listener (fires from Go backend SSE events)
  const cleanupTokenListener = registerTokenListener((data: any) => {
    if (store.stopRequested) return
    if (activeAssistantMsg && data.text) {
      activeAssistantMsg.content += data.text
      streamedText += data.text
      store.status = 'outputting'
    }
  })

  function cleanupStreamListeners() {
    cleanupTokenListener()
    setActiveAssistantMsg(null)
  }

  let turnCount = 0
  const maxTurns = useSettingsStore().settings.ai.maxTurns ?? 20

  while (maxTurns === 0 || turnCount < maxTurns) {
    turnCount++

    if (store.stopRequested) {
      store.addMessage({
        id: `msg-${Date.now()}`,
        role: 'tool',
        content: '[INTERRUPTED]'
      })
      store.isRunning = false
      cleanupStreamListeners()
      return
    }

    // Drain queued user messages at the turn boundary. Injected messages become
    // real user turns; reset turnCount so the new instruction regains its full
    // autonomous-turn budget.
    if (store.queuedMessages.length > 0) {
      const drained = store.queuedMessages.splice(0)
      drained.forEach((q, i) => {
        let header = ''
        if (q.skillName && q.skillBody) {
          header = `[Skill: ${q.skillName}]\n${q.skillBody}`
          store.addSkillCard(q.skillName, 'explicit')
        }
        if (q.commandBody) {
          const cmdCtx = `[Command]\n${q.commandBody}`
          header = header ? `${cmdCtx}\n\n${header}` : cmdCtx
        }
        store.addMessage({
          id: `msg-${Date.now()}-${i}`,
          role: 'user',
          content: q.content || (q.skillName ? `请执行 skill「${q.skillName}」。` : `请执行命令。`),
          _contextHeader: header || undefined,
        })
      })
      turnCount = 0
    }

    const assistantMsg = store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: ''
    })
    setActiveAssistantMsg(assistantMsg)

    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

    const chatOptions: any = {
      system: buildSystemPrompt(),
      messages: store.conversation,
      tools: [...AVAILABLE_TOOLS, ...getMCPToolSchemas()],
      onChunk: (chunk: string) => {
        if (store.stopRequested) return
        if (streamedText) return // already handled by ai:token events
        assistantMsg.content += chunk
      },
      onToolUse: (tu: { id: string; name: string; input: Record<string, unknown> }) => {
        if (store.stopRequested) return
        toolUses.push(tu)
      }
    }
    try {
      store.status = 'thinking'
      await chat(chatOptions)
      // Preserve raw API message blocks for conversation history
      if (chatOptions._rawApiMsg) {
        assistantMsg._rawApiMsg = chatOptions._rawApiMsg
      }
      // Save immediately so the complete assistant content and raw API message are persisted
      store.doSave()
    } catch (e: any) {
      const errMsg = e.message ?? String(e)
      // Convert the failed assistant placeholder to a display-only tool message.
      // This keeps the error visible in the UI without polluting the API conversation.
      assistantMsg.role = 'tool'
      if (e instanceof ChatCancelledError || store.stopRequested) {
        assistantMsg.content = '[INTERRUPTED]'
      } else if (e instanceof ChatTimeoutError) {
        assistantMsg.content = '[TIMEOUT]'
      } else {
        assistantMsg.content = `[Error: ${errMsg}]`
      }
      delete assistantMsg._rawApiMsg
      delete assistantMsg.tool_calls
      store.setDebugInfo(store.conversation, errMsg)
      store.isRunning = false
      cleanupStreamListeners()
      return
    }

    if (store.stopRequested) {
      // Cancel any tool calls that were received but not executed
      const cancelledIds = new Set<string>()
      const rawContent = assistantMsg._rawApiMsg?.content
      if (Array.isArray(rawContent)) {
        for (const block of rawContent) {
          if (block.type === 'tool_use' && !cancelledIds.has(block.id)) {
            store.addMessage({
              id: `msg-${Date.now()}`,
              role: 'tool',
              content: 'Command was cancelled by user (Stop).',
              tool_call_id: block.id
            })
            cancelledIds.add(block.id)
          }
        }
      }
      // If no tool calls were pending, the user stopped during text generation.
      // Replace the partial assistant message with a clean stop notice.
      if (cancelledIds.size === 0) {
        assistantMsg.role = 'tool'
        assistantMsg.content = '[INTERRUPTED]'
        delete assistantMsg._rawApiMsg
        delete assistantMsg.tool_calls
      }
      store.isRunning = false
      cleanupStreamListeners()
      return
    }

    // Enforce single tool call
    if (toolUses.length > 1) {
      toolUses.splice(1)
    }

    // Store tool calls in the message for UI confirmation
    if (toolUses.length > 0) {
      assistantMsg.tool_calls = toolUses.map(tu => ({
        id: tu.id,
        type: 'function' as const,
        function: {
          name: tu.name,
          arguments: JSON.stringify(tu.input)
        }
      }))
    }

    if (!assistantMsg.content && toolUses.length === 0) {
      assistantMsg.content = '[No response received from the model. Check your API settings and network connection.]'
      store.isRunning = false
      cleanupStreamListeners()
      return
    }

    if (toolUses.length === 0) {
      // If the user queued messages while the model was responding, don't end —
      // continue looping so the next iteration drains and processes them.
      if (store.queuedMessages.length > 0) {
        continue
      }
      store.isRunning = false
      cleanupStreamListeners()
      return
    }

    // Process exactly one tool call
    const tu = toolUses[0]

    // Surface a malformed tool_use back to the model instead of executing it.
    // Returns true if the caller should `continue` (skip this iteration).
    function handleInvalidInput(reason: string): true {
      store.addMessage({
        id: `msg-${Date.now()}`,
        role: 'tool',
        content: `[Error: invalid ${tu.name} input — ${reason}]. Retry with the documented JSON shape.`,
        tool_call_id: tu.id
      })
      return true
    }

    const tool = toolRegistry.get(tu.name)
    if (!tool) {
      // Unknown tool — original if-else chain silently skipped unmatched names.
      // Emit an error tool message so the model learns the available set.
      store.addMessage({
        id: `msg-${Date.now()}`,
        role: 'tool',
        content: `[Error: unknown tool "${tu.name}"]. Available tools: ${Array.from(toolRegistry.keys()).join(', ')}.`,
        tool_call_id: tu.id
      })
      continue
    }

    // F1: interactionMode 过滤 — chat/readonly 模式拒绝执行类/写类工具。
    // agent 模式 rejectToolByInteractionMode 永远返回 null，行为与改动前一致。
    const modeRejectReason = rejectToolByInteractionMode(tu)
    if (modeRejectReason) {
      store.addMessage({
        id: `msg-${Date.now()}`,
        role: 'tool',
        content: modeRejectReason,
        tool_call_id: tu.id
      })
      continue
    }

    let validated
    try {
      validated = tool.validate(tu.input)
    } catch (e: any) {
      if (e instanceof InputValidationError) { handleInvalidInput(e.message); continue }
      throw e
    }

    const ctx: ToolContext = {
      store,
      assistantMsg,
      toolUseId: tu.id,
      rawInput: tu.input,
      capToolResult,
      cleanupStreamListeners,
      getRisk,
      shouldConfirm,
    }
    const result = await tool.execute(ctx, validated)
    if (result.kind === 'pause' || result.kind === 'stop') {
      return
    }
  }

  // Max turns reached - prompt user to continue
  if (turnCount >= maxTurns) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: `已达到最大对话轮次限制（${maxTurns}轮）。点击"继续"或发送任意消息以继续。`,
      needsContinue: true
    })
  }

  cleanupStreamListeners()
  store.isRunning = false
  store.doSave()
}

export async function continueAgent() {
  const store = useAIStore()
  const lastMsg = store.messages[store.messages.length - 1]
  if (lastMsg?.needsContinue) {
    store.messages.pop()
  }
  await runAgent('')
}

export async function approveTool(_messageId: string) {
  const store = useAIStore()
  const cmd = store.pendingCommand
  if (!cmd) return

  if (!hasActiveSession()) {
    store.clearPendingCommand()
    return
  }

  store.clearPendingCommand()
  store.isRunning = true
  store.status = 'executing'

  try {
    if (cmd.toolName === 'start_command') {
      const result = await startCommand(cmd.command)
      store.addMessage({
        id: `msg-${Date.now()}`,
        role: 'tool',
        content: capToolResult(result.output || '(command started)'),
        tool_call_id: cmd.toolId
      })
    } else {
      const result = await executeCommand(cmd.command)
      store.addMessage({
        id: `msg-${Date.now()}`,
        role: 'tool',
        content: capToolResult(formatExecuteResult(result)),
        tool_call_id: cmd.toolId
      })
    }
  } catch (e: any) {
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'tool',
      content: `[Error executing command: ${e.message ?? e}]`,
      tool_call_id: cmd.toolId
    })
  }
  await runAgent('')
}

export function rejectTool(_messageId: string) {
  const store = useAIStore()
  const cmd = store.pendingCommand
  if (!cmd) return

  store.clearPendingCommand()

  store.addMessage({
    id: `msg-${Date.now()}`,
    role: 'tool',
    content: 'User rejected this command.',
    tool_call_id: cmd.toolId
  })

  setTimeout(() => runAgent(''), 0)
}

export function answerQuestion(selectedLabels: string[], customText?: string) {
  const store = useAIStore()
  const q = store.pendingQuestion
  if (!q) return

  store.clearPendingQuestion()

  let answer: string
  if (customText !== undefined && customText.trim() !== '') {
    answer = `User chose "Other": ${customText.trim()}`
  } else if (q.multiSelect && selectedLabels.length > 1) {
    answer = `User selected: ${selectedLabels.join(', ')}`
  } else {
    answer = `User chose: ${selectedLabels[0]}`
  }

  store.addMessage({
    id: `msg-${Date.now()}`,
    role: 'tool',
    content: answer,
    tool_call_id: q.toolId
  })

  setTimeout(() => runAgent(''), 0)
}

export function dismissQuestion() {
  const store = useAIStore()
  const q = store.pendingQuestion
  if (!q) return

  store.clearPendingQuestion()

  store.addMessage({
    id: `msg-${Date.now()}`,
    role: 'tool',
    content: 'User dismissed this question.',
    tool_call_id: q.toolId
  })

  setTimeout(() => runAgent(''), 0)
}
