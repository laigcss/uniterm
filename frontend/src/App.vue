<template>
  <el-config-provider :locale="elLocale">
  <div class="app-container" :class="{ 'has-bg': bgVisible }">
    <div v-if="bgVisible" class="app-bg" :style="bgStyle"></div>
    <AppHeader
      @toggle-ai="aiStore.toggle"
      @toggle-sidebar="sidebarVisible = !sidebarVisible"
      @open-settings="openSettings"
      @open-netscan="openNetscan"
      @open-local-services="openLocalServices"
      @close-tab="closeTab"
      @close-tab-batch="closeTabBatch"
      @toggle-ai-lock="onToggleAiLock"
      @tab-dragstart="onTabDragStart"
      @new-local-terminal="createNewTab"
    />
    <div class="main-content">
      <Sidebar ref="sidebarRef" :visible="sidebarVisible" @toggle="sidebarVisible = !sidebarVisible" @connect="onSidebarConnect" @connect-to-workspace="({ config, workspaceId }: any) => onConnect(config, undefined, undefined, true, workspaceId)" @create-workspace="(configs: any) => onCreateWorkspaceFromConfigs(configs)" @connect-only="onConnectOnly" @open-netscan="openNetscan" />
      <div class="tab-area">
        <template v-if="activeTab">
          <KeepAlive>
            <TerminalTabContent
              v-if="activeTab.type === 'terminal'"
              :key="activeTab?.id"
              :tab="activeTab"
              @close="closeTab"
            />
            <SettingsTabContent
              v-else-if="activeTab.type === 'settings'"
            />
            <WorkspaceContent
              v-else-if="activeTab.type === 'workspace'"
              :tab="activeTab"
            />
            <FileTabContent
              v-else-if="activeTab.type === 'sftp'"
              :key="activeTab?.id"
              :panel-id="activeTab.panelId"
            />
            <RDPTabContent
              v-else-if="activeTab.type === 'rdp'"
              :key="activeTab?.id"
              :panel-id="activeTab.panelId"
              :config="getPanelConfig(activeTab.panelId)"
              :session-id="getPanelSessionId(activeTab.panelId)"
            />
            <VNCTabContent
              v-else-if="activeTab.type === 'vnc'"
              :key="activeTab?.id"
              :panel-id="activeTab.panelId"
              :config="getPanelConfig(activeTab.panelId)"
              :session-id="getPanelSessionId(activeTab.panelId)"
            />
            <SPICETabContent
              v-else-if="activeTab.type === 'spice'"
              :key="activeTab?.id"
              :panel-id="activeTab.panelId"
              :config="getPanelConfig(activeTab.panelId)"
              :session-id="getPanelSessionId(activeTab.panelId)"
            />
            <X11DesktopTabContent
              v-else-if="activeTab.type === 'x11-desktop'"
              :key="activeTab?.id"
              :panel-id="activeTab.panelId"
              :config="getPanelConfig(activeTab.panelId)"
              :session-id="getPanelSessionId(activeTab.panelId)"
            />
            <DBTabContent
              v-else-if="activeTab.type === 'database'"
              :key="activeTab?.id"
              :session-id="getPanelSessionId(activeTab.panelId) || ''"
              :host-name="getPanelConfig(activeTab.panelId)?.host || ''"
              :default-db-name="getPanelConfig(activeTab.panelId)?.dbName"
              :db-type="getPanelConfig(activeTab.panelId)?.dbType || ''"
            />
            <RedisTabContent
              v-else-if="activeTab.type === 'redis'"
              :key="activeTab?.id"
              :session-id="getPanelSessionId(activeTab.panelId) || ''"
              :key-separator="getPanelConfig(activeTab.panelId)?.redisKeySeparator ?? ''"
            />
            <MongoDBTabContent
              v-else-if="activeTab.type === 'mongodb'"
              :key="activeTab?.id"
              :session-id="getPanelSessionId(activeTab.panelId) || ''"
            />
            <ElasticsearchTabContent
              v-else-if="activeTab.type === 'elasticsearch'"
              :key="activeTab?.id"
              :session-id="getPanelSessionId(activeTab.panelId) || ''"
            />
            <MonitorTabContent
              v-else-if="activeTab.type === 'monitor'"
              :key="activeTab?.id"
              :session-id="getPanelSessionId(activeTab.panelId) || ''"
            />
            <K8sTabContent
              v-else-if="activeTab.type === 'k8s'"
              :key="activeTab?.id"
              :tab="activeTab"
              :connection="k8sConnectionForTab(activeTab)"
            />
            <ContainerTabContent
              v-else-if="activeTab.type === 'container'"
              :key="activeTab?.id"
              :tab="activeTab"
            />
            <StartTabContent
              v-else-if="activeTab.type === 'start'"
              :key="activeTab?.id"
              :tab="activeTab"
              @connect="onConnect"
              @connect-to-workspace="({ configs, workspaceId }: any) => { for (const c of configs) onConnect(c, undefined, undefined, true, workspaceId) }"
              @create-workspace="(configs: any) => onCreateWorkspaceFromConfigs(configs)"
              @new-workspace="onNewWorkspace"
              @new-connection="onNewConnectionFromStart"
              @local-terminal="createLocalTerminalWithShell"
              @close-self="(tabId: string) => closeTab(tabId)"
              @edit-connection="onEditConnection"
              @change-group="onChangeGroupFromStart"
              @change-group-ids="onChangeGroupFromStartIds"
              @change-group-parent="onChangeGroupParentFromStart"
            />
          </KeepAlive>
        </template>
      </div>
      <AISidebar ref="aiSidebarRef" @open-settings="openSettings" />
    </div>
    <ConnectionForm v-model="showConnectionForm" :edit-config="editConfig ?? undefined" :default-group-id="pendingGroupId" @save="onSaveOnly" @connect="(c: ConnectionConfig, ko?: boolean) => { const wasEdit = !!editConfig?.id; editConfig = null; onConnect(c, ko, wasEdit) }" @connect-only="onConnectOnly" @cancel="editConfig = null" />

    <CredentialPrompt
      v-model:visible="credentialVisible"
      :title="credentialTitle"
      :subtitle="credentialSubtitle"
      :fields="credentialFields"
      :initial-user="credentialInitialUser"
      :initial-password="credentialInitialPassword"
      @resolve="onCredentialResolve"
    />

    <Menu ref="inputMenuRef" v-model:visible="inputMenuVisible">
      <MenuItem v-if="!inputMenuReadonly" @click="inputMenuCut">{{ t('input.cut') }}</MenuItem>
      <MenuItem @click="inputMenuCopy">{{ t('input.copy') }}</MenuItem>
      <MenuItem v-if="!inputMenuReadonly" @click="inputMenuPaste">{{ t('input.paste') }}</MenuItem>
      <MenuItem @click="inputMenuSelectAll">{{ t('input.selectAll') }}</MenuItem>
    </Menu>

    <MCPApprovalDialog
      v-model:visible="mcpApprovalVisible"
      :request="mcpApprovalRequest"
      @resolve="onMcpApprovalResolve"
    />

    <SyncConflictDialog />
    <UpdateDialog />
    <WorkspaceSaveDialog />
    <DataDirDialog v-model:visible="dataDirVisible" :first-run="credStore.firstRun || credStore.dataDirInfo.firstRun" @done="onDataDirDone" />
    <EncryptionModeDialog v-model:visible="encryptVisible" :existing-secrets="credStore.status.existingSecrets" @done="onEncryptDone" />
    <CredentialUnlockDialog v-model:visible="unlockVisible" @done="onUnlockDone" @reset="onReset" />
    <MobileKeyBar v-if="keyBarSessionId" :key="keyBarSessionId" :session-id="keyBarSessionId" />
    <NetworkScanTabContent v-model:visible="netscanVisible" @new-connection="onNetscanNewConnection" />
    <LocalServices v-model:visible="localServicesVisible" />
  </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, provide } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import zhTw from 'element-plus/es/locale/lang/zh-tw'
import enUs from 'element-plus/es/locale/lang/en'
import ja from 'element-plus/es/locale/lang/ja'
import ko from 'element-plus/es/locale/lang/ko'
import de from 'element-plus/es/locale/lang/de'
import es from 'element-plus/es/locale/lang/es'
import fr from 'element-plus/es/locale/lang/fr'
import ru from 'element-plus/es/locale/lang/ru'
import AppHeader from './components/AppHeader.vue'
import Sidebar from './components/Sidebar.vue'
import TerminalTabContent from './components/TerminalTabContent.vue'
import MobileKeyBar from './components/MobileKeyBar.vue'
import SettingsTabContent from './components/SettingsTabContent.vue'
import NetworkScanTabContent from './components/netscan/NetworkScanTabContent.vue'
import LocalServices from './components/localsrv/LocalServices.vue'
import WorkspaceContent from './components/WorkspaceContent.vue'
import FileTabContent from './components/FileTabContent.vue'
import RDPTabContent from './components/RDPTabContent.vue'
import VNCTabContent from './components/VNCTabContent.vue'
import SPICETabContent from './components/SPICETabContent.vue'
import X11DesktopTabContent from './components/X11DesktopTabContent.vue'
import DBTabContent from './components/DBTabContent.vue'
import RedisTabContent from './components/RedisTabContent.vue'
import MongoDBTabContent from './components/MongoDBTabContent.vue'
import ElasticsearchTabContent from './components/ElasticsearchTabContent.vue'
import MonitorTabContent from './components/MonitorTabContent.vue'
import K8sTabContent from './components/K8sTabContent.vue'
import ContainerTabContent from './components/ContainerTabContent.vue'
import StartTabContent from './components/StartTabContent.vue'
import ConnectionForm from './components/ConnectionForm.vue'
import AISidebar from './components/AISidebar.vue'
import SyncConflictDialog from './components/SyncConflictDialog.vue'
import WorkspaceSaveDialog from './components/WorkspaceSaveDialog.vue'
import UpdateDialog from './components/UpdateDialog.vue'
import DataDirDialog from './components/DataDirDialog.vue'
import EncryptionModeDialog from './components/EncryptionModeDialog.vue'
import CredentialUnlockDialog from './components/CredentialUnlockDialog.vue'
import CredentialPrompt from './components/CredentialPrompt.vue'
import MCPApprovalDialog from './components/MCPApprovalDialog.vue'
import Menu from './components/Menu.vue'
import MenuItem from './components/MenuItem.vue'
import { useAIStore } from './stores/aiStore'
import { useTabStore } from './stores/tabStore'
import { usePanelStore } from './stores/panelStore'
import { useI18n } from './i18n'
import { useRdpEmbedding } from './composables/useRdpEmbedding'
import { useDuplicateSession } from './composables/useDuplicateSession'
import { useTunnelCredentials } from './composables/useTunnelCredentials'
import { useCredentials } from './composables/useCredentials'
import { useAppBackground } from './composables/useAppBackground'
import { useMobileKeyBar } from './composables/useMobileKeyBar'
import { useMcpApproval } from './composables/useMcpApproval'
import { useContextMenu } from './composables/useContextMenu'
import { useKeybindings } from './composables/useKeybindings'
import { useTabManager } from './composables/useTabManager'
import { useConnectionManager } from './composables/useConnectionManager'
import { useAppDialogs } from './composables/useAppDialogs'
import { useAppLifecycle } from './composables/useAppLifecycle'
import { useAppWatchers } from './composables/useAppWatchers'
import type { ConnectionConfig } from './types/session'

// ── Stores (only those referenced directly in template) ──
const aiStore = useAIStore()
const tabStore = useTabStore()
const panelStore = usePanelStore()
const activeTab = computed(() => tabStore.activeTab)

// ── RDP ActiveX embedding ──
const rdpEmbedding = useRdpEmbedding({ activeTab: activeTab as any, panelStore: panelStore as any })

// ── i18n / Element Plus locale ──
const { t, locale } = useI18n()
const EL_LOCALE_MAP: Record<string, typeof enUs> = {
  'zh-CN': zhCn, 'zh-TW': zhTw, en: enUs, ja, ko, de, es, fr, ru,
}
const elLocale = computed(() => EL_LOCALE_MAP[locale.value] || enUs)

// ── Template refs / sidebar state ──
const sidebarVisible = ref(false)
const sidebarRef = ref<any>(null)
const aiSidebarRef = ref<any>(null)

// ── Background image ──
const { bgVisible, bgStyle, loadBackgroundImage } = useAppBackground()

// ── Mobile key bar + Android keep-alive ──
const mobileKeyBar = useMobileKeyBar()
const { keyBarSessionId } = mobileKeyBar

// ── Credentials (prompt dialog + first-run/encrypt/unlock flow) ──
const cred = useCredentials()
const {
  credStore,
  credentialVisible, credentialTitle, credentialSubtitle, credentialFields,
  credentialInitialUser, credentialInitialPassword,
  showCredentialDialog, onCredentialResolve,
  dataDirVisible, encryptVisible, unlockVisible,
  onDataDirDone, onEncryptDone, onUnlockDone, onReset,
} = cred
provide('showCredentialDialog', showCredentialDialog)

// App.vue's resolveCredentialDialog differs from useCredentials' internal one:
// it checks existingSecrets and doesn't handle keychainLost.
function resolveCredentialDialog() {
  const st = credStore.status
  if (st.needsSetup && !st.existingSecrets) { encryptVisible.value = true; return }
  if (!st.unlocked) { unlockVisible.value = true }
}
async function checkCredentials() {
  credStore.watchEvents()
  await credStore.loadDataDir()
  await credStore.loadStatus()
  if (!credStore.backendAvailable) {
    console.warn('[uniTerm] Backend unreachable — browser debug mode: credential flow skipped')
    return
  }
  if (credStore.firstRun || credStore.dataDirInfo.firstRun) {
    dataDirVisible.value = true
    return
  }
  resolveCredentialDialog()
}

// ── Credential ensure (unified via useTunnelCredentials) ──
const { ensureConnectionCredentials: ensureCredentials } = useTunnelCredentials(showCredentialDialog)

// ── Input context menu ──
const contextMenu = useContextMenu()
const {
  inputMenuVisible, inputMenuReadonly, inputMenuRef,
  inputMenuCut, inputMenuCopy, inputMenuPaste, inputMenuSelectAll,
} = contextMenu

// ── MCP approval dialog ──
const mcpApproval = useMcpApproval()
const { mcpApprovalVisible, mcpApprovalRequest, onMcpApprovalResolve } = mcpApproval

// ── Connection manager (connect / create / reconnect / form state) ──
const conn = useConnectionManager({ ensureCredentials })
const {
  showConnectionForm, editConfig, pendingGroupId,
  onConnect, onConnectOnly, onSidebarConnect, onSaveOnly,
  onCreateWorkspaceFromConfigs, onNewWorkspace,
  createLocalTerminalWithShell,
  onNetscanNewConnection, onNewConnectionFromStart, onEditConnection,
} = conn

// ── Tab manager (close / create / panel helpers) ──
const tabMgr = useTabManager({ rdpEmbedding, createLocalTerminalWithShell })
const {
  createNewTab, closeTab, closeTabBatch, onTabDragStart,
  getPanelConfig, getPanelSessionId, k8sConnectionForTab,
} = tabMgr

// ── Dialogs (settings / netscan / local services / group actions) ──
const dialogs = useAppDialogs({ sidebarRef })
const {
  netscanVisible, localServicesVisible,
  openSettings, openNetscan, openLocalServices,
  onChangeGroupFromStart, onChangeGroupFromStartIds, onChangeGroupParentFromStart,
  onToggleAiLock,
} = dialogs

// ── Keybindings (shortcuts + font zoom + platform keys) ──
const { duplicateSession } = useDuplicateSession()
const keybindings = useKeybindings({
  sidebarVisible, sidebarRef, aiSidebarRef,
  closeTab, createNewTab, openSettings, duplicateSession, onToggleAiLock,
})

// ── Lifecycle (onMounted init / onUnmounted dispose) ──
const lifecycle = useAppLifecycle({
  sidebarVisible, mobileKeyBar, contextMenu, mcpApproval, keybindings, rdpEmbedding,
  connectionManager: conn, dialogs, checkCredentials, loadBackgroundImage,
})

// ── Watchers (tab switch / sidebar / keyboard / background) ──
useAppWatchers({
  activeTab, showConnectionForm, sidebarVisible, rdpEmbedding,
  applyKeybindings: keybindings.applyKeybindings, loadBackgroundImage,
})

// ── Vue lifecycle hooks ──
onMounted(() => lifecycle.init())
onUnmounted(() => lifecycle.dispose())
</script><style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  border: 1px solid var(--border-subtle);
  position: relative;
}
.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 0;
  position: relative;
  z-index: 1;
}

.tab-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-base);
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.group-list .group-item {
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius-sm);
  transition: background .15s;
}
.group-list .group-item:hover {
  background: var(--bg-hover);
}

.app-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-color: transparent;
}
.app-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--bg-base);
  opacity: var(--bg-mask-opacity, 0.6);
}
.app-container.has-bg .main-content,
.app-container.has-bg .main-content :deep(*:not(:where(.xterm-cursor, [class*="xterm-bg-"], .xterm-selection, .xterm-selection *, .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground, .el-progress-bar__inner, .perf-nav-bar-inner))),
.app-container.has-bg .app-header,
.app-container.has-bg :deep(.app-header *) {
  background-color: transparent !important;
}
/* 排除 xterm 自身着色的单元格与选区层：否则通配透明规则会抹掉 vim 可视模式
   (Ctrl-V/Shift-V)、ls 配色、鼠标选区等由终端渲染的背景色。
   用 :where() 包住，避免 :not 提升特异性把下面对话框/下拉/开关/滑杆
   的不透明例外规则压过去。 */
/* 开背景时 AI 输入(IN)标签底色被抹透明，深色文字会糊在图上；
   改用与输出(OUT)标签一致的白字，保证在背景图上清晰可读 */
.app-container.has-bg .main-content :deep(.in-box .tool-box-label) {
  color: var(--on-accent) !important;
}
/* 标签栏毛玻璃 */
.app-container.has-bg :deep(.app-header) {
  backdrop-filter: blur(0.5rem);
}
/* 对话框、下拉/右键菜单保持不透明背景（覆盖全局 * 透明规则）*/
.app-container.has-bg .main-content :deep(.el-dialog),
.app-container.has-bg .main-content :deep(.el-message-box),
.app-container.has-bg .main-content :deep(.el-select-dropdown),
.app-container.has-bg .main-content :deep(.conn-context-menu),
.app-container.has-bg .main-content :deep(.hash-dropdown),
.app-container.has-bg .main-content :deep(.skill-dropdown) {
  background-color: var(--bg-surface) !important;
}
/* CodeMirror 选区：覆盖 has-bg 通配透明，保证 SQL/语法编辑器选中可见 */
.app-container.has-bg .main-content :deep(.cm-selectionBackground),
.app-container.has-bg .main-content :deep(.cm-focused .cm-selectionBackground) {
  background-color: rgba(64, 158, 255, 0.45) !important;
}
/* Teleport 到 body 的菜单不在 .main-content 内，单独强制不透明 */
body > .conn-context-menu {
  background-color: var(--bg-surface) !important;
  opacity: 1 !important;
  backdrop-filter: none !important;
}
/* 设置左侧选中分类：保留强调色高亮（* 规则会清掉）*/
.app-container.has-bg .main-content :deep(.settings-category.active) {
  background-color: var(--accent-subtle) !important;
}
.app-container.has-bg .main-content :deep(.el-switch__core) {
  background-color: var(--bg-hover) !important;
}
.app-container.has-bg .main-content :deep(.el-switch.is-checked .el-switch__core) {
  background-color: var(--accent) !important;
}
.app-container.has-bg .main-content :deep(.el-switch__core .el-switch__action) {
  background-color: #ffffff !important;
}
.app-container.has-bg .main-content :deep(.el-slider__runway) {
  background-color: var(--bg-hover) !important;
}
.app-container.has-bg .main-content :deep(.el-slider__bar) {
  background-color: var(--accent) !important;
}
.app-container.has-bg .main-content :deep(.el-slider__button) {
  background-color: #ffffff !important;
}
/* 进度条/传输面板：背景图下保持可见（通配透明会把 el-progress 轨道和
   传输面板容器一并抹掉，只剩淡灰小字浮在背景上）。填充色(.el-progress-bar__inner)
   按状态着色，不能一刀切，已在上方 :where 排除列表里整体豁免 */
.app-container.has-bg .main-content :deep(.transfer-panel),
.app-container.has-bg .main-content :deep(.transfer-progress-bar),
.app-container.has-bg .main-content :deep(.el-progress-bar__outer) {
  background-color: var(--bg-elevated) !important;
}
.app-container.has-bg .main-content :deep(.zmodem-transfer-panel) {
  background-color: var(--bg-surface) !important;
}
.app-container.has-bg .main-content :deep(.zmodem-transfer-panel .progress-bar) {
  background-color: var(--bg-hover) !important;
}
.app-container.has-bg .main-content :deep(.zmodem-transfer-panel .progress-fill) {
  background-color: var(--accent) !important;
}
/* K8s 总览用量条：轨道底色是 color-mix、填充按 ok/warn/danger 着色，
   不能一刀切，逐级恢复 */
.app-container.has-bg .main-content :deep(.ov-meter.m-ok) {
  background-color: color-mix(in srgb, var(--el-color-primary) 16%, var(--bg-elevated)) !important;
}
.app-container.has-bg .main-content :deep(.ov-meter.m-warn) {
  background-color: color-mix(in srgb, var(--warning) 16%, var(--bg-elevated)) !important;
}
.app-container.has-bg .main-content :deep(.ov-meter.m-danger) {
  background-color: color-mix(in srgb, var(--el-color-danger) 16%, var(--bg-elevated)) !important;
}
.app-container.has-bg .main-content :deep(.ov-meter-fill.ok) {
  background-color: var(--el-color-primary) !important;
}
.app-container.has-bg .main-content :deep(.ov-meter-fill.warn) {
  background-color: var(--warning) !important;
}
.app-container.has-bg .main-content :deep(.ov-meter-fill.danger) {
  background-color: var(--el-color-danger) !important;
}
/* 容器镜像页拉取/推送进度条 */
.app-container.has-bg .main-content :deep(.task-bar) {
  background-color: var(--bg-hover) !important;
}
.app-container.has-bg .main-content :deep(.task-bar-fill) {
  background-color: var(--accent) !important;
}
/* K8s 总览：可点行 hover（纯毛玻璃，不改底色）与 pod 状态点着色 */
.app-container.has-bg .main-content :deep(.ov-clickable:hover) {
  backdrop-filter: blur(0.875rem);
}
.app-container.has-bg .main-content :deep(.state-dot) {
  background-color: var(--text-muted) !important;
}
.app-container.has-bg .main-content :deep(.state-dot[data-state='running']) {
  background-color: var(--el-color-success) !important;
}
.app-container.has-bg .main-content :deep(.state-dot[data-state='pending']) {
  background-color: var(--warning) !important;
}
.app-container.has-bg .main-content :deep(.state-dot[data-state='failed']) {
  background-color: var(--el-color-danger) !important;
}
/* 树形结构选中项（K8s / 容器 / 数据库 / Mongo）：纯毛玻璃高亮，
   否则背景图下看不出选中了哪一项 */
.app-container.has-bg .main-content :deep(.table-item.selected),
.app-container.has-bg .main-content :deep(.db-header.selected) {
  backdrop-filter: blur(0.875rem);
}
/* 监控-性能左侧导航选中项 */
.app-container.has-bg .main-content :deep(.perf-nav-item.active) {
  backdrop-filter: blur(0.875rem);
}
/* 监控-性能：CPU/磁盘等展开行的百分比条与左侧导航迷你条
   （.perf-nav-bar-inner 的颜色是行内样式，已在上方 :where 排除）*/
.app-container.has-bg .main-content :deep(.sub-bar),
.app-container.has-bg .main-content :deep(.perf-nav-bar) {
  background-color: var(--bg-hover) !important;
}
.app-container.has-bg .main-content :deep(.sub-fill) {
  background: linear-gradient(90deg, var(--accent), var(--accent-glow)) !important;
}
/* 监控边栏：CPU/内存/磁盘百分比条（填充是各资源专属渐变，逐个恢复）*/
.app-container.has-bg .main-content :deep(.mem-bar),
.app-container.has-bg .main-content :deep(.detail-bar) {
  background-color: var(--bg-hover) !important;
}
.app-container.has-bg .main-content :deep(.mem-fill.cpu) {
  background: linear-gradient(90deg, #6366f1, #818cf8) !important;
}
.app-container.has-bg .main-content :deep(.mem-fill.phys) {
  background: linear-gradient(90deg, #3b82f6, #60a5fa) !important;
}
.app-container.has-bg .main-content :deep(.mem-fill.swap) {
  background: linear-gradient(90deg, #14b8a6, #2dd4bf) !important;
}
.app-container.has-bg .main-content :deep(.mem-fill.disk) {
  background: linear-gradient(90deg, #8b5cf6, #a78bfa) !important;
}
.app-container.has-bg .main-content :deep(.detail-fill) {
  background: linear-gradient(90deg, var(--accent), var(--accent-glow)) !important;
}
/* 开背景时，开始页「新建连接」主按钮改用普通按钮样式（透明+blur 与其它按钮一致），
   仅修正文字/边框颜色，避免深色文字糊在图上 */
.app-container.has-bg .main-content :deep(.start-action-btn.primary) {
  border-color: var(--border-subtle) !important;
  color: var(--text-secondary) !important;
}
/* 恢复终端选区高亮（全局透明规则会清掉 xterm 内联选区色）*/
.app-container.has-bg .main-content :deep(.xterm-selection div) {
  background-color: rgba(120, 150, 200, 0.4) !important;
}
/* 终端滚动条（xterm v6 自绘 div）在 style.css 里统一处理：轨道本身已是透明，
   开背景图时无需再开例外。 */
/* el-table（el-scrollbar）横/纵滚动条：滑块是 div，被全局 * 透明规则抹掉了，
   这里恢复半透明滑块，背景图下仍可见。 */
.app-container.has-bg .main-content :deep(.el-scrollbar__thumb) {
  background-color: var(--scrollbar-thumb) !important;
}
/* 表格 body 若走原生滚动条也一并恢复 */
.app-container.has-bg .main-content :deep(.el-table__body-wrapper::-webkit-scrollbar-thumb),
.app-container.has-bg .main-content :deep(.el-scrollbar__wrap::-webkit-scrollbar-thumb) {
  background: var(--scrollbar-thumb) !important;
}
/* 边栏毛玻璃 */
.app-container.has-bg .main-content :deep(.sidebar),
.app-container.has-bg .main-content :deep(.ai-sidebar),
.app-container.has-bg .main-content :deep(.companion-sidebar) {
  backdrop-filter: blur(0.5rem);
}
/* 开始页卡片、按钮毛玻璃 */
.app-container.has-bg .main-content :deep(.start-card),
.app-container.has-bg .main-content :deep(.start-action-btn),
.app-container.has-bg .main-content :deep(.start-action-btn-dropdown-arrow) {
  backdrop-filter: blur(0.5rem);
}
/* 各类输入框毛玻璃 */
.app-container.has-bg .main-content :deep(.el-input__wrapper),
.app-container.has-bg .main-content :deep(.el-textarea__inner),
.app-container.has-bg .main-content :deep(.el-input-number),
.app-container.has-bg .main-content :deep(.el-select__wrapper) {
  backdrop-filter: blur(0.5rem);
}
/* 表格固定列（el-table fixed right/left）：背景图模式下被透明规则抹掉背景，
   固定列会和下方内容重叠 → 用毛玻璃遮住滚动内容（透明底 + blur）。
   旧版用 .el-table__fixed 容器，新版(2.5+)用 sticky 单元格 .el-table-fixed-column--*，两种都覆盖。 */
.app-container.has-bg .main-content :deep(.el-table__fixed-right),
.app-container.has-bg .main-content :deep(.el-table__fixed),
.app-container.has-bg .main-content :deep(.el-table-fixed-column--right),
.app-container.has-bg .main-content :deep(.el-table-fixed-column--left),
.app-container.has-bg .main-content :deep(.k8s-action-cell),
.app-container.has-bg .main-content :deep(.db-action-cell) {
  backdrop-filter: blur(0.875rem);
  pointer-events: auto !important;
  z-index: 3 !important;
}
/* 划出面板（K8sDetailDrawer / MonitorTabContent 等）：背景图模式下同样被透明规则抹掉背景，
   加毛玻璃保证内容在背景图上清晰。 */
.app-container.has-bg .main-content :deep(.detail-drawer) {
  backdrop-filter: blur(0.5rem);
}
/* 拖拽/等待遮罩：全局透明规则会抹掉底色，这里给几处遮罩恢复颜色，
   保证背景图下 SFTP 拖入、终端拖文件、分屏落位提示、loading 蒙层仍清晰可见 */
.app-container.has-bg .main-content :deep(.drop-overlay),
.app-container.has-bg .main-content :deep(.loading-overlay) {
  background-color: var(--scrim) !important;
}
.app-container.has-bg .main-content :deep(.drop-zone-overlay .dz) {
  background-color: var(--accent-subtle) !important;
}
.app-container.has-bg .main-content :deep(.drop-zone-overlay .dz.active) {
  background-color: var(--accent-glow) !important;
}

</style>
