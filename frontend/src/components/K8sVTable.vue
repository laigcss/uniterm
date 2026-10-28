<template>
  <!-- 虚拟化表格：固定表头 + RecycleScroller 行虚拟滚动。
       排序/列筛选状态由本组件内部管理；列定义和数据由父组件传入。
       操作列通过 #actions slot 由父组件填充。 -->
  <div class="k8s-vtable" v-loading="loading">
    <div class="k8s-vtable-head">
      <div
        v-for="col in columns"
        :key="col.header"
        class="k8s-vtable-th"
        :class="{ sortable: col.sortable, 'is-sorted': sortKey === col.header }"
        :style="{ flex: colFlex(col) }"
        @click="toggleSort(col)"
      >
        <span class="k8s-vtable-th-text">{{ col.header }}</span>
        <span v-if="col.sortable && sortKey === col.header" class="k8s-vtable-sort">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
        <el-popover v-if="col.filterable" trigger="click" placement="bottom-start" :width="200" popper-class="k8s-col-filter-pop">
          <template #reference>
            <span class="k8s-vtable-filter" :class="{ active: colFilterActive(col) }" @click.stop>▾</span>
          </template>
          <div class="k8s-col-filter-panel">
            <el-checkbox-group
              :model-value="colFilterSel[col.header] || []"
              @update:model-value="(v: string[]) => setColFilter(col.header, v)"
            >
              <el-checkbox v-for="v in enumValues(col)" :key="v" :value="v">{{ v }}</el-checkbox>
            </el-checkbox-group>
            <div class="k8s-col-filter-foot">
              <el-button size="small" text @click="clearColFilter(col)">{{ resetText }}</el-button>
            </div>
          </div>
        </el-popover>
      </div>
      <div v-if="actionWidth" class="k8s-vtable-th k8s-vtable-action" :style="{ flex: '0 0 ' + actionWidth + 'px' }">{{ actionsLabel }}</div>
    </div>

    <div v-if="!loading && scrollerItems.length === 0" class="k8s-vtable-empty">{{ emptyText }}</div>

    <RecycleScroller
      v-else
      :items="scrollerItems"
      :item-size="rowHeight"
      key-field="key"
      class="k8s-vtable-body"
      v-slot="{ item }"
    >
      <div class="k8s-vtable-row" :class="rowClassFn?.(item.row) || ''" @click="emit('row-click', item.row)">
        <div
          v-for="col in columns"
          :key="col.header"
          class="k8s-vtable-td"
          :style="{ flex: colFlex(col) }"
          :title="col.getText(item.row)"
        ><span class="k8s-vtable-cell">{{ col.getText(item.row) }}</span></div>
        <div v-if="actionWidth" class="k8s-vtable-td k8s-vtable-action" :style="{ flex: '0 0 ' + actionWidth + 'px' }">
          <slot name="actions" :row="item.row" />
        </div>
      </div>
    </RecycleScroller>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { uiPx } from '../utils/uiScale'
import { ElCheckbox, ElButton } from 'element-plus'
import { type VCol, VROW_HEIGHT } from './k8sVTableShared'

// ── props / emits ──────────────────────────────────────────────
const props = withDefaults(defineProps<{
  columns: VCol[]
  rows: any[]
  loading?: boolean
  emptyText?: string
  actionsLabel?: string
  actionWidth?: number
  rowHeight?: number
  rowClassFn?: (row: any) => string
  rowKeyFn?: (row: any, i: number) => string
  resetText?: string
}>(), {
  loading: false,
  emptyText: '',
  actionsLabel: '',
  actionWidth: 0,
  rowHeight: VROW_HEIGHT,
  resetText: '',
})

const emit = defineEmits<{
  (e: 'row-click', row: any): void
}>()

// ── 排序状态 ──────────────────────────────────────────────────
// sortKey 为列 header，null 表示默认按 name 升序。
const sortKey = ref<string | null>(null)
const sortOrder = ref<'asc' | 'desc'>('asc')
// 列 enum 筛选：header -> 已选值数组
const colFilterSel = ref<Record<string, string[]>>({})

function toggleSort(col: VCol) {
  if (!col.sortable) return
  if (sortKey.value === col.header) {
    // 同列循环：asc → desc → 取消（回到默认 name 升序）
    if (sortOrder.value === 'asc') sortOrder.value = 'desc'
    else { sortKey.value = null; sortOrder.value = 'asc' }
  } else {
    sortKey.value = col.header
    sortOrder.value = 'asc'
  }
}

function enumValues(col: VCol): string[] {
  const set = new Set<string>()
  for (const row of props.rows) set.add(col.getText(row))
  return Array.from(set).filter(Boolean).sort()
}

function colFilterActive(col: VCol): boolean {
  return (colFilterSel.value[col.header]?.length || 0) > 0
}

function setColFilter(header: string, v: string[]) {
  colFilterSel.value = { ...colFilterSel.value, [header]: v }
}

function clearColFilter(col: VCol) {
  const next = { ...colFilterSel.value }
  delete next[col.header]
  colFilterSel.value = next
}

// 把带单位/百分比/时长的文本解析为可比数字；无法解析返回 null（退回文本比较）。
// 覆盖：内存 Ki~Pi、百分比 %、age/duration（30m/5h/3d/10s）、纯数字（含 "1/2" 取前值）。
function numericSortKey(text: string): number | null {
  const s = text.trim()
  if (s === '' || s === '—') return null
  // 百分比
  let m = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/)
  if (m) return parseFloat(m[1])
  // 内存/存储二进制或十进制单位
  m = s.match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E)?i?B?$/)
  if (m && m[2]) {
    const units: Record<string, number> = {
      Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, Ei: 1024 ** 6,
      k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18,
    }
    return parseFloat(m[1]) * (units[m[2]] || 1)
  }
  // age/duration：3d / 5h / 30m / 10s（取最大单位，够用于排序）
  m = s.match(/^(\d+)(d|h|m|s)$/)
  if (m) {
    const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
    return parseInt(m[1], 10) * mult[m[2]]
  }
  // "3/5" 之类比值，按分子排序
  m = s.match(/^(\d+)\s*\/\s*\d+$/)
  if (m) return parseInt(m[1], 10)
  // 纯数字
  const n = parseFloat(s)
  if (!isNaN(n) && String(n) === s) return n
  return null
}

// 单元格比较：优先 sortNum（如 cpu 毫核），否则解析单位/百分比/时长做数值比较，
// 都不行退回 localeCompare。
function vcompare(col: VCol, a: any, b: any): number {
  if (col.sortNum) return col.sortNum(a) - col.sortNum(b)
  const ta = col.getText(a)
  const tb = col.getText(b)
  const na = numericSortKey(ta)
  const nb = numericSortKey(tb)
  if (na !== null && nb !== null) return na - nb
  if (na !== null) return -1
  if (nb !== null) return 1
  return ta.localeCompare(tb)
}

// 列 enum 筛选 + 排序后的最终列表。
const vtableFinal = computed<any[]>(() => {
  let list = props.rows
  const cols = props.columns
  const filters = colFilterSel.value
  if (cols.some(c => (filters[c.header]?.length || 0) > 0)) {
    list = list.filter(row => cols.every(c => {
      const sel = filters[c.header]
      if (!sel || sel.length === 0) return true
      return sel.includes(c.getText(row))
    }))
  }
  if (sortKey.value) {
    const col = cols.find(c => c.header === sortKey.value)
    if (col) {
      const dir = sortOrder.value === 'asc' ? 1 : -1
      list = list.slice().sort((a, b) => dir * vcompare(col, a, b))
    }
  }
  return list
})

// RecycleScroller 需要顶层 key 字段（K8s 资源 uid 唯一，无 uid 退回 name）。
const scrollerItems = computed(() => vtableFinal.value.map((row, i) => ({
  row,
  key: props.rowKeyFn ? props.rowKeyFn(row, i) : (row.metadata?.uid || row.metadata?.name || `__idx_${i}`),
})))

// 列 flex 基础：有 width 固定，无 width 平分剩余空间。表头与行共用以保证对齐。
function colFlex(col: VCol): string {
  return col.width ? `0 0 ${uiPx(col.width)}px` : '1 1 0'
}
</script>

<style scoped>
.k8s-vtable {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  position: relative;
  font-size: 0.75rem;
}
/* 表头：固定不滚动。overflow-y + scrollbar-gutter 预留与 body 一致的滚动条空间，
   保证表头列与 body 列宽度对齐（body 由 RecycleScroller 管理滚动条）。 */
.k8s-vtable-head {
  display: flex;
  flex-shrink: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  border-bottom: 1px solid var(--el-border-color-lighter, #333);
  background: var(--bg-surface, #1e1e1e);
}
.k8s-vtable-th {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.5rem;
  height: 2rem;
  font-weight: 600;
  color: var(--text-secondary, #888);
  border-right: 1px solid var(--el-border-color-lighter, #333);
  white-space: nowrap;
  overflow: hidden;
  user-select: none;
  box-sizing: border-box;
}
.k8s-vtable-th:last-child {
  border-right: none;
}
.k8s-vtable-th.sortable {
  cursor: pointer;
}
.k8s-vtable-th.sortable:hover {
  color: var(--text-primary, #ddd);
}
.k8s-vtable-th.is-sorted {
  color: var(--el-color-primary, #409eff);
}
.k8s-vtable-th-text {
  overflow: hidden;
  text-overflow: ellipsis;
}
.k8s-vtable-sort {
  font-size: 0.625rem;
}
.k8s-vtable-filter {
  cursor: pointer;
  font-size: 0.625rem;
  color: var(--text-secondary, #888);
  padding: 0 0.125rem;
}
.k8s-vtable-filter:hover,
.k8s-vtable-filter.active {
  color: var(--el-color-primary, #409eff);
}
.k8s-vtable-action {
  justify-content: center;
  flex-shrink: 0;
}

/* RecycleScroller 根元素：占满剩余空间并自行管理滚动 */
.k8s-vtable-body {
  flex: 1;
  min-height: 0;
  scrollbar-gutter: stable;
}
.k8s-vtable-row {
  display: flex;
  align-items: center;
  height: 36px;
  cursor: pointer;
  border-bottom: 1px solid var(--el-border-color-lighter, #333);
  box-sizing: border-box;
}
.k8s-vtable-row:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.05));
}
.k8s-vtable-td {
  padding: 0 0.5rem;
  border-right: 1px solid var(--el-border-color-lighter, #333);
  white-space: nowrap;
  overflow: hidden;
  display: flex;
  align-items: center;
  box-sizing: border-box;
}
.k8s-vtable-td:last-child {
  border-right: none;
}
.k8s-vtable-cell {
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 行着色：非就绪/异常项高亮（对齐 k9s） */
.k8s-vtable-row.k8s-row-warn {
  background: color-mix(in srgb, var(--warning) 16%, var(--bg-surface));
  color: var(--warning);
}
.k8s-vtable-row.k8s-row-err {
  background: color-mix(in srgb, var(--el-color-danger) 14%, var(--bg-surface));
  color: var(--el-color-danger);
}
/* 操作列按钮间距（.btn-icon 1.5rem 方形，来自全局 style.css .btn） */
.k8s-vtable-action .btn-icon + .btn-icon {
  margin-left: 0.25rem;
}
.k8s-vtable-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #888);
  font-size: 0.75rem;
}
</style>

<!-- el-popover 内容 teleport 到 body，scoped 样式不作用，故用全局样式 -->
<style>
.k8s-col-filter-panel .el-checkbox-group {
  display: flex;
  flex-direction: column;
  max-height: 16rem;
  overflow-y: auto;
}
.k8s-col-filter-panel .el-checkbox {
  margin-right: 0;
  height: auto;
  padding: 0.125rem 0;
}
.k8s-col-filter-foot {
  margin-top: 0.375rem;
  padding-top: 0.375rem;
  text-align: right;
  border-top: 1px solid var(--el-border-color-lighter, #333);
}
</style>