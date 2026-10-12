<template>
  <div class="mcp-server-settings">
    <p class="section-desc">{{ t('settings.mcpDesc') }}</p>

    <!-- 添加 / 编辑表单 -->
    <el-form label-position="top" size="small" class="mcp-form">
      <el-form-item :label="t('mcp.serverName')">
        <el-input v-model="form.name" :placeholder="t('mcp.serverNamePlaceholder')" />
      </el-form-item>
      <el-form-item :label="t('mcp.command')">
        <el-input v-model="form.command" :placeholder="t('mcp.commandPlaceholder')" />
      </el-form-item>
      <el-form-item :label="t('mcp.args')">
        <el-input v-model="form.argsStr" :placeholder="t('mcp.argsPlaceholder')" />
      </el-form-item>
      <el-form-item :label="t('mcp.env')">
        <el-input
          v-model="form.envStr"
          type="textarea"
          :rows="3"
          :placeholder="t('mcp.envPlaceholder')"
        />
      </el-form-item>
      <div class="mcp-form-actions">
        <el-button type="primary" :disabled="!form.name.trim() || !form.command.trim()" @click="onSave">
          {{ editing ? t('common.save') : t('mcp.add') }}
        </el-button>
        <el-button v-if="editing" @click="onCancelEdit">{{ t('common.cancel') }}</el-button>
      </div>
    </el-form>

    <!-- Server 列表 -->
    <el-table :data="servers" size="small" style="margin-top: 16px">
      <el-table-column prop="name" :label="t('mcp.serverName')" width="160" />
      <el-table-column prop="command" :label="t('mcp.command')" />
      <el-table-column :label="t('mcp.statusCol')" width="100">
        <template #default="{ row }">
          <el-tag :type="connectedNames.has(row.name) ? 'success' : 'info'" size="small">
            {{ connectedNames.has(row.name) ? t('mcp.connected') : t('mcp.disconnected') }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('mcp.toolsCol')" width="80">
        <template #default="{ row }">
          {{ toolCounts[row.name] ?? 0 }}
        </template>
      </el-table-column>
      <el-table-column :label="t('common.actions')" width="240">
        <template #default="{ row }">
          <el-button
            v-if="!connectedNames.has(row.name)"
            size="small"
            type="primary"
            :loading="connectingName === row.name"
            @click="onConnect(row)"
          >{{ t('mcp.connect') }}</el-button>
          <el-button
            v-else
            size="small"
            :loading="connectingName === row.name"
            @click="onDisconnect(row)"
          >{{ t('mcp.disconnect') }}</el-button>
          <el-button size="small" @click="onEdit(row)">{{ t('common.edit') }}</el-button>
          <el-button size="small" type="danger" @click="onRemove(row)">{{ t('common.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useI18n } from '../i18n'
import { msg } from '../services/message'
import { backendErrorText } from '../utils/backendError'
import { startServer, stopServer, listServers, listTools, type MCPServerConfig } from '../services/mcp/client'
import { registerMCPTools, unregisterMCPTools } from '../services/mcp/registry'

const { t } = useI18n()

/** 持久化的 server 配置（保存到 localStorage）。 */
interface SavedServer extends MCPServerConfig {
  argsStr: string
  envStr: string
}

const STORAGE_KEY = 'aiops.mcpServers'

const servers = ref<SavedServer[]>([])
const connectedNames = ref<Set<string>>(new Set())
const toolCounts = ref<Record<string, number>>({})
const connectingName = ref<string | null>(null)
const editing = ref(false)
const editingIndex = ref(-1)

const form = reactive({
  name: '',
  command: '',
  argsStr: '',
  envStr: '',
})

/** 从 localStorage 加载已保存的 server 配置。 */
function loadSaved(): SavedServer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s: any) => s && typeof s.name === 'string' && typeof s.command === 'string')
  } catch {
    return []
  }
}

/** 保存 server 配置到 localStorage。 */
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers.value))
  } catch {
    // ignore quota errors
  }
}

/** 解析逗号分隔的参数字符串为 string[]。 */
function parseArgs(s: string): string[] {
  if (!s.trim()) return []
  // 简单逗号分隔；不支持引号转义（MCP server 参数通常简单）。
  return s.split(',').map(a => a.trim()).filter(Boolean)
}

/** 解析 KEY=VALUE 每行一个的环境变量字符串为 Record。 */
function parseEnv(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!s.trim()) return out
  for (const line of s.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (key) out[key] = val
  }
  return out
}

function resetForm() {
  form.name = ''
  form.command = ''
  form.argsStr = ''
  form.envStr = ''
  editing.value = false
  editingIndex.value = -1
}

function onSave() {
  const name = form.name.trim()
  const command = form.command.trim()
  if (!name || !command) return

  // 检查名称冲突（编辑时排除自身）。
  const dupIdx = servers.value.findIndex(s => s.name === name)
  if (editing.value) {
    if (dupIdx >= 0 && dupIdx !== editingIndex.value) {
      msg.error(t('mcp.nameExists'))
      return
    }
    servers.value[editingIndex.value] = { ...form, name, command }
  } else {
    if (dupIdx >= 0) {
      msg.error(t('mcp.nameExists'))
      return
    }
    servers.value.push({ ...form, name, command })
  }
  persist()
  resetForm()
}

function onEdit(row: SavedServer) {
  editing.value = true
  editingIndex.value = servers.value.findIndex(s => s.name === row.name)
  form.name = row.name
  form.command = row.command
  form.argsStr = row.argsStr ?? ''
  form.envStr = row.envStr ?? ''
}

function onCancelEdit() {
  resetForm()
}

async function onRemove(row: SavedServer) {
  try {
    await ElMessageBox.confirm(t('mcp.confirmDelete'), t('common.delete'), { type: 'warning' })
  } catch {
    return
  }
  // 先断开
  if (connectedNames.value.has(row.name)) {
    try {
      await stopServer(row.name)
    } catch {
      // ignore
    }
    unregisterMCPTools(row.name)
    connectedNames.value = new Set([...connectedNames.value].filter(n => n !== row.name))
    delete toolCounts.value[row.name]
  }
  servers.value = servers.value.filter(s => s.name !== row.name)
  persist()
}

async function onConnect(row: SavedServer) {
  connectingName.value = row.name
  try {
    await startServer({
      name: row.name,
      command: row.command,
      args: parseArgs(row.argsStr ?? ''),
      env: parseEnv(row.envStr ?? ''),
    })
    // 连接成功后列出工具并注册
    try {
      const tools = await listTools(row.name)
      registerMCPTools(row.name, tools)
      toolCounts.value = { ...toolCounts.value, [row.name]: tools.length }
    } catch (e: any) {
      // 工具列表失败不致命：server 已连，工具数为 0
      msg.warning(`${t('mcp.listToolsFailed')}: ${backendErrorText(e)}`)
      toolCounts.value = { ...toolCounts.value, [row.name]: 0 }
    }
    connectedNames.value = new Set([...connectedNames.value, row.name])
    msg.success(t('mcp.connected'))
  } catch (e: any) {
    msg.error(`${t('mcp.connectFailed')}: ${backendErrorText(e)}`)
  } finally {
    connectingName.value = null
  }
}

async function onDisconnect(row: SavedServer) {
  connectingName.value = row.name
  try {
    await stopServer(row.name)
    unregisterMCPTools(row.name)
    connectedNames.value = new Set([...connectedNames.value].filter(n => n !== row.name))
    delete toolCounts.value[row.name]
    msg.success(t('mcp.disconnected'))
  } catch (e: any) {
    msg.error(`${t('mcp.disconnectFailed')}: ${backendErrorText(e)}`)
  } finally {
    connectingName.value = null
  }
}

/** 刷新已连接 server 列表（启动时与后端同步）。 */
async function refreshConnected() {
  try {
    const names = await listServers()
    connectedNames.value = new Set(names)
    // 对每个已连接的 server 重新拉取工具数
    for (const name of names) {
      try {
        const tools = await listTools(name)
        registerMCPTools(name, tools)
        toolCounts.value = { ...toolCounts.value, [name]: tools.length }
      } catch {
        // server 可能刚断开
      }
    }
  } catch {
    // 后端未就绪
  }
}

onMounted(async () => {
  servers.value = loadSaved()
  await refreshConnected()
})
</script>

<style scoped>
.mcp-server-settings {
  max-width: 900px;
}
.mcp-form {
  margin-top: 12px;
  padding: 16px;
  background: var(--el-bg-color-page, #1a1a1a);
  border-radius: 6px;
}
.mcp-form-actions {
  display: flex;
  gap: 8px;
}
.section-desc {
  color: var(--el-text-color-secondary, #999);
  margin-bottom: 12px;
}
</style>