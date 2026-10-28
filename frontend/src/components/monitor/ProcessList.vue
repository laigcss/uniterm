<template>
  <div class="tab-pane processes-pane">
    <div class="process-toolbar">
      <div class="process-summary">
        <div class="summary-item">
          <span class="summary-label">CPU</span>
          <span class="summary-value">{{ summaryCpu.usage }}%</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ t('monitor.memory') }}</span>
          <span class="summary-value">{{ summaryMem.usage }}%</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ t('monitor.total') }}</span>
          <span class="summary-value">{{ summaryMem.total.toFixed(2) }} GB</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ t('monitor.used') }}</span>
          <span class="summary-value">{{ summaryMem.used.toFixed(2) }} GB</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ t('monitor.free') }}</span>
          <span class="summary-value">{{ summaryMem.free.toFixed(2) }} GB</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ t('monitor.processCount') }}</span>
          <span class="summary-value">{{ summaryCpu.processes }}</span>
        </div>
      </div>
      <div class="process-actions">
        <el-button :type="paused ? 'primary' : 'default'" @click="emit('toggle-pause')">
          {{ paused ? t('monitor.resume') : t('monitor.pause') }}
        </el-button>
      </div>
    </div>
    <el-input v-model="search" :placeholder="t('monitor.searchProcess')" clearable class="process-search" />
    <el-table
      ref="tableRef"
      :data="visible"
      size="small"
      border
      height="calc(100% - 2.5rem)"
      class="process-table"
      @sort-change="onSortChange"
      @row-click="onRowClick"
    >
      <el-table-column prop="pid" label="PID" sortable="custom" :width="uiPx(80)" />
      <el-table-column prop="name" :label="t('monitor.processName')" sortable="custom" />
      <el-table-column prop="user" :label="t('monitor.user')" sortable="custom" :width="uiPx(100)" />
      <el-table-column prop="state" :label="t('monitor.state')" sortable="custom" :width="uiPx(80)">
        <template #default="{ row }">{{ row.state ? String(row.state)[0] : '-' }}</template>
      </el-table-column>
      <el-table-column prop="cpu" :label="t('monitor.cpu')" sortable="custom" :width="uiPx(90)">
        <template #default="{ row }">{{ row.cpu }}%</template>
      </el-table-column>
      <el-table-column prop="mem" :label="t('monitor.mem')" sortable="custom" :width="uiPx(90)">
        <template #default="{ row }">{{ row.mem }}%</template>
      </el-table-column>
      <el-table-column :label="''" :width="uiPx(86)" align="center" class-name="proc-act-cell">
        <template #default="{ row }">
          <el-button size="small" @click.stop="emit('signal', row, $event)">
            {{ t('monitor.sendSignal') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from '../../i18n'
import { uiPx } from '../../utils/uiScale'
import type { ProcessRow, ProcessSummaryCpu, ProcessSummaryMem, ElTableInstance } from './monitorTypes'

const props = defineProps<{
  processes: ProcessRow[]
  summaryCpu: ProcessSummaryCpu
  summaryMem: ProcessSummaryMem
  paused: boolean
}>()

const emit = defineEmits<{
  'toggle-pause': []
  'row-click': [row: ProcessRow]
  signal: [row: ProcessRow, event: MouseEvent]
}>()

defineOptions({ name: 'ProcessList' })

const { t } = useI18n()
const search = ref('')

// --- Process table ----------------------------------------------------------
// The poll now delivers the FULL process list, which can be thousands of rows.
// Like the SFTP file list, only a bounded slice is handed to el-table and it
// grows as the user scrolls near the bottom; search and sort always operate
// on the complete list.
const PAGE_SIZE = 200
const NEAR_BOTTOM_PX = 300

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.processes
  return props.processes.filter((p: ProcessRow) =>
    String(p.name).toLowerCase().includes(q) ||
    String(p.user).toLowerCase().includes(q) ||
    String(p.pid).includes(q)
  )
})

// Client-side sort over the full (filtered) list; el-table's own sort would
// only order the rendered slice.
const sortState = ref<{ prop: string; order: string } | null>(null)

function onSortChange({ prop, order }: { prop: string; order: string | null }) {
  sortState.value = order ? { prop, order } : null
}

const sorted = computed(() => {
  const list = [...filtered.value]
  const s = sortState.value
  if (!s) return list
  const dir = s.order === 'descending' ? -1 : 1
  return list.sort((a: ProcessRow, b: ProcessRow) => {
    const av = a[s.prop]
    const bv = b[s.prop]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av ?? '').localeCompare(String(bv ?? '')) * dir
  })
})

const visiblePages = ref(1)
const visible = computed(() => sorted.value.slice(0, visiblePages.value * PAGE_SIZE))

const tableRef = ref<ElTableInstance | null>(null)
let scrollWrapEl: HTMLElement | null = null

function bindScroll() {
  const el = (tableRef.value?.$el ?? null) as HTMLElement | null
  scrollWrapEl = el?.querySelector('.el-scrollbar__wrap') ?? null
  if (scrollWrapEl && !scrollWrapEl.dataset.lazyBinded) {
    scrollWrapEl.dataset.lazyBinded = '1'
    scrollWrapEl.addEventListener('scroll', onScroll, { passive: true })
  }
}

function onScroll() {
  // Defer to the next frame so the threshold is computed against the scroll
  // height AFTER any just-triggered batch has been added to the DOM.
  requestAnimationFrame(loadMoreIfNeeded)
}

function loadMoreIfNeeded() {
  if (!scrollWrapEl) return
  const { scrollTop, clientHeight, scrollHeight } = scrollWrapEl
  if (scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_PX) {
    visiblePages.value += 1
  }
}

// New search text restarts at the top. Incoming poll data must NOT reset the
// scroll position, so this watches only the filter.
watch(search, () => {
  visiblePages.value = 1
})

onMounted(() => {
  // Progressive process list: grow the rendered slice on scroll.
  bindScroll()
})

function onRowClick(row: ProcessRow) {
  emit('row-click', row)
}
</script>

<style scoped>
.tab-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.processes-pane {
  flex-direction: column;
  padding: 0.75rem;
}
.process-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  flex-shrink: 0;
}
.process-summary {
  display: flex;
  gap: 1.25rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  flex: 1;
}
.summary-item {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 3.75rem;
  justify-content: center;
}
.summary-label {
  font-size: 0.625rem;
  color: var(--text-muted);
  font-family: var(--font-ui);
  text-transform: uppercase;
  height: 0.875rem;
  line-height: 0.875rem;
}
.summary-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-mono);
}
.process-actions {
  flex-shrink: 0;
}
.process-search {
  width: 17.5rem;
  margin-bottom: 0.5rem;
  flex-shrink: 0;
}
.process-table {
  flex: 1;
  min-height: 0;
}
.process-table :deep(.el-table__row) {
  cursor: pointer;
}
</style>