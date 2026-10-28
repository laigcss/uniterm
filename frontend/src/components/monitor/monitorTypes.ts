// ── Monitor data types ──
// These mirror the backend payloads delivered via session:data and the
// Get* APIs. Fields are typed loosely (string/number) because the backend
// serialises everything to JSON; optional fields use `?` where the value
// may be absent on some platforms.
//
// Shared by MonitorTabContent.vue, its sub-components and the
// useMonitorData composable so each module imports a single source of truth.

/** One row of the process list table. */
export interface ProcessRow {
  pid: number
  name: string
  user: string
  state?: string
  cpu?: number
  mem?: number
  // Allow dynamic property access in the client-side sort handler.
  [key: string]: string | number | undefined
}

/** File-descriptor breakdown inside a process detail payload. */
export interface ProcessFdInfo {
  total?: number
  files?: number
  sockets?: number
  pipes?: number
  anons?: number
  devs?: number
  others?: number
}

/** I/O counters inside a process detail payload. */
export interface ProcessIoInfo {
  rchar?: number
  wchar?: number
  read_bytes?: number
  write_bytes?: number
}

/** Process detail payload returned by GetProcessDetail. */
export interface ProcessDetail {
  pid: number
  ppid?: number
  name?: string
  state?: string
  threads?: number
  exe?: string
  cwd?: string
  cmdline?: string
  startTime?: string
  fd?: ProcessFdInfo
  vmRss?: string
  vmSize?: string
  cpuTicks?: string
  voluntaryCtxSwitches?: number | null
  nonvoluntaryCtxSwitches?: number | null
  io?: ProcessIoInfo
}

/** One row of the listening-ports table. */
export interface PortInfo {
  protocol: string
  localAddr: string
  process: string
}

/** One row of the disks table (also used for the perf disk sub-list). */
export interface DiskInfo {
  name: string
  type?: string
  mountPoint?: string
  size?: string
  used?: string
  total?: string
  usage?: number
  media?: string
  fsType?: string
  uuid?: string
  vendor?: string
  model?: string
}

/** One row of the network-cards table. */
export interface NetCardInfo {
  name: string
  state?: string
  mac?: string
  speed?: string
  type?: string
  bondMaster?: string
  ipAddrs?: string[]
  bondSlaves?: string[]
}

/** Per-core CPU usage entry in the perf payload. */
export interface CpuCoreInfo {
  core: number
  usage: number
}

/** Per-NIC throughput entry in the perf payload. */
export interface NetStatInfo {
  name: string
  rx: number
  tx: number
}

/** One row of the services table. */
export interface ServiceInfo {
  name: string
  active?: string
  enabled?: string
  description?: string
}

/** Service detail payload returned by GetServiceDetail. */
export interface ServiceDetail {
  Description?: string
  LoadState?: string
  SubState?: string
  ActiveState?: string
  UnitFileState?: string
  ExecMainPID?: string
  MemoryCurrent?: string | number
}

/** One row of the hardware devices table. */
export interface DeviceInfo {
  id: string
  class?: string
  vendor?: string
  product?: string
  driver?: string
  serial?: string
  capacity?: string
  rev?: string
  category?: string
}

/** Tree node used by the device tree-table (group header or leaf device). */
export interface DeviceTreeNode {
  rowKey: string
  isGroup?: boolean
  category?: string
  count?: number
  children?: DeviceTreeNode[]
  id?: string
  class?: string
  vendor?: string
  product?: string
  driver?: string
  serial?: string
  capacity?: string
  rev?: string
}

/** IPMI FRU identity card. */
export interface FruInfo {
  product?: string
  manufacturer?: string
  serial?: string
  partNumber?: string
}

/** IPMI LAN channel key/value pair. */
export interface LanInfo {
  key: string
  value: string
}

/** One IPMI sensor reading. */
export interface SensorInfo {
  name: string
  value: string
  unit?: string
  status: string
  source?: string
}

/** Hardware sensors payload returned by GetHardwareSensors. */
export interface HardwareSensors {
  hasIpmi?: boolean
  sensors: SensorInfo[]
}

/** System info payload delivered via the session:data `system` event. */
export interface SystemInfo {
  user?: string
  uptimeSec?: number
  os?: string
  version?: string
  kernel?: string
  hostname?: string
  localIP?: string
  cpuModel?: string
  cores?: number
  arch?: string
  cpuFreq?: number
  memTotal?: number
  diskTotal?: string
  timezone?: string
  epochSec?: number
}

/** Minimal shape of an Element Plus table instance used for DOM access. */
export interface ElTableInstance {
  $el?: HTMLElement | null
}

/** Shape of the live CPU performance payload (session:data `performance`). */
export interface CpuPerf {
  usage: number
  total: number
  user: number
  system: number
  iowait: number
  cores: number
  processes: number
  handles: number
  load1: string | number
  load5: string | number
  load15: string | number
}

/** Shape of the live memory performance payload. */
export interface MemPerf {
  total: number
  used: number
  free: number
  usage: number
  cached: number
  buffers: number
}

/** Shape of the live swap performance payload. */
export interface SwapPerf {
  total: number
  used: number
  usage: number
}

/** Shape of the live disk performance payload. */
export interface DiskPerf {
  total: string
  used: string
  usage: number
}

/** Shape of the live network performance payload. */
export interface NetPerf {
  rx: number
  tx: number
  rxTotal: number
  txTotal: number
}

/** Shape of the process-list summary payload. */
export interface ProcessSummaryCpu {
  usage: number
  cores: number
  processes: number
  load1: string | number
  load5: string | number
  load15: string | number
}

/** Shape of the process-list memory summary payload. */
export interface ProcessSummaryMem {
  total: number
  used: number
  free: number
  usage: number
  cached: number
  buffers: number
}