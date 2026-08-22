<template>
  <div
    class="companion-sidebar monitor-sidebar"
  >
    <div v-if="!sessionId" class="companion-empty">
      <span v-if="connecting">{{ t('companion.connecting') }}</span>
      <span v-else-if="connectError">{{ connectError }}</span>
      <span v-else>{{ t('companion.needSsh') }}</span>
    </div>

    <div v-else class="monitor-body">
      <!-- System info 2x2 -->
      <div class="sys-grid">
        <div class="sys-cell">
          <User :size="14" class="sys-icon" />
          <div class="sys-text">
            <span class="sys-label">{{ t('monitor.user') }}</span>
            <span class="sys-value" :title="displayUser">{{ displayUser }}</span>
          </div>
        </div>
        <div class="sys-cell">
          <Clock :size="14" class="sys-icon" />
          <div class="sys-text">
            <span class="sys-label">{{ t('companion.uptime') }}</span>
            <span class="sys-value" :title="uptimeText">{{ uptimeText }}</span>
          </div>
        </div>
        <div class="sys-cell">
          <Globe :size="14" class="sys-icon" />
          <div class="sys-text">
            <span class="sys-label">{{ t('companion.host') }}</span>
            <span class="sys-value" :title="hostText">{{ hostText }}</span>
          </div>
        </div>
        <div class="sys-cell">
          <Monitor :size="14" class="sys-icon" />
          <div class="sys-text">
            <span class="sys-label">{{ t('monitor.os') }}</span>
            <span class="sys-value" :title="systemInfo?.os || '-'">{{ systemInfo?.os || '-' }}</span>
          </div>
        </div>
      </div>

      <!-- CPU stats -->
      <div class="card">
        <div class="cpu-grid">
          <div class="cpu-stat">
            <span class="cpu-label">{{ t('companion.cpuAvg') }}</span>
            <span class="cpu-num accent">{{ fmtPct(cpu.usage) }}</span>
          </div>
          <div class="cpu-stat">
            <span class="cpu-label">{{ t('companion.cpuSystem') }}</span>
            <span class="cpu-num">{{ fmtPct(cpu.system) }}</span>
          </div>
          <div class="cpu-stat">
            <span class="cpu-label">{{ t('companion.cpuUser') }}</span>
            <span class="cpu-num">{{ fmtPct(cpu.user) }}</span>
          </div>
          <div class="cpu-stat">
            <span class="cpu-label">{{ t('companion.cpuIowait') }}</span>
            <span class="cpu-num">{{ fmtPct(cpu.iowait) }}</span>
          </div>
          <div class="cpu-stat">
            <span class="cpu-label">{{ t('companion.cpuTotal') }}</span>
            <span class="cpu-num accent">{{ fmtPct(cpu.total, false) }}</span>
          </div>
          <div class="cpu-stat">
            <span class="cpu-label">{{ t('companion.cpuLoad') }}</span>
            <span class="cpu-num small">{{ fmtLoad(cpu.load1) }}</span>
          </div>
          <div class="cpu-stat">
            <span class="cpu-label">{{ t('monitor.cores') }}</span>
            <span class="cpu-num">{{ cpu.cores || '-' }}</span>
          </div>
          <div class="cpu-stat">
            <span class="cpu-label">{{ t('monitor.processCount') }}</span>
            <span class="cpu-num">{{ cpu.processes || processList.length || '-' }}</span>
          </div>
        </div>

        <!-- Memory bars -->
        <div class="mem-row">
          <div class="mem-head">
            <span>{{ t('companion.physMem') }}</span>
            <span class="mem-val">{{ formatMem(mem.used) }} / {{ formatMem(mem.total) }}</span>
          </div>
          <div class="mem-bar"><div class="mem-fill phys" :style="{ width: Math.min(mem.usage, 100) + '%' }" /></div>
        </div>
        <div class="mem-row">
          <div class="mem-head">
            <span>{{ t('companion.swapMem') }}</span>
            <span class="mem-val">{{ formatMem(swap.used) }} / {{ formatMem(swap.total) }}</span>
          </div>
          <div class="mem-bar"><div class="mem-fill swap" :style="{ width: Math.min(swap.usage, 100) + '%' }" /></div>
        </div>
      </div>

      <!-- Network + multi-line chart -->
      <div class="card chart-card">
        <div class="net-stats">
          <div class="net-stat">
            <span class="net-label">{{ t('companion.netTxTotal') }}</span>
            <span class="net-num muted">{{ formatBytes(net.txTotal) }}</span>
          </div>
          <div class="net-stat">
            <span class="net-label">{{ t('companion.netRxTotal') }}</span>
            <span class="net-num muted">{{ formatBytes(net.rxTotal) }}</span>
          </div>
          <div class="net-stat">
            <span class="net-label">{{ t('companion.netTxRate') }}</span>
            <span class="net-num tx">{{ formatBytes(net.tx) }}/s</span>
          </div>
          <div class="net-stat">
            <span class="net-label">{{ t('companion.netRxRate') }}</span>
            <span class="net-num rx">{{ formatBytes(net.rx) }}/s</span>
          </div>
        </div>
        <div class="chart-legend">
          <span class="leg">
            <span class="swatch" :style="{ background: SERIES.cpu }" />
            <span class="leg-name" :style="{ color: SERIES.cpu }">{{ t('monitor.cpu') }}</span>
          </span>
          <span class="leg">
            <span class="swatch" :style="{ background: SERIES.mem }" />
            <span class="leg-name" :style="{ color: SERIES.mem }">{{ t('monitor.memory') }}</span>
          </span>
          <span class="leg">
            <span class="swatch" :style="{ background: SERIES.tx }" />
            <span class="leg-name" :style="{ color: SERIES.tx }">{{ t('companion.upload') }}</span>
          </span>
          <span class="leg">
            <span class="swatch" :style="{ background: SERIES.rx }" />
            <span class="leg-name" :style="{ color: SERIES.rx }">{{ t('companion.download') }}</span>
          </span>
        </div>
        <canvas ref="chartCanvas" class="multi-canvas" />
      </div>

      <!-- Compact processes -->
      <div class="card proc-card">
        <div class="proc-head">
          <span>{{ t('monitor.processes') }}</span>
          <el-input v-model="processSearch" size="small" clearable :placeholder="t('monitor.searchProcess')" class="proc-search" />
        </div>
        <div class="proc-list">
          <div class="proc-row proc-header">
            <span class="c-name">{{ t('monitor.processName') }}</span>
            <span class="c-pid">{{ t('companion.pid') }}</span>
            <span class="c-cpu">{{ t('monitor.cpu') }}</span>
            <span class="c-mem">{{ t('monitor.mem') }}</span>
            <span class="c-act"></span>
          </div>
          <div v-for="p in filteredProcesses" :key="p.pid" class="proc-row">
            <span class="c-name" :title="p.name">{{ p.name }}</span>
            <span class="c-pid">{{ p.pid }}</span>
            <span class="c-cpu">{{ Number(p.cpu).toFixed(1) }}</span>
            <span class="c-mem">{{ Number(p.mem).toFixed(1) }}</span>
            <button class="kill-btn" :title="t('monitor.kill')" @click="onKill(p)">
              <Square :size="12" />
            </button>
          </div>
          <div v-if="!filteredProcesses.length" class="proc-empty">{{ t('companion.noProcesses') }}</div>
        </div>
      </div>

      <!-- Open full monitor (pinned at the bottom) -->
      <button class="full-monitor-btn" @click="openFullMonitor">
        <ExternalLink :size="14" />
        <span>{{ t('companion.openFullMonitor') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { ExternalLink, Square, User, Clock, Globe, Monitor } from '@lucide/vue'
import { ElMessageBox } from 'element-plus'
import { useI18n } from '../i18n'
import { useCompanionStore } from '../stores/companionStore'
import { usePanelStore } from '../stores/panelStore'
import { SetMonitorActiveTab, KillProcess } from '../../wailsjs/go/main/App'
import { EventsOn } from '../../wailsjs/runtime'

const { t } = useI18n()
const companionStore = useCompanionStore()
const panelStore = usePanelStore()

const connecting = ref(false)
const connectError = ref('')
const chartCanvas = ref<HTMLCanvasElement | null>(null)
const processSearch = ref('')

const systemInfo = ref<Record<string, any> | null>(null)
const cpu = ref({ usage: 0, total: 0, user: 0, system: 0, iowait: 0, cores: 0, processes: 0, load1: '-', load5: '-', load15: '-' })
const mem = ref({ total: 0, used: 0, free: 0, usage: 0 })
const swap = ref({ total: 0, used: 0, usage: 0 })
const net = ref({ rx: 0, tx: 0, rxTotal: 0, txTotal: 0 })
const processList = ref<any[]>([])
const cpuHistory = ref<number[]>([])
const memHistory = ref<number[]>([])
const netRxHistory = ref<number[]>([])
const netTxHistory = ref<number[]>([])

const sessionId = computed(() => companionStore.currentMonitorSessionId)

const displayUser = computed(() => {
  if (systemInfo.value?.user) return systemInfo.value.user
  const pid = companionStore.activeSshPanelId
  const panel = pid ? panelStore.getPanel(pid) : null
  return panel?.config?.user || '-'
})

const hostText = computed(() => {
  const ip = systemInfo.value?.localIP
  const pid = companionStore.activeSshPanelId
  const panel = pid ? panelStore.getPanel(pid) : null
  const host = panel?.config?.host || ''
  const port = panel?.config?.port
  if (ip) return port ? `${ip}:${port}` : ip
  if (host) return port ? `${host}:${port}` : host
  return '-'
})

const uptimeText = computed(() => {
  const sec = Number(systemInfo.value?.uptimeSec || 0)
  if (!sec) return '-'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
})

const filteredProcesses = computed(() => {
  const q = processSearch.value.trim().toLowerCase()
  const list = processList.value
  if (!q) return list.slice(0, 30)
  return list.filter((p: any) =>
    String(p.name).toLowerCase().includes(q) ||
    String(p.pid).includes(q) ||
    String(p.user).toLowerCase().includes(q)
  ).slice(0, 30)
})

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatMem(gb: number): string {
  if (!gb) return '0 B'
  if (gb < 1) return (gb * 1024).toFixed(0) + ' MB'
  return gb.toFixed(1) + ' GB'
}

function fmtPct(v: number, clamp100 = true): string {
  let n = Number(v)
  if (!Number.isFinite(n)) n = 0
  if (clamp100) n = Math.min(100, Math.max(0, n))
  else n = Math.max(0, n)
  return n.toFixed(1) + '%'
}

function fmtLoad(v: number | string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '-')
  return n.toFixed(2)
}

function pushHistory(arr: number[], val: number) {
  arr.push(val)
  if (arr.length > 60) arr.shift()
}

function cssColor(_name: string, fallback: string): string {
  return fallback
}

/** Fixed series colors — same for legend + canvas (theme-independent). */
const SERIES = {
  cpu: '#60a5fa',
  mem: '#2dd4bf',
  tx: '#f59e0b',
  rx: '#4ade80',
} as const

function drawChart() {
  const canvas = chartCanvas.value
  if (!canvas) return
  const parent = canvas.parentElement
  if (!parent) return
  const w = Math.max(parent.clientWidth - 0, 10)
  const h = 120
  const dpr = window.devicePixelRatio || 1
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  function draw(data: number[], color: string, maxOverride?: number) {
    if (data.length < 2) return
    const max = maxOverride ?? Math.max(1, ...data)
    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * (w - 4) + 2
      const y = h - 4 - (Math.min(v, max) / max) * (h - 10)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  draw(cpuHistory.value, SERIES.cpu, 100)
  draw(memHistory.value, SERIES.mem, 100)
  draw(netTxHistory.value, SERIES.tx)
  draw(netRxHistory.value, SERIES.rx)
}

async function ensureConnected() {
  const pid = companionStore.activeSshPanelId
  if (!pid || !companionStore.monitorVisible) return
  connecting.value = true
  connectError.value = ''
  try {
    const sid = await companionStore.ensureMonitor(pid)
    if (sid) SetMonitorActiveTab(sid, 'overview').catch(() => {})
  } catch (e: any) {
    connectError.value = e?.toString?.() || t('companion.needSsh')
  } finally {
    connecting.value = false
  }
}

function openFullMonitor() {
  const pid = companionStore.activeSshPanelId
  const panel = pid ? panelStore.getPanel(pid) : null
  if (!panel?.config) return
  window.dispatchEvent(new CustomEvent('app:connect-monitor', { detail: panel }))
}

async function onKill(p: any) {
  const sid = sessionId.value
  if (!sid) return
  try {
    await ElMessageBox.confirm(
      t('monitor.killConfirm', { name: p.name, pid: p.pid }),
      t('monitor.kill'),
      { type: 'warning', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') }
    )
    await KillProcess(sid, p.pid, 'term')
  } catch { /* cancelled */ }
}

let unsub: (() => void) | null = null

function bindListeners() {
  unsub?.()
  unsub = EventsOn('session:data', (data: any) => {
    if (data?.id !== sessionId.value) return
    if (typeof data.data === 'string') {
      const connMatch = data.data.match(/\[Connection failed: ([^\]]+)\]/)
      if (connMatch) {
        connectError.value = connMatch[1]
        return
      }
    }
    try {
      const payload = JSON.parse(data.data)
      if (payload.type === 'system') {
        systemInfo.value = payload.system
        return
      }
      if (payload.type === 'performance') {
        if (payload.cpu) {
          cpu.value = {
            usage: payload.cpu.usage || 0,
            total: payload.cpu.total ?? ((payload.cpu.usage || 0) * (payload.cpu.cores || 1)),
            user: payload.cpu.user || 0,
            system: payload.cpu.system || 0,
            iowait: payload.cpu.iowait || 0,
            cores: payload.cpu.cores || 0,
            processes: payload.cpu.processes || 0,
            load1: payload.cpu.load1 ?? '-',
            load5: payload.cpu.load5 ?? '-',
            load15: payload.cpu.load15 ?? '-',
          }
          pushHistory(cpuHistory.value, payload.cpu.usage || 0)
        }
        if (payload.memory) {
          mem.value = {
            total: payload.memory.total || 0,
            used: payload.memory.used || 0,
            free: payload.memory.free || 0,
            usage: payload.memory.usage || 0,
          }
          pushHistory(memHistory.value, payload.memory.usage || 0)
        }
        if (payload.swap) {
          swap.value = {
            total: payload.swap.total || 0,
            used: payload.swap.used || 0,
            usage: payload.swap.usage || 0,
          }
        }
        if (payload.network) {
          net.value = {
            rx: payload.network.rx || 0,
            tx: payload.network.tx || 0,
            rxTotal: payload.network.rxTotal || 0,
            txTotal: payload.network.txTotal || 0,
          }
          pushHistory(netRxHistory.value, payload.network.rx || 0)
          pushHistory(netTxHistory.value, payload.network.tx || 0)
        }
        nextTick(drawChart)
      }
      if (payload.type === 'processes' && payload.processes) {
        processList.value = payload.processes
        if (payload.summary?.cpu) {
          cpu.value.processes = payload.summary.cpu.processes || cpu.value.processes
        }
      }
    } catch { /* ignore */ }
  })
}

/** Restore this panel's cached monitor data; returns true if a cache existed. */
function restoreCache(): boolean {
  const pid = companionStore.activeSshPanelId
  const cached = pid ? companionStore.getMonitorViewCache(pid) : null
  if (!cached) return false
  systemInfo.value = cached.systemInfo
  cpu.value = { ...cached.cpu }
  mem.value = { ...cached.mem }
  swap.value = { ...cached.swap }
  net.value = { ...cached.net }
  processList.value = [...cached.processList]
  cpuHistory.value = [...cached.cpuHistory]
  memHistory.value = [...cached.memHistory]
  netRxHistory.value = [...cached.netRxHistory]
  netTxHistory.value = [...cached.netTxHistory]
  nextTick(drawChart)
  return true
}

watch(sessionId, (sid) => {
  // Re-entering an already-visited tab: restore its cached graphs instead of
  // resetting, so switching back shows the previous content instantly.
  if (restoreCache()) {
    if (sid) {
      bindListeners()
      SetMonitorActiveTab(sid, 'overview').catch(() => {})
    }
    return
  }
  systemInfo.value = null
  processList.value = []
  cpuHistory.value = []
  memHistory.value = []
  netRxHistory.value = []
  netTxHistory.value = []
  if (!sid) return
  bindListeners()
  SetMonitorActiveTab(sid, 'overview').catch(() => {})
})

// Persist the current graphs per SSH panel so a later switch-back can restore them.
watch(
  [systemInfo, cpu, mem, swap, net, processList, cpuHistory, memHistory, netRxHistory, netTxHistory],
  () => {
    const pid = companionStore.activeSshPanelId
    if (!pid) return
    companionStore.setMonitorViewCache(pid, {
      systemInfo: systemInfo.value ? { ...systemInfo.value } : null,
      cpu: { ...cpu.value },
      mem: { ...mem.value },
      swap: { ...swap.value },
      net: { ...net.value },
      processList: [...processList.value],
      cpuHistory: [...cpuHistory.value],
      memHistory: [...memHistory.value],
      netRxHistory: [...netRxHistory.value],
      netTxHistory: [...netTxHistory.value],
    })
  },
  { deep: true },
)

watch(() => companionStore.monitorVisible, (v) => {
  if (v) {
    ensureConnected()
    nextTick(drawChart)
  }
})

watch(() => companionStore.activeSshPanelId, () => {
  if (companionStore.monitorVisible) ensureConnected()
})

onMounted(() => {
  bindListeners()
  // Re-mounting after the view was hidden (e.g. switching files<->monitor):
  // restore this panel's cached data since the session didn't change.
  restoreCache()
  if (companionStore.monitorVisible) ensureConnected()
  window.addEventListener('resize', drawChart)
})

onUnmounted(() => {
  unsub?.()
  window.removeEventListener('resize', drawChart)
})
</script>

<style scoped>
.companion-sidebar {
  background: transparent;
  display: flex;
  flex-direction: column;
  position: relative;
  flex-shrink: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.companion-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
  padding: 16px;
  text-align: center;
}
.monitor-body {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  min-height: 0;
}

.full-monitor-btn {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  flex-shrink: 0;
  padding: 10px;
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.full-monitor-btn:hover {
  color: var(--accent);
  background: var(--accent-subtle);
  border-color: var(--accent-subtle);
  box-shadow: 0 0 0 1px var(--accent-subtle) inset;
}

.sys-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.sys-cell {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
  background: var(--bg-surface);
  border-radius: 10px;
}
.sys-icon {
  color: var(--text-muted);
  flex-shrink: 0;
  margin-top: 2px;
}
.sys-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sys-label {
  font-size: 11px;
  color: var(--text-muted);
}
.sys-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card {
  background: var(--bg-surface);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cpu-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px 6px;
}
.cpu-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cpu-label {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cpu-num {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cpu-num.accent { color: var(--chart-2, #60a5fa); }
.cpu-num.small { font-size: 12px; }

.mem-row { display: flex; flex-direction: column; gap: 4px; }
.mem-head {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
}
.mem-val {
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.mem-bar {
  height: 8px;
  border-radius: 999px;
  background: var(--bg-hover);
  overflow: hidden;
}
.mem-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.35s ease;
}
.mem-fill.phys { background: linear-gradient(90deg, #3b82f6, #60a5fa); }
.mem-fill.swap { background: linear-gradient(90deg, #14b8a6, #2dd4bf); }

.net-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.net-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.net-label { font-size: 10px; color: var(--text-muted); }
.net-num {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.net-num.muted { color: var(--text-secondary); }
.net-num.tx { color: #f59e0b; }
.net-num.rx { color: #4ade80; }

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 14px;
  padding: 2px 0 4px;
  font-size: 12px;
}
.leg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  width: 14px;
  height: 3px;
  border-radius: 2px;
  flex-shrink: 0;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.leg-name {
  font-weight: 600;
  letter-spacing: 0.01em;
}

.multi-canvas {
  width: 100%;
  height: 120px;
  border-radius: 8px;
  background: var(--bg-base);
}

.proc-card { flex: 1; min-height: 140px; }
.proc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.proc-search { width: 130px; }
.proc-list {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  max-height: 220px;
}
.proc-row {
  display: grid;
  grid-template-columns: 1fr 48px 40px 40px 24px;
  gap: 4px;
  align-items: center;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
}
.proc-row.proc-header {
  position: sticky;
  top: 0;
  background: var(--bg-surface);
  color: var(--text-muted);
  font-weight: 600;
  z-index: 1;
}
.c-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-pid, .c-cpu, .c-mem { text-align: right; font-variant-numeric: tabular-nums; }
.kill-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}
.kill-btn:hover { color: var(--el-color-danger); background: var(--bg-hover); }
.proc-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
