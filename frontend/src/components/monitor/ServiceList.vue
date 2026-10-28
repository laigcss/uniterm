<template>
  <div>
    <div class="tab-pane services-pane" @contextmenu.prevent="emit('contextmenu', $event)">
      <div class="od-toolbar">
        <el-input v-model="search" :placeholder="t('monitor.searchService')" clearable class="od-search" />
        <el-button :icon="RefreshRight" :loading="loading" @click="emit('refresh')">
          {{ t('monitor.refresh') }}
        </el-button>
      </div>
      <el-table :data="filtered" size="small" border v-loading="loading" height="calc(100% - 2.25rem)" class="od-table" @row-click="onRowClick">
        <el-table-column prop="name" :label="t('monitor.service.name')" sortable :min-width="uiPx(220)" />
        <el-table-column prop="active" :label="t('monitor.service.active')" sortable :width="uiPx(100)">
          <template #default="{ row }">
            <span class="svc-state" :class="serviceStateClass(row)">{{ row.active }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="enabled" :label="t('monitor.service.enabled')" sortable :width="uiPx(110)">
          <template #default="{ row }">{{ row.enabled || '-' }}</template>
        </el-table-column>
        <el-table-column prop="description" :label="t('monitor.service.description')" :min-width="uiPx(220)" show-overflow-tooltip />
        <el-table-column :label="t('monitor.service.actions')" :width="uiPx(120)" align="center">
          <template #default="{ row }">
            <el-button size="small" @click.stop="onActionMenu(row, $event)">
              {{ t('monitor.service.actions') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- Service Action Confirmation Dialog -->
    <el-dialog append-to-body v-model="actionDialogVisible" :title="actionCmd ? t('monitor.service.' + actionCmd) : ''" width="22.5rem" align-center>
      <p>{{ actionMessage }}</p>
      <template #footer>
        <el-button @click="actionDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="confirmAction">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <!-- Service Detail Drawer (slides out like the process detail drawer);
         two tabs: properties detail / k8s-style journal logs -->
    <div class="detail-drawer-backdrop" :class="{ open: detailVisible }" @click="detailVisible = false"></div>
    <div ref="drawerEl" class="detail-drawer" :class="{ open: detailVisible }" :style="detailVisible ? { width: drawerWidth + 'px' } : undefined">
      <div class="svc-resizer" @mousedown="onResizeStart"></div>
      <div class="detail-drawer-header">
        <span class="detail-drawer-title">{{ detailName }}</span>
        <el-button link @click="detailVisible = false">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
      <div class="svc-drawer-tabs">
        <div class="svc-tab" :class="{ active: drawerTab === 'detail' }" @click="drawerTab = 'detail'">{{ t('monitor.service.detail') }}</div>
        <div class="svc-tab" :class="{ active: drawerTab === 'logs' }" @click="onLogsTab">{{ t('monitor.service.logs') }}</div>
      </div>
      <!-- Detail tab (same structure/styles as the process detail drawer) -->
      <div v-show="drawerTab === 'detail'" class="svc-detail-pane">
        <div class="process-detail">
          <div class="detail-section" @contextmenu="onSectionContextMenu">
            <div v-for="row in detailRows" :key="row.label" class="detail-row">
              <span class="detail-label">{{ row.label }}</span>
              <span class="detail-value">{{ row.value }}</span>
            </div>
            <div v-if="loadingDetail && detailRows.length === 0" class="detail-row">
              <span class="detail-label">{{ t('monitor.loading') }}</span>
            </div>
          </div>
        </div>
      </div>
      <!-- Logs tab (k8s log-viewer style: line rows + muted timestamp column) -->
      <div v-show="drawerTab === 'logs'" class="svc-logs-pane">
        <div class="svc-logs-toolbar">
          <el-select v-model="logLines" size="small" class="svc-log-lines" @change="onLogLinesChange">
            <el-option v-for="n in [100, 200, 500, 1000, 2000]" :key="n" :label="String(n)" :value="n" />
          </el-select>
          <el-checkbox v-model="logAutoScroll" border size="small">{{ t('monitor.service.autoScroll') }}</el-checkbox>
          <el-checkbox v-model="logTimestamps" border size="small">{{ t('k8s.logTimestamps') }}</el-checkbox>
          <el-checkbox v-model="logWrap" border size="small">{{ t('k8s.logWrap') }}</el-checkbox>
          <div class="flex-spacer" />
          <el-button size="small" :icon="RefreshRight" :loading="loadingLogs" @click="fetchLogs" />
        </div>
        <div
          ref="logViewerRef"
          class="svc-log-viewer"
          :class="{ 'logs-nowrap': !logWrap, 'logs-hide-ts': !logTimestamps }"
          v-loading="loadingLogs"
          @contextmenu="emit('contextmenu', $event)"
        >
          <div v-for="(l, i) in logLinesParsed" :key="i" class="log-line"><span class="log-ts">{{ l.ts }}</span>{{ l.msg }}</div>
          <div v-if="!loadingLogs && logLinesParsed.length === 0" class="health-hint" style="padding: 0.5rem 0;">{{ t('monitor.service.noLogs') }}</div>
        </div>
      </div>
    </div>

    <!-- Service action menu (shared, mounted once; opens next to the row button) -->
    <Menu ref="menuRef" v-model:visible="menuVisible">
      <MenuItem @click="onCmd('start')">{{ t('monitor.service.start') }}</MenuItem>
      <MenuItem @click="onCmd('stop')">{{ t('monitor.service.stop') }}</MenuItem>
      <MenuItem @click="onCmd('restart')">{{ t('monitor.service.restart') }}</MenuItem>
      <MenuItem @click="onCmd('enable')">{{ t('monitor.service.enable') }}</MenuItem>
      <MenuItem @click="onCmd('disable')">{{ t('monitor.service.disable') }}</MenuItem>
    </Menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { GetServiceDetail, GetServiceLogs, ServiceAction } from '../../../bindings/github.com/ys-ll/uniterm/app'
import { msg } from '../../services/message'
import { Close, RefreshRight } from '@element-plus/icons-vue'
import { useI18n } from '../../i18n'
import { uiPx } from '../../utils/uiScale'
import { formatBytes } from '../../utils/format'
import Menu from '../Menu.vue'
import MenuItem from '../MenuItem.vue'
import type { ServiceInfo, ServiceDetail } from './monitorTypes'

const props = defineProps<{
  services: ServiceInfo[]
  loading: boolean
  sessionId: string
}>()

const emit = defineEmits<{
  refresh: []
  contextmenu: [event: MouseEvent]
}>()

defineOptions({ name: 'ServiceList' })

const { t } = useI18n()
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.services
  return props.services.filter((s: ServiceInfo) =>
    String(s.name).toLowerCase().includes(q) ||
    String(s.description).toLowerCase().includes(q)
  )
})

function serviceStateClass(row: ServiceInfo) {
  if (row.active === 'active') return 'state-ok'
  if (row.active === 'failed') return 'state-bad'
  return 'state-idle'
}

// Service action confirm dialog
const actionDialogVisible = ref(false)
const actionTarget = ref<ServiceInfo | null>(null)
const actionCmd = ref('')
const menuRef = ref<InstanceType<typeof Menu> | null>(null)
const menuVisible = ref(false)

const actionMessage = computed(() => {
  if (!actionTarget.value) return ''
  return t('monitor.service.actionConfirm', {
    action: t('monitor.service.' + actionCmd.value),
    name: actionTarget.value.name
  })
})

function onActionMenu(row: ServiceInfo, e: MouseEvent) {
  actionTarget.value = row
  menuRef.value?.toggle(e.currentTarget as HTMLElement)
}

function onCmd(cmd: string) {
  menuVisible.value = false
  actionCmd.value = cmd
  actionDialogVisible.value = true
}

async function confirmAction() {
  if (!actionTarget.value) return
  const name = actionTarget.value.name
  const cmd = actionCmd.value
  try {
    await ServiceAction(props.sessionId, name, cmd)
    msg.success(`${cmd} ${name} OK`)
    actionDialogVisible.value = false
    emit('refresh')
  } catch (e) {
    msg.error((e instanceof Error ? e.message : '') || 'Failed to run service action')
  }
}

// Service detail drawer: two tabs (properties detail / journal logs)
const detailVisible = ref(false)
const detailName = ref('')
const detail = ref<ServiceDetail | null>(null)
const loadingDetail = ref(false)
const drawerTab = ref<'detail' | 'logs'>('detail')
const logLines = ref(200)
const logAutoScroll = ref(true)
const logTimestamps = ref(true)
const logWrap = ref(false)
const serviceLogs = ref('')
const loadingLogs = ref(false)
const logViewerRef = ref<HTMLElement | null>(null)

function memBytes(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return ''
  return formatBytes(n)
}

const detailRows = computed(() => {
  const d = detail.value
  if (!d) return []
  return [
    { label: t('monitor.service.description'), value: d.Description },
    { label: t('monitor.service.load'), value: d.LoadState },
    { label: t('monitor.service.active'), value: d.SubState && d.SubState !== d.ActiveState ? `${d.ActiveState} (${d.SubState})` : d.ActiveState },
    { label: t('monitor.service.enabled'), value: d.UnitFileState },
    { label: 'PID', value: d.ExecMainPID && d.ExecMainPID !== '0' ? d.ExecMainPID : '' },
    { label: t('monitor.memory'), value: memBytes(d.MemoryCurrent) }
  ].filter(r => r.value)
})

async function onRowClick(row: ServiceInfo) {
  detailName.value = row.name
  detail.value = null
  serviceLogs.value = ''
  drawerTab.value = 'detail'
  detailVisible.value = true
  loadingDetail.value = true
  try {
    detail.value = await GetServiceDetail(props.sessionId, row.name)
  } catch (e) {
    msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch service detail')
  } finally {
    loadingDetail.value = false
  }
}

function onLogsTab() {
  drawerTab.value = 'logs'
  // Always re-fetch on tab entry so the view is fresh; journalctl is cheap.
  fetchLogs()
}

function onLogLinesChange() {
  fetchLogs()
}

async function fetchLogs() {
  if (!detailName.value) return
  loadingLogs.value = true
  try {
    serviceLogs.value = await GetServiceLogs(props.sessionId, detailName.value, logLines.value)
    if (logAutoScroll.value) {
      nextTick(() => {
        const el = logViewerRef.value
        if (el) el.scrollTop = el.scrollHeight
      })
    }
  } catch (e) {
    msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch service logs')
    serviceLogs.value = ''
  } finally {
    loadingLogs.value = false
  }
}

// Split a journalctl short-iso line into "<RFC3339 timestamp> <message>",
// mirroring the k8s log viewer's line model.
function splitLogLine(line: string): { ts: string; msg: string } {
  const sp = line.indexOf(' ')
  if (sp > 0 && /^\d{4}-\d\d-\d\dT/.test(line)) {
    return { ts: line.slice(0, sp), msg: line.slice(sp + 1) }
  }
  return { ts: '', msg: line }
}

const logLinesParsed = computed(() => serviceLogs.value.split('\n').map(splitLogLine))

// Only surface the context menu when right-clicking on a detail value cell,
// mirroring the original onDetailSectionContextMenu behaviour.
function onSectionContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  const detailValue = target.closest('.detail-value') as HTMLElement | null
  if (detailValue) {
    emit('contextmenu', e)
  }
}

// Drawer width (draggable via the left-edge resizer, same as the k8s drawer;
// not persisted across sessions). Max width tracks the actual parent container
// (not the window) so the drawer never extends past the container's left edge
// on any screen size.
const drawerEl = ref<HTMLElement | null>(null)
const drawerWidth = ref(420)
let resizeStartX = 0
let resizeStartW = 0

function maxDrawerWidth() {
  const parent = drawerEl.value?.parentElement
  return parent ? Math.max(320, parent.clientWidth - 40) : window.innerWidth - 120
}

function onResizeMove(e: MouseEvent) {
  const dx = resizeStartX - e.clientX
  drawerWidth.value = Math.max(320, Math.min(maxDrawerWidth(), resizeStartW + dx))
}

function onResizeEnd() {
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}

function onResizeStart(e: MouseEvent) {
  resizeStartX = e.clientX
  resizeStartW = drawerWidth.value
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
  e.preventDefault()
}
</script>

<style scoped>
.tab-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.services-pane {
  flex-direction: column;
  padding: 0;
}
.od-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  flex-shrink: 0;
  gap: 0.75rem;
}
.od-search {
  width: 15rem;
}
.od-table {
  flex: 1;
  min-height: 0;
}
.od-table :deep(.cell) {
  user-select: text;
}
.svc-state {
  font-variant-numeric: tabular-nums;
}
.svc-state.state-ok {
  color: var(--success);
}
.svc-state.state-bad {
  color: var(--error);
}
.svc-state.state-idle {
  color: var(--text-muted);
}
/* Detail drawer (inside monitor-tab) */
.detail-drawer-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
  z-index: 99;
}
.detail-drawer-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}
.detail-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 26.25rem;
  max-width: 100%;
  background: var(--bg-elevated);
  border-left: 1px solid var(--border-subtle);
  transform: translateX(100%);
  transition: transform 0.3s ease;
  z-index: 100;
  display: flex;
  flex-direction: column;
}
.detail-drawer.open {
  transform: translateX(0);
}
.detail-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.detail-drawer-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-ui);
}
/* Process detail (shared structure for the service detail tab) */
.process-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.process-detail .detail-section {
  flex: 1;
  overflow-y: auto;
  padding: 0 1rem;
}
.process-detail .detail-row {
  display: flex;
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--border-subtle);
  gap: 0.75rem;
}
.process-detail .detail-row:last-child {
  border-bottom: none;
}
.process-detail .detail-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: var(--font-ui);
  flex-shrink: 0;
  width: 6.25rem;
  min-width: 6.25rem;
}
.process-detail .detail-value {
  font-size: 0.8125rem;
  color: var(--text-primary);
  font-family: var(--font-mono);
  word-break: break-all;
  flex: 1;
  user-select: text;
}
/* Service drawer: detail/logs tabs and the k8s-style log viewer */
/* Left-edge drag handle to resize the service drawer (same as the k8s one) */
.svc-resizer {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 0.3125rem;
  cursor: col-resize;
  z-index: 101;
  background: transparent;
  transition: background 0.15s ease;
}
.svc-resizer:hover {
  background: var(--accent, #4096ff);
}
.svc-drawer-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.svc-tab {
  padding: 0.5rem 0.625rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  user-select: none;
  border-bottom: 0.125rem solid transparent;
}
.svc-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.svc-detail-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.svc-detail-pane .process-detail {
  flex: 1;
  min-height: 0;
}
.svc-logs-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.svc-logs-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  flex-shrink: 0;
  /* wrap instead of squeezing controls (same as the k8s log toolbar) */
  flex-wrap: wrap;
}
.svc-logs-toolbar :deep(.el-checkbox) {
  margin-right: 0;
}
.flex-spacer {
  flex: 1;
}
.svc-log-lines {
  width: 3.75rem;
  flex-shrink: 0;
}
.svc-log-viewer {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.75rem;
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  background: var(--bg-base);
  user-select: text;
}
/* Line model identical to the k8s log viewer */
.svc-log-viewer .log-line {
  white-space: pre-wrap;
  word-break: break-all;
}
/* No-wrap mode: keep each journal line on one row, scroll horizontally */
.svc-log-viewer.logs-nowrap .log-line {
  white-space: pre;
  word-break: normal;
}
.svc-log-viewer .log-ts {
  color: var(--text-muted);
  margin-right: 0.5rem;
}
.svc-log-viewer .log-ts:empty {
  margin-right: 0;
}
.svc-log-viewer.logs-hide-ts .log-ts {
  display: none;
}
.health-hint {
  flex: 1;
  color: var(--text-muted);
  font-size: 0.75rem;
}
</style>