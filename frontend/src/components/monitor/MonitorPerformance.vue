<template>
  <div class="tab-pane performance-pane">
    <div class="perf-sidebar">
      <div
        v-for="item in perfItems"
        :key="item.key"
        class="perf-nav-item"
        :class="{ active: selectedPerf === item.key }"
        @click="selectedPerf = item.key"
      >
        <div class="perf-nav-name">{{ item.label }}</div>
        <div class="perf-nav-value" :style="{ color: item.color }">{{ item.value }}</div>
        <div class="perf-nav-bar"><div class="perf-nav-bar-inner" :style="{ width: item.percent + '%', background: item.color }" /></div>
      </div>
    </div>
    <div class="perf-main">
      <div class="perf-big-value" :style="{ color: currentPerf.color }">{{ currentPerf.bigValue }}</div>
      <canvas ref="chartCanvas" class="perf-chart" />
      <div class="perf-details">
        <div v-for="d in currentPerf.details" :key="d.label" class="perf-detail-item">
          <span class="detail-label">{{ d.label }}</span>
          <span class="detail-value">{{ d.value }}</span>
        </div>
      </div>

      <!-- Expandable: all cores / all NICs / all disks -->
      <div class="perf-extras">
        <template v-if="selectedPerf === 'cpu'">
          <div class="perf-sub-toggle" @click="showCores = !showCores">
            <ChevronRight :size="'0.875rem'" class="chev" :class="{ open: showCores }" />
            <span>{{ t('monitor.allCores') }} ({{ cpus.length }})</span>
          </div>
          <div v-if="showCores" class="perf-sub-list">
            <div v-for="c in cpus" :key="c.core" class="perf-sub-row">
              <span class="sub-name">CPU {{ c.core }}</span>
              <div class="sub-bar"><div class="sub-fill" :style="{ width: fmtWidth(c.usage) }" /></div>
              <span class="sub-val">{{ c.usage }}%</span>
            </div>
          </div>
        </template>

        <template v-else-if="selectedPerf === 'network'">
          <div class="perf-sub-toggle" @click="showNets = !showNets">
            <ChevronRight :size="'0.875rem'" class="chev" :class="{ open: showNets }" />
            <span>{{ t('monitor.allNetworks') }} ({{ nets.length }})</span>
          </div>
          <div v-if="showNets" class="perf-sub-list">
            <div v-for="n in nets" :key="n.name" class="perf-sub-row net">
              <span class="sub-name" :title="n.name">{{ n.name }}</span>
              <span class="sub-val">↓{{ formatBytes(n.rx) }}/s</span>
              <span class="sub-val tx">↑{{ formatBytes(n.tx) }}/s</span>
            </div>
          </div>
        </template>

        <template v-else-if="selectedPerf === 'disk'">
          <div class="perf-sub-toggle" @click="toggleDisks">
            <ChevronRight :size="'0.875rem'" class="chev" :class="{ open: showDisks }" />
            <span>{{ t('monitor.allDisks') }} ({{ mountedDisks.length }})</span>
          </div>
          <div v-if="showDisks" class="perf-sub-list">
            <div v-if="diskLoading" class="perf-sub-empty">{{ t('monitor.loading') }}</div>
            <div v-for="d in mountedDisks" v-else :key="d.name + d.mountPoint" class="perf-sub-row disk">
              <span class="sub-name" :title="d.mountPoint || d.name">{{ d.mountPoint || d.name }}</span>
              <div class="sub-bar"><div class="sub-fill" :style="{ width: fmtWidth(d.usage) }" /></div>
              <span class="sub-val">{{ d.used }} / {{ d.total }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { ChevronRight } from '@lucide/vue'
import { useI18n } from '../../i18n'
import { formatBytes } from '../../utils/format'
import { fmtWidth } from '../../composables/useMonitorData'
import type { CpuCoreInfo, CpuPerf, DiskInfo, MemPerf, NetPerf, NetStatInfo, SwapPerf, DiskPerf } from './monitorTypes'

const props = defineProps<{
  currentCpu: CpuPerf
  currentMem: MemPerf
  currentSwap: SwapPerf
  currentDisk: DiskPerf
  currentNet: NetPerf
  cpuHistory: number[]
  memHistory: number[]
  diskHistory: number[]
  netRxHistory: number[]
  netTxHistory: number[]
  cpus: CpuCoreInfo[]
  nets: NetStatInfo[]
  disks: DiskInfo[]
  diskLoading: boolean
  mountedDisks: DiskInfo[]
  perfTick: number
}>()

const emit = defineEmits<{
  'load-perf-disks': []
}>()

defineOptions({ name: 'MonitorPerformance' })

const { t } = useI18n()
const selectedPerf = ref('cpu')
const showCores = ref(false)
const showNets = ref(false)
const showDisks = ref(false)

const chartCanvas = ref<HTMLCanvasElement>()

const perfItems = computed(() => [
  {
    key: 'cpu',
    label: t('monitor.cpu'),
    value: props.currentCpu.usage + '%',
    percent: Math.min(props.currentCpu.usage, 100),
    color: 'var(--chart-1)'
  },
  {
    key: 'memory',
    label: t('monitor.memory'),
    value: props.currentMem.usage + '%',
    percent: Math.min(props.currentMem.usage, 100),
    color: 'var(--chart-2)'
  },
  {
    key: 'disk',
    label: t('monitor.disk'),
    value: props.currentDisk.usage + '%',
    percent: Math.min(props.currentDisk.usage, 100),
    color: 'var(--chart-3)'
  },
  {
    key: 'network',
    label: t('monitor.network'),
    value: formatBytes(props.currentNet.rx + props.currentNet.tx) + '/s',
    percent: Math.min((props.currentNet.rx + props.currentNet.tx) / 1048576 * 100, 100),
    color: 'var(--chart-4)'
  }
])

const currentPerf = computed(() => {
  switch (selectedPerf.value) {
    case 'cpu':
      return {
        bigValue: props.currentCpu.usage + '%',
        color: 'var(--chart-1)',
        history: props.cpuHistory,
        yMin: 0,
        yMax: 100,
        details: [
          { label: t('monitor.cores'), value: String(props.currentCpu.cores) },
          { label: t('monitor.processCount'), value: String(props.currentCpu.processes) },
          { label: t('monitor.handleCount'), value: String(props.currentCpu.handles) },
          { label: t('monitor.load1'), value: String(props.currentCpu.load1 ?? '-') },
          { label: t('monitor.load5'), value: String(props.currentCpu.load5 ?? '-') },
          { label: t('monitor.load15'), value: String(props.currentCpu.load15 ?? '-') },
          { label: t('companion.cpuUser'), value: (props.currentCpu.user ?? 0) + '%' },
          { label: t('companion.cpuSystem'), value: (props.currentCpu.system ?? 0) + '%' },
          { label: t('companion.cpuIowait'), value: (props.currentCpu.iowait ?? 0) + '%' },
          { label: t('companion.cpuTotal'), value: (props.currentCpu.total ?? props.currentCpu.usage ?? 0) + '%' }
        ]
      }
    case 'memory':
      return {
        bigValue: props.currentMem.usage + '%',
        color: 'var(--chart-2)',
        history: props.memHistory,
        yMin: 0,
        yMax: 100,
        details: [
          { label: t('monitor.total'), value: props.currentMem.total.toFixed(2) + ' GB' },
          { label: t('monitor.used'), value: props.currentMem.used.toFixed(2) + ' GB' },
          { label: t('monitor.free'), value: props.currentMem.free.toFixed(2) + ' GB' },
          { label: t('monitor.cached'), value: (props.currentMem.cached?.toFixed(2) ?? '-') + ' GB' },
          { label: t('monitor.buffers'), value: (props.currentMem.buffers?.toFixed(2) ?? '-') + ' GB' },
          { label: t('companion.swapMem'), value: props.currentSwap.total
            ? props.currentSwap.used.toFixed(2) + ' / ' + props.currentSwap.total.toFixed(2) + ' GB (' + (props.currentSwap.usage ?? 0) + '%)'
            : '-' }
        ]
      }
    case 'disk':
      return {
        bigValue: props.currentDisk.usage + '%',
        color: 'var(--chart-3)',
        history: props.diskHistory,
        yMin: 0,
        yMax: 100,
        details: [
          { label: t('monitor.total'), value: props.currentDisk.total },
          { label: t('monitor.used'), value: props.currentDisk.used }
        ]
      }
    case 'network':
      return {
        bigValue: formatBytes(props.currentNet.rx + props.currentNet.tx) + '/s',
        color: 'var(--chart-4)',
        color2: 'var(--chart-4-alt)',
        history: props.netRxHistory,
        history2: props.netTxHistory,
        yMin: 0,
        details: [
          { label: t('monitor.rx'), value: formatBytes(props.currentNet.rx) + '/s' },
          { label: t('monitor.tx'), value: formatBytes(props.currentNet.tx) + '/s' }
        ]
      }
    default:
      return { bigValue: '', color: 'var(--text-primary)', history: [] as number[], details: [] }
  }
})

function toggleDisks() {
  showDisks.value = !showDisks.value
  if (showDisks.value && props.disks.length === 0) {
    emit('load-perf-disks')
  }
}

function resolveColor(cssVar: string): string {
  const match = cssVar.match(/var\((--[\w-]+)\)/)
  if (match) {
    return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim()
  }
  return cssVar
}

function drawChart() {
  const canvas = chartCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const w = rect.width
  const h = rect.height
  const history = currentPerf.value.history
  const history2 = currentPerf.value.history2 as number[] | undefined

  ctx.clearRect(0, 0, w, h)

  if (history.length < 2) return

  const yMin = currentPerf.value.yMin ?? 0
  let yMax = currentPerf.value.yMax
  if (yMax == null) {
    const allVals = [...history]
    if (history2) allVals.push(...history2)
    yMax = Math.max(...allVals, yMin + 1)
  }
  const range = yMax - yMin
  const padding = 4

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 1
  for (let i = 1; i < 5; i++) {
    const y = h - (h * i / 5)
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  const mainColor = resolveColor(currentPerf.value.color)
  const altColor = currentPerf.value.color2 ? resolveColor(currentPerf.value.color2) : null

  // Helper to draw a line
  const ctx2 = ctx
  function drawLine(data: number[], color: string, fill?: boolean) {
    ctx2.strokeStyle = color
    ctx2.lineWidth = 2
    ctx2.beginPath()
    data.forEach((val: number, i: number) => {
      const x = (i / (data.length - 1)) * w
      const normalizedVal = Math.max(Math.min(val, yMax!) - yMin, 0)
      const y = h - padding - ((normalizedVal / range) * (h - padding * 2))
      if (i === 0) ctx2.moveTo(x, y)
      else ctx2.lineTo(x, y)
    })
    ctx2.stroke()

    if (fill) {
      ctx2.fillStyle = color + '20'
      ctx2.beginPath()
      data.forEach((val: number, i: number) => {
        const x = (i / (data.length - 1)) * w
        const normalizedVal = Math.max(Math.min(val, yMax!) - yMin, 0)
        const y = h - padding - ((normalizedVal / range) * (h - padding * 2))
        if (i === 0) ctx2.moveTo(x, y)
        else ctx2.lineTo(x, y)
      })
      ctx2.lineTo(w, h)
      ctx2.lineTo(0, h)
      ctx2.closePath()
      ctx2.fill()
    }
  }

  // Draw second line first (so it appears behind the main line)
  if (history2 && history2.length >= 2) {
    drawLine(history2, altColor || mainColor)
  }

  // Draw main line with fill
  drawLine(history, mainColor, true)
}

// Redraw on history changes, tab switches and every performance payload tick
// (the tick replaces the original nextTick(drawChart) in the session handler).
watch(() => currentPerf.value.history, drawChart, { deep: true })
watch(() => currentPerf.value.history2, drawChart, { deep: true })
watch(selectedPerf, () => nextTick(drawChart))
watch(() => props.perfTick, () => nextTick(drawChart))
</script>

<style scoped>
.tab-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}
/* Performance pane */
.performance-pane {
  display: flex;
}
.perf-sidebar {
  width: 11.25rem;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  padding: 0.5rem;
  overflow-y: auto;
}
.perf-nav-item {
  padding: 0.625rem 0.75rem;
  border-radius: var(--radius-sm);
  margin-bottom: 0.25rem;
  transition: background 0.12s ease;
}
.perf-nav-item:hover {
  background: var(--bg-hover);
}
.perf-nav-item.active {
  background: var(--accent-subtle);
}
.perf-nav-name {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: var(--font-ui);
}
.perf-nav-value {
  font-size: 1.125rem;
  font-weight: 600;
  font-family: var(--font-mono);
  margin: 0.25rem 0;
}
.perf-nav-bar {
  height: 0.25rem;
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.perf-nav-bar-inner {
  height: 100%;
  border-radius: var(--radius-sm);
  transition: width 0.3s ease;
}
.perf-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 1rem 1.25rem;
  overflow-y: auto;
  min-height: 0;
}
.perf-big-value {
  font-size: 3rem;
  font-weight: 700;
  font-family: var(--font-mono);
  margin-bottom: 0.75rem;
}
.perf-chart {
  height: 11.25rem;
  width: 100%;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.perf-details {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: 0.75rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-subtle);
}
.perf-detail-item {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.detail-label {
  font-size: 0.6875rem;
  color: var(--text-muted);
  font-family: var(--font-ui);
}
.detail-value {
  font-size: 0.875rem;
  color: var(--text-primary);
  font-family: var(--font-mono);
  user-select: text;
}
/* Expandable per-core / per-NIC / per-disk lists */
.perf-extras {
  margin-top: 1.125rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-subtle);
}
.perf-sub-toggle {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  user-select: none;
  padding: 0.125rem 0 0.375rem;
}
.perf-sub-toggle:hover { color: var(--text-primary); }
.perf-sub-toggle .chev { transition: transform 0.15s ease; }
.perf-sub-toggle .chev.open { transform: rotate(90deg); }
.perf-sub-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 13.75rem;
  overflow-y: auto;
}
.perf-sub-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  font-size: 0.75rem;
  min-width: 0;
  padding: 1px 0.25rem;
  border-radius: var(--radius-sm);
  transition: background 0.12s ease;
}
.perf-sub-row:hover {
  background: var(--bg-hover);
}
.sub-name {
  flex: 1;
  min-width: 3.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: var(--font-ui);
}
.sub-bar {
  flex: 1;
  height: 0.375rem;
  max-width: 10rem;
  border-radius: 62.4375rem;
  background: var(--bg-hover);
  overflow: hidden;
}
.sub-fill {
  height: 100%;
  border-radius: 62.4375rem;
  background: linear-gradient(90deg, var(--accent), var(--accent-glow));
  transition: width 0.3s ease;
}
.sub-val {
  min-width: 3.5rem;
  text-align: right;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.sub-val.tx { color: #f59e0b; }
.perf-sub-row.net .sub-val {
  width: 6.5rem;
  min-width: 0;
  text-align: right;
  white-space: nowrap;
}
/* Disk rows: fixed name/bar columns so bars and values line up across rows
   regardless of how long the mount point or the used/total string is. */
.perf-sub-row.disk .sub-name {
  flex: 0 0 9rem;
}
.perf-sub-row.disk .sub-bar {
  flex: 0 0 7rem;
  max-width: 7rem;
}
.perf-sub-row.disk .sub-val {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.perf-sub-empty {
  padding: 0.5rem 0;
  color: var(--text-muted);
  font-size: 0.75rem;
}
</style>