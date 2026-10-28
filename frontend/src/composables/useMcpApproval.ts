/**
 * useMcpApproval — MCP 审批对话框桥接 (App.vue 拆分)
 *
 * 从 App.vue 下沉：
 *   - mcpApprovalVisible / mcpApprovalRequest
 *   - onMcpApprovalResolve（dialog → ResolveMCPApproval binding）
 *   - onMcpSessionCreated（MCP 创建的终端会话挂载）
 *   - Wails EventsOn 注册/注销 (mcp:approval-request / mcp:session-created)
 *
 * App.vue 用法：
 *   const mcp = useMcpApproval()
 *   // 模板绑定 mcp.mcpApprovalVisible / mcp.mcpApprovalRequest / mcp.onMcpApprovalResolve
 *   // onMounted 中调用 mcp.init()
 *   // onUnmounted 中调用 mcp.dispose()
 */
import { ref } from 'vue'
import { Events } from '@wailsio/runtime'
import { useTabStore } from '../stores/tabStore'
import { usePanelStore } from '../stores/panelStore'
import { useSessionStore } from '../stores/sessionStore'
import { ResolveMCPApproval, CloseSession, SessionStart } from '../../bindings/github.com/ys-ll/uniterm/app'
import { waitForTerminalSize } from '../services/terminalManager'
import type { MCPApprovalRequest } from '../types/mcp'
import type { ConnectionConfig } from '../types/session'
import type { PanelType } from '../types/workspace'

export function useMcpApproval() {
  const tabStore = useTabStore()
  const panelStore = usePanelStore()
  const sessionStore = useSessionStore()

  const mcpApprovalVisible = ref(false)
  const mcpApprovalRequest = ref<MCPApprovalRequest | null>(null)
  let unsubMcpApproval: (() => void) | null = null
  let unsubMcpSessionCreated: (() => void) | null = null

  function onMcpApprovalResolve(approved: boolean, reason: string) {
    const req = mcpApprovalRequest.value
    mcpApprovalVisible.value = false
    mcpApprovalRequest.value = null
    if (req) ResolveMCPApproval(req.id, approved, reason).catch(() => {})
  }

  // MCP-created sessions follow the same terminal mounting and sizing flow as UI sessions.
  async function onMcpSessionCreated(payload: { sessionId: string; type: string; name?: string; host?: string; config: ConnectionConfig }) {
    const cfg = payload.config
    const panel = panelStore.createPanel(cfg, payload.type as PanelType)
    const title = payload.name || payload.host || payload.type
    panelStore.updateTitle(panel.id, title)
    panelStore.bindSession(panel.id, payload.sessionId)
    sessionStore.initSession(payload.sessionId)
    sessionStore.updateStatus(payload.sessionId, 'connecting')
    const tab = tabStore.activeTab?.type === 'start'
      ? tabStore.replaceStartTab(tabStore.activeTab.id, title, panel.id)
      : tabStore.createTerminalTab(title, panel.id)
    panelStore.movePanelToTab(panel.id, tab.id)
    // TCP sessions already connect during CreateSession; other text terminals
    // wait for measured dimensions before starting their PTY.
    if (payload.type === 'tcp') return
    try {
      const size = await waitForTerminalSize(payload.sessionId)
      cfg.initialCols = size.cols
      cfg.initialRows = size.rows
      await SessionStart(payload.sessionId, cfg)
    } catch (e) {
      console.error('Failed to start MCP terminal:', e)
      CloseSession(payload.sessionId).catch(() => {})
    }
  }

  function init() {
    unsubMcpApproval = Events.On('mcp:approval-request', (ev) => {
      mcpApprovalRequest.value = ev.data as MCPApprovalRequest
      mcpApprovalVisible.value = true
    })
    unsubMcpSessionCreated = Events.On('mcp:session-created', (ev) => {
      void onMcpSessionCreated(ev.data)
    })
  }

  function dispose() {
    unsubMcpApproval?.()
    unsubMcpSessionCreated?.()
  }

  return {
    mcpApprovalVisible,
    mcpApprovalRequest,
    onMcpApprovalResolve,
    init,
    dispose,
  }
}