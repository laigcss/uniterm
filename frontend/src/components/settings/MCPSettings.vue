<template>
  <div v-if="settingsStore.activeCategory === 'mcp'" class="settings-section" :class="{ narrow: isNarrow }">
    <h2 class="section-title">{{ t('settings.mcpSection') }}</h2>
    <p class="section-desc">{{ t('settings.mcpSectionDesc') }}</p>

    <div class="settings-group">
      <div class="setting-card">
        <div class="setting-info">
          <div class="setting-title">{{ t('settings.mcpEnabled') }}</div>
          <div class="setting-desc">{{ t('settings.mcpEnabledDesc') }}</div>
          <div v-if="mcpStatus.running" class="setting-desc mcp-running">{{ t('settings.mcpRunningOn', { port: mcpStatus.port }) }}</div>
          <div v-else-if="mcp.enabled" class="setting-desc mcp-running mcp-error">{{ t('settings.mcpNotRunning') }}</div>
        </div>
        <div class="setting-control switch-control">
          <el-switch v-model="mcp.enabled" @change="saveMcp()" />
        </div>
      </div>

      <div class="setting-card">
        <div class="setting-info">
          <div class="setting-title">{{ t('settings.mcpPort') }}</div>
        </div>
        <div class="setting-control">
          <el-input-number v-model="mcpPort" :min="1" :max="65535" controls-position="right" @change="saveMcp()" />
        </div>
      </div>

      <div class="setting-card">
        <div class="setting-info">
          <div class="setting-title">{{ t('settings.mcpPolicy') }}</div>
          <div class="setting-desc">{{ t('settings.mcpPolicyDesc') }}</div>
        </div>
        <div class="setting-control">
          <el-select v-model="mcp.policy" @change="saveMcp()">
            <!-- Same option set and labels as the AI panel's mode menu (ai.*) so both fronts read identically. -->
            <el-option :label="t('ai.confirmAll')" value="confirm_all" />
            <el-option :label="t('ai.confirmWrite')" value="confirm_write" />
            <el-option :label="t('ai.confirmDangerous')" value="confirm_dangerous" />
            <el-option :label="t('ai.bypass')" value="bypass" />
          </el-select>
        </div>
      </div>
    </div>

    <h2 class="section-title">{{ t('settings.mcpClientTokens') }}</h2>
    <p class="section-desc">{{ t('settings.mcpTokensDesc') }}</p>

    <div class="settings-group">
      <div class="setting-card">
        <div class="setting-info">
          <div class="setting-title">{{ t('settings.mcpGenerateToken') }}</div>
        </div>
        <div class="setting-control mcp-token-controls">
          <el-input v-model="newTokenName" :placeholder="t('settings.mcpTokenName')" style="width: 10rem" />
          <el-button @click="generateToken">{{ t('settings.mcpGenerateToken') }}</el-button>
        </div>
      </div>

      <div
        v-for="name in mcpTokens"
        :key="name"
        class="model-card"
      >
        <div class="model-main mcp-token-main">
          <el-icon class="mcp-token-icon"><Key :size="'0.875rem'" /></el-icon>
          <span class="model-name">{{ name }}</span>
        </div>
        <div class="model-actions">
          <el-button link type="danger" @click="revokeToken(name)">
            <el-icon><Trash2 :size="'0.875rem'" /></el-icon>
          </el-button>
        </div>
      </div>
    </div>
  </div>

  <div v-else-if="settingsStore.activeCategory === 'mcp-client'" class="settings-section" :class="{ narrow: isNarrow }">
    <h2 class="section-title">{{ t('settings.mcpClientSection') }}</h2>
    <p class="section-desc">{{ t('settings.mcpClientSectionDesc') }}</p>

    <div class="settings-group">
      <div
        v-for="c in mcpClients"
        :key="c.name"
        class="model-card"
      >
        <div class="model-main">
          <el-icon class="mcp-token-icon"><Plug :size="'0.875rem'" /></el-icon>
          <span class="model-name">{{ c.name }}</span>
          <span class="setting-desc">
            {{ c.transport === 'stdio' ? (c.command || '') : (c.url || '') }}
          </span>
          <span class="setting-desc">
            {{ mcpClientStatus(c.name)?.connected
              ? t('settings.mcpClientOnline', { tools: mcpClientStatus(c.name)?.tools ?? 0 })
              : (mcpClientStatus(c.name)?.error ? mcpClientStatus(c.name)?.error : t('settings.mcpClientOffline')) }}
          </span>
        </div>
        <div class="model-actions">
          <el-switch v-model="c.enabled" @change="saveMcpClient(c)" />
          <el-button link @click="testMcpClient(c)">{{ t('settings.mcpClientTest') }}</el-button>
          <el-button link :loading="reconnectingClient === c.name" @click="reconnectMcpClient(c)">{{ t('settings.mcpClientReconnect') }}</el-button>
          <el-button link type="danger" @click="removeMcpClient(c.name)">
            <el-icon><Trash2 :size="'0.875rem'" /></el-icon>
          </el-button>
        </div>
      </div>
    </div>

    <h2 class="section-title">{{ t('settings.mcpClientAdd') }}</h2>
    <div class="settings-group">
      <div class="setting-card">
        <div class="setting-info">
          <div class="setting-title">{{ t('settings.mcpClientName') }}</div>
        </div>
        <div class="setting-control">
          <el-input v-model="mcpClientForm.name" :placeholder="t('settings.mcpClientNamePlaceholder')" style="width: 12rem" />
        </div>
      </div>
      <div class="setting-card">
        <div class="setting-info">
          <div class="setting-title">{{ t('settings.mcpClientTransport') }}</div>
        </div>
        <div class="setting-control">
          <el-select v-model="mcpClientForm.transport" style="width: 10rem">
            <el-option label="stdio" value="stdio" />
            <el-option label="streamable-http" value="streamable-http" />
            <el-option label="sse" value="sse" />
          </el-select>
        </div>
      </div>
      <div class="setting-card" v-if="mcpClientForm.transport === 'stdio'">
        <div class="setting-info">
          <div class="setting-title">{{ t('settings.mcpClientCommand') }}</div>
          <div class="setting-desc">{{ t('settings.mcpClientCommandDesc') }}</div>
        </div>
        <div class="setting-control" style="min-width: 16rem">
          <el-input v-model="mcpClientForm.command" placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp" />
        </div>
      </div>
      <div class="setting-card" v-else>
        <div class="setting-info">
          <div class="setting-title">{{ t('settings.mcpClientUrl') }}</div>
        </div>
        <div class="setting-control" style="min-width: 16rem">
          <el-input v-model="mcpClientForm.url" placeholder="http://127.0.0.1:8080/mcp" />
        </div>
      </div>
      <div class="setting-card">
        <div class="setting-info">
          <div class="setting-title">{{ t('settings.mcpClientHeaders') }}</div>
          <div class="setting-desc">{{ t('settings.mcpClientHeadersDesc') }}</div>
        </div>
        <div class="setting-control" style="min-width: 16rem">
          <el-input v-model="mcpClientForm.headersText" type="textarea" :rows="2" placeholder='{ "Authorization": "Bearer ..." }' />
        </div>
      </div>
      <div class="setting-card">
        <div class="setting-info"></div>
        <div class="setting-control">
          <el-button type="primary" @click="addMcpClient">{{ t('settings.mcpClientAddButton') }}</el-button>
        </div>
      </div>
    </div>
  </div>

  <!-- MCP token setup wizard (one-time token + per-client configs) -->
  <MCPSetupDialog
    v-model:visible="mcpSetupVisible"
    :token="mcpTokenCreated"
    :port="mcpStatus.port || mcpPort"
    @close="onMcpSetupClose"
  />
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { Key, Plug, Trash2 } from '@lucide/vue'
import { msg } from '../../services/message'
import { GenerateMCPToken, RevokeMCPToken, ListMCPTokens, GetMCPStatus, ListMCPClients, SaveMCPClient, RemoveMCPClient, TestMCPClient, MCPClientStatuses, MCPReconnectClient } from '../../../bindings/github.com/ys-ll/uniterm/app'
import { useSettingsStore } from '../../stores/settingsStore'
import { useLocalStateStore } from '../../stores/localStateStore'
import { useI18n } from '../../i18n'
import { ElMessageBox } from 'element-plus'
import { DEFAULT_MCP_SETTINGS } from '../../types/mcp'
import type { MCPStatus } from '../../types/mcp'
import { backendErrorText } from '../../utils/backendError'
import MCPSetupDialog from '../MCPSetupDialog.vue'

defineProps<{ isNarrow: boolean }>()

const settingsStore = useSettingsStore()
const localStateStore = useLocalStateStore()
const { t } = useI18n()

// ── MCP server (external AI agents) ─────────────────────────────
// Config round-trips through localStateStore.state.mcp (Go struct
// store.LocalState.MCP) — per device, never synced; tokens live in
// mcp.json via the app bindings. Token creation opens the setup wizard
// dialog (token + per-client onboarding snippets) instead of expanding
// blocks inline.
const mcp = reactive({ ...DEFAULT_MCP_SETTINGS })
const mcpPort = ref(DEFAULT_MCP_SETTINGS.port || 61207)
const mcpStatus = ref<MCPStatus>({ running: false, port: 0 })
const mcpTokens = ref<string[]>([])
const newTokenName = ref('')
const mcpTokenCreated = ref('')
const mcpSetupVisible = ref(false)

// Mirror persisted settings into the reactive form once loaded.
watch(() => localStateStore.state.mcp, (v) => {
  if (v) {
    Object.assign(mcp, v)
    mcpPort.value = v.port || 61207
  }
}, { immediate: true })

async function refreshMcpState() {
  try { mcpStatus.value = await GetMCPStatus() } catch { mcpStatus.value = { running: false, port: 0 } }
  try { mcpTokens.value = (await ListMCPTokens()) || [] } catch { mcpTokens.value = [] }
}

async function saveMcp() {
  await localStateStore.update({
    mcp: {
      enabled: mcp.enabled,
      port: mcpPort.value,
      policy: mcp.policy,
    },
  })
  refreshMcpState()
}

async function generateToken() {
  const name = newTokenName.value.trim()
  if (!name) { msg.error(t('settings.mcpTokenName')); return }
  try {
    const token = await GenerateMCPToken(name)
    mcpTokenCreated.value = token
    newTokenName.value = ''
    mcpSetupVisible.value = true
    refreshMcpState()
  } catch (e: any) {
    msg.error(backendErrorText(e))
  }
}

// A token's plaintext exists only until the setup dialog closes; the wizard
// cannot be reopened for an old token (hash-only storage) — regenerate it.
function onMcpSetupClose() {
  mcpSetupVisible.value = false
  mcpTokenCreated.value = ''
}

async function revokeToken(name: string) {
  try {
    await ElMessageBox.confirm(
      t('settings.mcpRevokeConfirm', { name }),
      t('settings.mcpRevoke')
    )
  } catch {
    return // user cancelled
  }
  try {
    await RevokeMCPToken(name)
    if (mcpTokens.value.length === 1 && mcpTokens.value[0] === name) mcpTokenCreated.value = ''
    refreshMcpState()
  } catch (e: any) {
    msg.error(backendErrorText(e))
  }
}

// ── MCP client (uniTerm connects to external servers) ──────────
// List persisted in mcp_clients.json via app bindings; live health comes from
// MCPClientStatuses. Separate from the MCP server block above.
interface MCPClientForm {
  name: string
  transport: string
  command: string
  url: string
  headersText: string
  enabled: boolean
}
const mcpClients = ref<any[]>([])
const mcpClientHealth = ref<Record<string, { connected: boolean; tools: number; error: string }>>({})
const mcpClientForm = reactive<MCPClientForm>({
  name: '', transport: 'stdio', command: '', url: '', headersText: '', enabled: true,
})

function mcpClientStatus(name: string) {
  return mcpClientHealth.value[name]
}

async function refreshMcpClients() {
  try {
    mcpClients.value = (await ListMCPClients()) || []
  } catch { mcpClients.value = [] }
  try {
    const statuses = (await MCPClientStatuses()) || []
    const map: Record<string, { connected: boolean; tools: number; error: string }> = {}
    for (const s of statuses) map[s.name] = { connected: s.connected, tools: s.tools, error: s.error || '' }
    mcpClientHealth.value = map
  } catch { /* health optional */ }
}

async function saveMcpClient(c: any) {
  try {
    await SaveMCPClient({ ...c, headers: parseHeaders(c) })
    refreshMcpClients()
  } catch (e: any) {
    msg.error(backendErrorText(e))
  }
}

async function addMcpClient() {
  const headers = parseHeaders(mcpClientForm)
  const tokens = splitCommandLine(mcpClientForm.command)
  const cfg = {
    name: mcpClientForm.name.trim(),
    transport: mcpClientForm.transport,
    command: tokens[0] ?? '',
    args: tokens.slice(1),
    url: mcpClientForm.url.trim(),
    headers,
    enabled: true,
  }
  if (!cfg.name) { msg.error(t('settings.mcpClientName')); return }
  try {
    await SaveMCPClient(cfg)
    mcpClientForm.name = ''; mcpClientForm.command = ''; mcpClientForm.url = ''; mcpClientForm.headersText = ''
    refreshMcpClients()
  } catch (e: any) {
    msg.error(backendErrorText(e))
  }
}

function parseHeaders(src: { headersText?: string; headers?: Record<string,string> }): Record<string, string> {
  const merged: Record<string, string> = {}
  if (src.headers && typeof src.headers === 'object') Object.assign(merged, src.headers)
  const text = (src.headersText || '').trim()
  if (!text) return merged
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'object' && parsed) Object.assign(merged, parsed)
    return merged
  } catch {
    msg.error(t('settings.mcpClientHeadersInvalid'))
    return merged
  }
}

function splitCommandLine(command: string): string[] {
  // Minimal shell-like split: quoted segments preserved. Good enough for the
  // common `npx -y pkg` form; full shell parsing stays out of scope here.
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(command)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

async function testMcpClient(c: any) {
  try {
    const tools = await TestMCPClient({ ...c, headers: parseHeaders(c) })
    msg.success(t('settings.mcpClientTestOk', { name: c.name, tools: tools.length }))
    refreshMcpClients()
  } catch (e: any) {
    msg.error(backendErrorText(e))
  }
}

// reconnectingClient 记录正在重连的服务器名称，用于按钮 loading 状态。
const reconnectingClient = ref<string | null>(null)

// reconnectMcpClient 手动重连指定的 MCP 客户端服务器。当 SSE / streamable-http
// 长连接断开后，用户可点击"重连"按钮主动恢复连接，无需等待下一次工具调用
// 才触发自动重连。重连成功后刷新健康状态。
async function reconnectMcpClient(c: any) {
  reconnectingClient.value = c.name
  try {
    await MCPReconnectClient(c.name)
    await refreshMcpClients()
    const status = mcpClientStatus(c.name)
    msg.success(t('settings.mcpClientReconnectOk', { name: c.name, tools: status?.tools ?? 0 }))
  } catch (e: any) {
    msg.error(`${t('settings.mcpClientReconnectFailed')}: ${backendErrorText(e)}`)
  } finally {
    reconnectingClient.value = null
  }
}

async function removeMcpClient(name: string) {
  try {
    await ElMessageBox.confirm(t('settings.mcpClientRemoveConfirm', { name }), t('settings.mcpClientRemove'))
  } catch { return }
  try {
    await RemoveMCPClient(name)
    refreshMcpClients()
  } catch (e: any) {
    msg.error(backendErrorText(e))
  }
}

onMounted(() => {
  refreshMcpState()
  refreshMcpClients()
})
</script>

<style scoped>
@import './_shared.css';

/* Model cards (reused for MCP tokens/clients) */
.model-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1.125rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  transition: all 0.12s ease;
}

.model-card:hover {
  border-color: var(--border-hover);
}

.model-main {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  flex: 1;
  min-width: 0;
}

.model-name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}

.model-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

/* MCP settings */
.mcp-running {
  color: var(--el-color-success);
  font-family: var(--font-mono);
}
.mcp-running.mcp-error {
  color: var(--el-color-danger);
}
.mcp-token-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.mcp-token-icon {
  margin-right: 0.5rem;
  color: var(--text-muted);
}

/* Token cards reuse .model-main (column layout for AI models); force the
   icon and name onto one row. */
.mcp-token-main {
  flex-direction: row;
  align-items: center;
}
</style>