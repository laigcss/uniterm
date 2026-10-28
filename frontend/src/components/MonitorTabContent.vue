<template>
  <div class="monitor-tab">
    <div class="monitor-tabs-header">
      <div class="tab-item" :class="{ active: activeTab === 'performance' }" @click="activeTab = 'performance'">{{ t('monitor.performance') }}</div>
      <div class="tab-item" :class="{ active: activeTab === 'processes' }" @click="activeTab = 'processes'">{{ t('monitor.processes') }}</div>
      <div class="tab-item" :class="{ active: activeTab === 'ports' }" @click="activeTab = 'ports'">{{ t('monitor.ports') }}</div>
      <div class="tab-item" :class="{ active: activeTab === 'disks' }" @click="activeTab = 'disks'">{{ t('monitor.disks') }}</div>
      <div class="tab-item" :class="{ active: activeTab === 'network' }" @click="activeTab = 'network'">{{ t('monitor.networkCards') }}</div>
      <div class="tab-item" :class="{ active: activeTab === 'services' }" @click="activeTab = 'services'">{{ t('monitor.services') }}</div>
      <div class="tab-item" :class="{ active: activeTab === 'system' }" @click="activeTab = 'system'">{{ t('monitor.system') }}</div>
      <div class="tab-item" :class="{ active: activeTab === 'devices' }" @click="activeTab = 'devices'">{{ t('monitor.devices') }}</div>
      <div class="tab-item" :class="{ active: activeTab === 'health' }" @click="activeTab = 'health'">{{ t('monitor.health') }}</div>
    </div>

    <!-- Performance -->
    <MonitorPerformance
      v-show="activeTab === 'performance'"
      :current-cpu="monitor.currentCpu.value"
      :current-mem="monitor.currentMem.value"
      :current-swap="monitor.currentSwap.value"
      :current-disk="monitor.currentDisk.value"
      :current-net="monitor.currentNet.value"
      :cpu-history="monitor.cpuHistory.value"
      :mem-history="monitor.memHistory.value"
      :disk-history="monitor.diskHistory.value"
      :net-rx-history="monitor.netRxHistory.value"
      :net-tx-history="monitor.netTxHistory.value"
      :cpus="monitor.cpus.value"
      :nets="monitor.nets.value"
      :disks="monitor.disks.value"
      :disk-loading="monitor.diskLoading.value"
      :mounted-disks="monitor.mountedDisks.value"
      :perf-tick="monitor.perfTick.value"
      @load-perf-disks="monitor.fetchPerfDisks"
    />

    <!-- Processes -->
    <ProcessList
      v-show="activeTab === 'processes'"
      :processes="monitor.processList.value"
      :summary-cpu="monitor.processSummaryCpu.value"
      :summary-mem="monitor.processSummaryMem.value"
      :paused="monitor.paused.value"
      @toggle-pause="monitor.togglePause"
      @row-click="onProcessRowClick"
      @signal="onTableSignal"
    />

    <!-- Ports -->
    <PortList
      v-show="activeTab === 'ports'"
      :list="monitor.portList.value"
      :loading="monitor.loadingPorts.value"
      @refresh="monitor.fetchPorts"
      @contextmenu="showContextMenu"
    />

    <!-- Disks -->
    <DiskList
      v-show="activeTab === 'disks'"
      :list="monitor.diskList.value"
      :loading="monitor.loadingDisks.value"
      @refresh="monitor.fetchDisks"
      @contextmenu="showContextMenu"
    />

    <!-- Network -->
    <NetCardList
      v-show="activeTab === 'network'"
      :list="monitor.netCardList.value"
      :loading="monitor.loadingNetCards.value"
      @refresh="monitor.fetchNetCards"
      @contextmenu="showContextMenu"
    />

    <!-- System Info -->
    <SystemInfoPane
      v-show="activeTab === 'system'"
      :system-info="monitor.systemInfo.value"
      :host-clock-text="monitor.hostClockText.value"
      :clock-skew-text="monitor.clockSkewText.value"
      @contextmenu="showContextMenu"
    />

    <!-- Services -->
    <ServiceList
      v-show="activeTab === 'services'"
      :services="monitor.serviceList.value"
      :loading="monitor.loadingServices.value"
      :session-id="props.sessionId"
      @refresh="monitor.fetchServices"
      @contextmenu="showContextMenu"
    />

    <!-- Devices -->
    <DeviceList
      v-show="activeTab === 'devices'"
      :list="monitor.deviceList.value"
      :loading="monitor.loadingDevices.value"
      @refresh="monitor.fetchDevices"
      @contextmenu="showContextMenu"
    />

    <!-- Hardware health -->
    <HardwareHealth
      v-show="activeTab === 'health'"
      :fru="monitor.hardwareFru.value"
      :lan="monitor.hardwareLan.value"
      :sensors="monitor.hardwareSensors.value"
      :loading-fru="monitor.loadingHardwareFru.value"
      :loading-lan="monitor.loadingHardwareLan.value"
      :loading-sensors="monitor.loadingHardwareSensors.value"
      @refresh-fru="monitor.fetchHardwareFru"
      @refresh-lan="monitor.fetchHardwareLan"
      @refresh-sensors="monitor.fetchHardwareSensors"
      @contextmenu="showContextMenu"
    />

    <!-- Process detail drawer -->
    <ProcessDetailDrawer
      v-model:visible="detailDrawerVisible"
      :process-detail="processDetail"
      @contextmenu="showContextMenu"
    />

    <!-- Kill Confirmation Dialog -->
    <el-dialog append-to-body v-model="killDialogVisible" :title="killType === 'kill' ? t('monitor.forceKill') : t('monitor.kill')" width="22.5rem" align-center>
      <p>{{ killMessage }}</p>
      <template #footer>
        <el-button @click="killDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="danger" @click="confirmKill">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <!-- Context menu (copy selection) -->
    <Menu ref="ctxMenuRef" v-model:visible="ctxMenuVisible" v-slot="{ current }">
      <MenuItem @click="copyContextText(current)">{{ t('terminal.copy') }}</MenuItem>
    </Menu>

    <!-- Send-signal dropdown for the per-row table button. Kept OUTSIDE the
         processDetail-scoped drawer (which v-if's until a row is clicked) so it
         is always mounted and the button in the process table works on first
         open, independent of whether a process detail has been loaded yet. -->
    <Menu ref="signalMenuRef" v-model:visible="signalMenuVisible">
      <MenuItem @click="onSignal('term')">{{ t('monitor.signalTerm') }}</MenuItem>
      <MenuItem @click="onSignal('kill')">{{ t('monitor.signalKill') }}</MenuItem>
      <MenuItem @click="onSignal('hup')">{{ t('monitor.signalHup') }}</MenuItem>
      <MenuItem @click="onSignal('int')">{{ t('monitor.signalInt') }}</MenuItem>
    </Menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { GetProcessDetail, KillProcess } from '../../bindings/github.com/ys-ll/uniterm/app'
import { msg } from '../services/message'
import { useI18n } from '../i18n'
import { useMonitorData } from '../composables/useMonitorData'
import Menu from './Menu.vue'
import MenuItem from './MenuItem.vue'
import MonitorPerformance from './monitor/MonitorPerformance.vue'
import ProcessList from './monitor/ProcessList.vue'
import PortList from './monitor/PortList.vue'
import DiskList from './monitor/DiskList.vue'
import NetCardList from './monitor/NetCardList.vue'
import SystemInfoPane from './monitor/SystemInfoPane.vue'
import ServiceList from './monitor/ServiceList.vue'
import DeviceList from './monitor/DeviceList.vue'
import HardwareHealth from './monitor/HardwareHealth.vue'
import ProcessDetailDrawer from './monitor/ProcessDetailDrawer.vue'
import type { ProcessRow, ProcessDetail } from './monitor/monitorTypes'

const props = defineProps<{
  sessionId: string
}>()

defineOptions({ name: 'MonitorTabContent' })

const { t } = useI18n()
const activeTab = ref('performance')

// ── Central monitor data store (performance, process list, system, on-demand
//    lists, host clock, session:data subscription, lifecycle, tab prefetch). ──
const monitor = useMonitorData({
  sessionId: () => props.sessionId,
  activeTab
})

// ── Process detail drawer + kill dialog (UI state that spans ProcessList and
//    ProcessDetailDrawer, so it stays in the parent). ──
const detailDrawerVisible = ref(false)
const selectedProcess = ref<ProcessRow | null>(null)
const processDetail = ref<ProcessDetail | null>(null)

const killDialogVisible = ref(false)
const killTarget = ref<ProcessRow | null>(null)
const killType = ref<string>('term') // 'term' | 'kill' | 'hup' | 'int'

const killMessage = computed(() => {
  if (!killTarget.value) return ''
  const name = killTarget.value.name || ''
  const pid = killTarget.value.pid || ''
  if (killType.value === 'kill') {
    return t('monitor.forceKillConfirm', { name, pid })
  }
  return t('monitor.killConfirm', { name, pid })
})

async function onProcessRowClick(row: ProcessRow) {
  selectedProcess.value = row
  await fetchProcessDetail(row.pid)
  detailDrawerVisible.value = true
}

async function fetchProcessDetail(pid: number) {
  try {
    const detail = await GetProcessDetail(props.sessionId, pid)
    processDetail.value = detail
  } catch (e) {
    msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch process detail')
    processDetail.value = null
  }
}

function onTableSignal(row: ProcessRow, e: MouseEvent) {
  selectedProcess.value = row
  signalMenuRef.value?.toggle(e.currentTarget as HTMLElement)
}

function onDetailAction(cmd: string) {
  if (!selectedProcess.value) return
  killTarget.value = selectedProcess.value
  killType.value = cmd
  killDialogVisible.value = true
}

const signalMenuRef = ref<InstanceType<typeof Menu> | null>(null)
const signalMenuVisible = ref(false)
function onSignal(cmd: string) {
  signalMenuVisible.value = false
  onDetailAction(cmd)
}

async function confirmKill() {
  if (!killTarget.value) return
  const pid = killTarget.value.pid
  const signalMap: Record<string, string> = {
    term: 'TERM',
    kill: 'KILL',
    hup: 'HUP',
    int: 'INT'
  }
  const signal = signalMap[killType.value] || 'TERM'
  try {
    await KillProcess(props.sessionId, pid, signal)
    msg.success('Signal sent')
    killDialogVisible.value = false
  } catch (e) {
    msg.error((e instanceof Error ? e.message : '') || 'Failed to send signal')
  }
}

// ── Context menu (copy selection) — shared by all panes. ──
const ctxMenuRef = ref<InstanceType<typeof Menu> | null>(null)
const ctxMenuVisible = ref(false)

function showContextMenu(e: MouseEvent) {
  const selection = window.getSelection()?.toString().trim()
  if (!selection) return
  e.preventDefault()
  ctxMenuRef.value?.openAt(e.clientX, e.clientY, selection)
}

function copyContextText(text: unknown) {
  if (typeof text !== 'string' || !text) return
  navigator.clipboard.writeText(text).then(() => {
    msg.success(t('ai.copied'))
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    msg.success(t('ai.copied'))
  })
  ctxMenuVisible.value = false
}
</script>

<style scoped>
.monitor-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-base);
  position: relative;
  overflow: hidden;
}

.monitor-tabs-header {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.tab-item {
  padding: 0.5rem 1.25rem;
  font-size: 0.8125rem;
  font-family: var(--font-ui);
  color: var(--text-secondary);
  user-select: none;
  border-bottom: 0.125rem solid transparent;
  transition: all 0.15s ease;
}

.tab-item:hover {
  color: var(--text-primary);
}

.tab-item.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* Column drag-resize only works in el-table's border mode; hide the vertical
   grid lines it adds so the tables keep their original look. Applied via
   :deep so it reaches the el-table instances rendered inside the monitor
   sub-components. */
.monitor-tab :deep(.el-table--border .el-table__cell) {
  border-right: none;
}
.monitor-tab :deep(.el-table--border::after),
.monitor-tab :deep(.el-table--border::before) {
  display: none;
}
</style>
