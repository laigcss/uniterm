/**
 * useMonitorData — central data store + polling/fetch coordination for the
 * Monitor tab.
 *
 * Owns every piece of monitor state that used to live inline in
 * MonitorTabContent.vue: live performance counters + histories, the process
 * list + summary, system info, the on-demand port/disk/netcard/service/device/
 * hardware lists, the host-clock extrapolation, and the session:data
 * subscription. UI-only concerns (search, sort, drawers, dialogs, chart
 * drawing) stay in the sub-components; this composable only deals with data.
 *
 * Lifecycle hooks (onMounted/onActivated/onDeactivated/onUnmounted) and the
 * activeTab prefetch watcher are registered here so a single call from the
 * parent component wires up all data flow. The parent still owns the
 * activeTab/selectedPerf refs used for v-show switching — they are passed in
 * so the composable can react to tab changes — but all *data* refs are created
 * and returned here.
 */
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch, type Ref } from 'vue'
import {
  SetMonitorActiveTab,
  SetMonitorPaused,
  GetPorts,
  GetDisks,
  GetNetworkCards,
  GetServices,
  GetDevices,
  GetHardwareFru,
  GetHardwareLan,
  GetHardwareSensors
} from '../../bindings/github.com/ys-ll/uniterm/app'
import { msg } from '../services/message'
import { useSessionData } from './useSessionEvents'
import type {
  CpuCoreInfo,
  CpuPerf,
  DeviceInfo,
  DiskInfo,
  FruInfo,
  HardwareSensors,
  LanInfo,
  MemPerf,
  NetCardInfo,
  NetPerf,
  NetStatInfo,
  PortInfo,
  ProcessRow,
  ProcessSummaryCpu,
  ProcessSummaryMem,
  ServiceInfo,
  SwapPerf,
  SystemInfo,
  DiskPerf
} from '../components/monitor/monitorTypes'

/** Host clock skew formatter (shared with SystemInfoPane). */
export function formatSkew(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+'
  const abs = Math.abs(seconds)
  if (abs < 1) return `${sign}${abs.toFixed(1)}s`
  const d = Math.floor(abs / 86400)
  const h = Math.floor((abs % 86400) / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = Math.round(abs % 60)
  if (d > 0) return `${sign}${d}d ${h}h ${m}m`
  if (h > 0) return `${sign}${h}h ${m}m`
  if (m > 0) return `${sign}${m}m ${s}s`
  return `${sign}${s}s`
}

/** Uptime formatter (shared with SystemInfoPane). */
export function formatUptime(sec: number | undefined): string {
  const s = Number(sec || 0)
  if (!s) return ''
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** Width-percentage helper used by perf bars (shared with Performance). */
export function fmtWidth(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0%'
  return Math.min(100, Math.max(0, n)) + '%'
}

function pushHistory(arr: number[], val: number) {
  arr.push(val)
  if (arr.length > 60) arr.shift()
}

export interface UseMonitorDataOptions {
  /** Getter for the current session id (props.sessionId). */
  sessionId: () => string
  /** Shared active-tab ref (owned by the parent, used for prefetch + backend sync). */
  activeTab: Ref<string>
}

export function useMonitorData(options: UseMonitorDataOptions) {
  const { sessionId, activeTab } = options
  const sid = () => sessionId()

  // ── Tab-level flags ──
  const paused = ref(false)
  // False while the component is hidden by KeepAlive: the full process payload
  // is skipped instead of being rendered in a hidden pane.
  const monitorActive = ref(true)

  // ── Live performance counters + histories ──
  const currentCpu = ref<CpuPerf>({ usage: 0, total: 0, user: 0, system: 0, iowait: 0, cores: 0, processes: 0, handles: 0, load1: '-', load5: '-', load15: '-' })
  const currentMem = ref<MemPerf>({ total: 0, used: 0, free: 0, usage: 0, cached: 0, buffers: 0 })
  const currentSwap = ref<SwapPerf>({ total: 0, used: 0, usage: 0 })
  const currentDisk = ref<DiskPerf>({ total: '', used: '', usage: 0 })
  const currentNet = ref<NetPerf>({ rx: 0, tx: 0, rxTotal: 0, txTotal: 0 })
  const cpuHistory = ref<number[]>([])
  const memHistory = ref<number[]>([])
  const diskHistory = ref<number[]>([])
  const netRxHistory = ref<number[]>([])
  const netTxHistory = ref<number[]>([])

  // Expandable detail lists: per-core / per-NIC (live from perf payload) and
  // per-disk (fetched on-demand via GetDisks when expanded).
  const cpus = ref<CpuCoreInfo[]>([])
  const nets = ref<NetStatInfo[]>([])
  const disks = ref<DiskInfo[]>([])
  const diskLoading = ref(false)
  // Only directories with a mount point are shown in the disk detail list.
  const mountedDisks = computed(() => disks.value.filter((d: DiskInfo) => d.mountPoint))

  // ── Process list + summary ──
  const processList = ref<ProcessRow[]>([])
  const processSummaryCpu = ref<ProcessSummaryCpu>({ usage: 0, cores: 0, processes: 0, load1: '-', load5: '-', load15: '-' })
  const processSummaryMem = ref<ProcessSummaryMem>({ total: 0, used: 0, free: 0, usage: 0, cached: 0, buffers: 0 })

  // ── System info ──
  const systemInfo = ref<SystemInfo | null>(null)

  // ── On-demand tab data ──
  const portList = ref<PortInfo[]>([])
  const diskList = ref<DiskInfo[]>([])
  const netCardList = ref<NetCardInfo[]>([])
  const loadingPorts = ref(false)
  const loadingDisks = ref(false)
  const loadingNetCards = ref(false)

  // Services / devices / hardware health (on-demand tabs)
  const serviceList = ref<ServiceInfo[]>([])
  const deviceList = ref<DeviceInfo[]>([])
  // Hardware health loads as three independent parts (FRU / IPMI LAN /
  // sensors) so a slow ipmitool call does not block the others.
  const hardwareFru = ref<FruInfo | null>(null)
  const hardwareLan = ref<LanInfo[]>([])
  const hardwareSensors = ref<HardwareSensors | null>(null)
  const loadingServices = ref(false)
  const loadingDevices = ref(false)
  const loadingHardwareFru = ref(false)
  const loadingHardwareLan = ref(false)
  const loadingHardwareSensors = ref(false)

  // ── Host clock extrapolation ──
  // systemInfo.epochSec is the host's POSIX time at the moment the system
  // payload arrived (hostClockAt). Extrapolating with the live tick lets the
  // host clock keep ticking between payload refreshes, and the skew to the
  // local clock stays constant. (Same approach as MonitorOverviewSidebar.)
  const hostClockAt = ref(0)
  const clockNow = ref(0)
  let clockTimer: ReturnType<typeof setInterval> | null = null

  const hostClockText = computed(() => {
    const base = Number(systemInfo.value?.epochSec)
    if (!base || !hostClockAt.value) return '-'
    const liveMs = base * 1000 + (clockNow.value - hostClockAt.value)
    const tz = systemInfo.value?.timezone
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date(liveMs))
    } catch {
      return new Date(liveMs).toLocaleString(undefined, { hour12: false })
    }
  })

  const clockSkewText = computed(() => {
    const base = Number(systemInfo.value?.epochSec)
    if (!base || !hostClockAt.value) return '-'
    // Positive = host clock is ahead of the local machine.
    const s = (base * 1000 - hostClockAt.value) / 1000
    return formatSkew(s)
  })

  // ── Perf tick: bumped on every performance payload so the chart component
  //    can redraw exactly when the original nextTick(drawChart) did. ──
  const perfTick = ref(0)

  // ── Pause toggle ──
  function togglePause() {
    paused.value = !paused.value
    SetMonitorPaused(sid(), paused.value).catch(() => {})
  }

  // ── On-demand fetchers ──
  async function fetchPorts() {
    loadingPorts.value = true
    try {
      portList.value = await GetPorts(sid())
    } catch (e) {
      msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch ports')
      portList.value = []
    } finally {
      loadingPorts.value = false
    }
  }

  let diskFetchRetried = false
  async function fetchDisks() {
    loadingDisks.value = true
    try {
      diskList.value = await GetDisks(sid())
      diskFetchRetried = false
    } catch (e) {
      msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch disks')
      diskList.value = []
      // The monitor session may still be connecting on the first attempt;
      // retry once so the list shows without a manual refresh.
      if (!diskFetchRetried) {
        diskFetchRetried = true
        setTimeout(() => {
          if (diskList.value.length === 0 && activeTab.value === 'disks') fetchDisks()
        }, 3000)
      }
    } finally {
      loadingDisks.value = false
    }
  }

  async function fetchNetCards() {
    loadingNetCards.value = true
    try {
      netCardList.value = await GetNetworkCards(sid())
    } catch (e) {
      msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch network cards')
      netCardList.value = []
    } finally {
      loadingNetCards.value = false
    }
  }

  async function fetchServices() {
    loadingServices.value = true
    try {
      serviceList.value = await GetServices(sid())
    } catch (e) {
      msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch services')
      serviceList.value = []
    } finally {
      loadingServices.value = false
    }
  }

  async function fetchDevices() {
    loadingDevices.value = true
    try {
      deviceList.value = await GetDevices(sid())
    } catch (e) {
      msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch devices')
      deviceList.value = []
    } finally {
      loadingDevices.value = false
    }
  }

  async function fetchHardwareFru() {
    loadingHardwareFru.value = true
    try {
      hardwareFru.value = await GetHardwareFru(sid())
    } catch (e) {
      msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch FRU info')
      hardwareFru.value = null
    } finally {
      loadingHardwareFru.value = false
    }
  }

  async function fetchHardwareLan() {
    loadingHardwareLan.value = true
    try {
      hardwareLan.value = await GetHardwareLan(sid())
    } catch (e) {
      msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch IPMI LAN info')
      hardwareLan.value = []
    } finally {
      loadingHardwareLan.value = false
    }
  }

  async function fetchHardwareSensors() {
    loadingHardwareSensors.value = true
    try {
      hardwareSensors.value = await GetHardwareSensors(sid())
    } catch (e) {
      msg.error((e instanceof Error ? e.message : '') || 'Failed to fetch hardware sensors')
      hardwareSensors.value = null
    } finally {
      loadingHardwareSensors.value = false
    }
  }

  // Fetch the perf-extra disk list on demand (when the disk sub-list is
  // expanded in the performance pane). Separate from the disks-tab fetchDisks
  // because it populates a different ref and has no retry.
  async function fetchPerfDisks() {
    if (disks.value.length > 0) return
    diskLoading.value = true
    try {
      disks.value = await GetDisks(sid())
    } catch {
      disks.value = []
    } finally {
      diskLoading.value = false
    }
  }

  // ── session:data subscription ──
  useSessionData(sid, (raw) => {
    try {
      const payload = JSON.parse(raw)
      if (payload.type === 'system') {
        systemInfo.value = payload.system
        hostClockAt.value = Date.now()
        return
      }
      if (payload.type === 'performance') {
        if (payload.cpu) {
          currentCpu.value = payload.cpu
          pushHistory(cpuHistory.value, payload.cpu.usage || 0)
        }
        if (payload.memory) {
          currentMem.value = payload.memory
          pushHistory(memHistory.value, payload.memory.usage || 0)
        }
        if (payload.swap) {
          currentSwap.value = payload.swap
        }
        if (payload.disk) {
          currentDisk.value = payload.disk
          pushHistory(diskHistory.value, payload.disk.usage || 0)
        }
        if (payload.network) {
          currentNet.value = payload.network
          pushHistory(netRxHistory.value, payload.network.rx || 0)
          pushHistory(netTxHistory.value, payload.network.tx || 0)
          if (Array.isArray(payload.nets)) nets.value = payload.nets
        }
        if (Array.isArray(payload.cpus)) cpus.value = payload.cpus
        perfTick.value++
      }
      if (payload.type === 'processes' && payload.processes) {
        if (payload.summary) {
          if (payload.summary.cpu) {
            processSummaryCpu.value = payload.summary.cpu
          }
          if (payload.summary.memory) {
            processSummaryMem.value = payload.summary.memory
          }
        }
        // The full listing can be thousands of rows — only feed it into the
        // reactive tree (and the table) while the processes pane is actually
        // on screen, so hidden panes never re-render it.
        if (monitorActive.value && activeTab.value === 'processes') {
          processList.value = payload.processes
        }
      }
    } catch {
      // ignore parse errors
    }
  })

  onMounted(() => {
    // Drive the live host clock (1s local tick extrapolating from epochSec).
    clockNow.value = Date.now()
    clockTimer = window.setInterval(() => { clockNow.value = Date.now() }, 1000)

    // Notify backend of initial active tab
    SetMonitorActiveTab(sid(), activeTab.value).catch(() => {})
  })

  onActivated(() => {
    monitorActive.value = true
    // Sync active tab when component is reactivated from KeepAlive cache
    SetMonitorActiveTab(sid(), activeTab.value).catch(() => {})
    SetMonitorPaused(sid(), false).catch(() => {})
  })

  onDeactivated(() => {
    monitorActive.value = false
    // Pause data collection when component is hidden by KeepAlive
    SetMonitorPaused(sid(), true).catch(() => {})
  })

  onUnmounted(() => {
    if (clockTimer) window.clearInterval(clockTimer)
    clockTimer = null
    SetMonitorPaused(sid(), true).catch(() => {})
  })

  // Prefetch on tab entry (mirrors the original watch(activeTab)).
  watch(activeTab, (tab) => {
    SetMonitorActiveTab(sid(), tab).catch(() => {})
    if (tab === 'ports' && portList.value.length === 0 && !loadingPorts.value) {
      fetchPorts()
    }
    if (tab === 'disks' && diskList.value.length === 0 && !loadingDisks.value) {
      fetchDisks()
    }
    if (tab === 'network' && netCardList.value.length === 0 && !loadingNetCards.value) {
      fetchNetCards()
    }
    if (tab === 'services' && serviceList.value.length === 0 && !loadingServices.value) {
      fetchServices()
    }
    if (tab === 'devices' && deviceList.value.length === 0 && !loadingDevices.value) {
      fetchDevices()
    }
    if (tab === 'health') {
      if (hardwareFru.value === null && !loadingHardwareFru.value) {
        fetchHardwareFru()
      }
      if (hardwareLan.value.length === 0 && !loadingHardwareLan.value) {
        fetchHardwareLan()
      }
      if (!hardwareSensors.value && !loadingHardwareSensors.value) {
        fetchHardwareSensors()
      }
    }
  })

  return {
    // flags
    paused,
    monitorActive,
    // live performance
    currentCpu,
    currentMem,
    currentSwap,
    currentDisk,
    currentNet,
    cpuHistory,
    memHistory,
    diskHistory,
    netRxHistory,
    netTxHistory,
    cpus,
    nets,
    disks,
    diskLoading,
    mountedDisks,
    perfTick,
    // process list
    processList,
    processSummaryCpu,
    processSummaryMem,
    // system
    systemInfo,
    hostClockText,
    clockSkewText,
    // on-demand lists
    portList,
    diskList,
    netCardList,
    loadingPorts,
    loadingDisks,
    loadingNetCards,
    serviceList,
    deviceList,
    loadingServices,
    loadingDevices,
    // hardware health
    hardwareFru,
    hardwareLan,
    hardwareSensors,
    loadingHardwareFru,
    loadingHardwareLan,
    loadingHardwareSensors,
    // actions
    togglePause,
    fetchPorts,
    fetchDisks,
    fetchNetCards,
    fetchServices,
    fetchDevices,
    fetchHardwareFru,
    fetchHardwareLan,
    fetchHardwareSensors,
    fetchPerfDisks
  }
}

export type MonitorData = ReturnType<typeof useMonitorData>