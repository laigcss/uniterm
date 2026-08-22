<template>
  <div
    class="db-result-grid"
    :class="{ 'is-rowing': dragging }"
    tabindex="0"
    @mousedown="onGridMouseDown"
    @keydown="onGridKeydown"
  >
    <vxe-table
      :key="tableKey"
      ref="tableRef"
      border
      show-overflow
      keep-source
      height="100%"
      size="mini"
      class="db-vxe-table"
      :data="rows"
      :row-config="{ isHover: true, isCurrent: false }"
      :column-config="{ resizable: true }"
      :sort-config="{ trigger: 'cell', remote: true }"
      :edit-config="editConfig"
      :empty-text="emptyText"
      @edit-activated="onEditActivated"
      @edit-closed="onEditClosed"
      @cell-dblclick="onCellDblClick"
      @sort-change="onSortChange"
    >
      <vxe-column type="seq" width="44" fixed="left" title="#" :resizable="false" />

      <vxe-column
        v-if="canEdit"
        field="_actions"
        :title="actionsLabel"
        width="72"
        fixed="left"
        :resizable="false"
      >
        <template #default="{ row }">
          <div class="row-actions" @mousedown.stop @click.stop>
            <button
              type="button"
              class="btn btn-ghost btn-icon btn-sm"
              :title="editLabel"
              @click.stop.prevent="emit('edit-row', row)"
            >
              <Pencil :size="14" />
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-icon btn-sm danger"
              :title="deleteLabel"
              @click.stop.prevent="emit('delete-row', row)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </template>
      </vxe-column>

      <vxe-column
        v-for="col in columns"
        :key="col.name"
        :field="col.name"
        :title="colTitle(col)"
        min-width="110"
        sortable
        :edit-render="editRender"
      >
        <template #default="{ row }">
          <span v-if="row[col.name] === null" class="cell-null">NULL</span>
          <span v-else class="cell-value">{{ formatCell(row[col.name]) }}</span>
        </template>
        <template #edit="{ row }">
          <div class="db-cell-edit" @mousedown.stop>
            <input
              class="db-cell-input"
              :value="draftValue"
              :placeholder="row[col.name] === null || draftIsNull ? 'NULL' : ''"
              @input="onDraftInput(($event.target as HTMLInputElement).value)"
              @keydown="onEditKeydown"
            />
            <button
              v-if="isNullable(col.name)"
              type="button"
              class="null-btn"
              title="NULL (Ctrl/⌘+0)"
              @mousedown.prevent
              @click.prevent="setDraftNull"
            >
              N
            </button>
          </div>
        </template>
      </vxe-column>
    </vxe-table>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Pencil, Trash2 } from '@lucide/vue'
import type { QueryResultColumn, ColumnInfo } from '../types/database'

const props = defineProps<{
  rows: Record<string, any>[]
  columns: QueryResultColumn[]
  canEdit: boolean
  primaryKeys?: string[]
  tableColumns?: ColumnInfo[]
  emptyText?: string
  actionsLabel?: string
  editLabel?: string
  deleteLabel?: string
}>()

const emit = defineEmits<{
  'cell-commit': [payload: {
    row: Record<string, any>
    field: string
    newValue: any
    oldValue: any
  }]
  'edit-row': [row: Record<string, any>]
  'delete-row': [row: Record<string, any>]
  'sort-change': [payload: { field: string; order: 'asc' | 'desc' | null }]
}>()

type TableApi = {
  clearEdit?: (row?: any) => Promise<any>
  revertData?: (row: any, field?: string) => any
  setEditCell?: (row: any, field: string) => Promise<any>
  getRowid?: (row: any) => string
  $el?: HTMLElement
}

const tableRef = ref<TableApi | null>(null)
const draftValue = ref('')
const draftIsNull = ref(false)

/** Selected row object refs */
const selected = ref<Record<string, any>[]>([])
const dragging = ref(false)
let anchorIndex = -1
let dragStartIndex = -1
let mouseDown = false

interface EditSnap {
  row: Record<string, any>
  field: string
  oldValue: any
}
let snap: EditSnap | null = null
let committing = false
let cancelling = false

const tableKey = computed(() => `edit-${props.canEdit ? 1 : 0}-cols-${props.columns.map(c => c.name).join('|')}`)
const editRender = { enabled: true }

const editConfig = computed(() => ({
  enabled: true,
  trigger: 'dblclick' as const,
  mode: 'cell' as const,
  showStatus: props.canEdit,
  autoClear: true,
  showIcon: false,
  autoFocus: true,
  beforeEditMethod({ column }: { column: { field?: string } }) {
    if (!props.canEdit) return false
    const field = column.field
    if (!field || field === '_actions') return false
    return props.columns.some(c => c.name === field)
  },
}))

function api(): TableApi | null {
  // Vue may wrap component instance; prefer unwrapped if present
  const raw = tableRef.value as any
  if (!raw) return null
  return (raw.setEditCell || raw.getRowid) ? raw : (raw.$table || raw)
}

function findMeta(colName: string) {
  const lower = colName.toLowerCase()
  return props.tableColumns?.find(c => c.name === colName || c.name.toLowerCase() === lower)
}

function colTitle(col: QueryResultColumn) {
  const meta = findMeta(col.name)
  if (meta?.isPrimary) return `${col.name} 🔑`
  return col.name
}

function isNullable(colName: string) {
  return findMeta(colName)?.nullable ?? true
}

function formatCell(v: any) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

function valuesEqual(a: any, b: any) {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  return String(a) === String(b)
}

function rowIndex(row: Record<string, any>) {
  return props.rows.indexOf(row)
}

function setSelection(rows: Record<string, any>[]) {
  selected.value = rows
  applyDomHighlight()
}

/** VXE won't re-run rowClassName on our state change — paint DOM directly */
function applyDomHighlight() {
  const inst = api() as any
  const root: HTMLElement | undefined = inst?.$el || (tableRef.value as any)?.$el
  if (!root) {
    nextTick(applyDomHighlight)
    return
  }
  const idSet = new Set<string>()
  for (const row of selected.value) {
    const id = inst?.getRowid?.(row)
    if (id != null && id !== '') idSet.add(String(id))
  }
  root.querySelectorAll('tr.vxe-body--row').forEach((tr: Element) => {
    const id = tr.getAttribute('rowid') || ''
    tr.classList.toggle('row--selected', idSet.has(id))
  })
}

function selectRange(from: number, to: number) {
  if (from < 0 || to < 0) return
  const a = Math.min(from, to)
  const b = Math.max(from, to)
  setSelection(props.rows.slice(a, b + 1))
}

function stopDragListeners() {
  window.removeEventListener('mouseup', onWindowMouseUp)
  window.removeEventListener('mousemove', onWindowMouseMove)
}

function onWindowMouseUp() {
  mouseDown = false
  dragging.value = false
  dragStartIndex = -1
  stopDragListeners()
}

function onWindowMouseMove(e: MouseEvent) {
  if (!mouseDown || dragStartIndex < 0 || snap) return
  if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
    onWindowMouseUp()
    return
  }
  // elementFromPoint is reliable while dragging; VXE cell-mouseenter often doesn't fire
  const under = document.elementFromPoint(e.clientX, e.clientY)
  const row = findRowByDom(under)
  if (!row) return
  const idx = rowIndex(row)
  if (idx < 0) return
  if (idx !== dragStartIndex) dragging.value = true
  selectRange(dragStartIndex, idx)
}

function findRowByDom(target: EventTarget | null): Record<string, any> | null {
  const el = target as HTMLElement | null
  if (!el?.closest) return null
  if (el.closest('.row-actions') || el.closest('.db-cell-edit') || el.closest('input,textarea,button')) return null
  const tr = el.closest('tr.vxe-body--row') as HTMLElement | null
  if (!tr) return null
  const rowid = tr.getAttribute('rowid')
  if (rowid == null) return null
  const inst = api()
  for (const row of props.rows) {
    if (String(inst?.getRowid?.(row) ?? '') === rowid) return row
  }
  return null
}

function onGridMouseDown(e: MouseEvent) {
  if (e.button !== 0 || snap) return
  if (e.detail >= 2) return // dblclick → edit

  const row = findRowByDom(e.target)
  if (!row) return

  const idx = rowIndex(row)
  if (idx < 0) return

  mouseDown = true
  dragStartIndex = idx
  stopDragListeners()
  window.addEventListener('mouseup', onWindowMouseUp)
  window.addEventListener('mousemove', onWindowMouseMove)

  if (e.shiftKey && anchorIndex >= 0) {
    selectRange(anchorIndex, idx)
    return
  }
  if (e.ctrlKey || e.metaKey) {
    const exists = selected.value.includes(row)
    setSelection(exists ? selected.value.filter(r => r !== row) : [...selected.value, row])
    anchorIndex = idx
    return
  }

  setSelection([row])
  anchorIndex = idx
}

function onDraftInput(v: string) {
  draftIsNull.value = false
  draftValue.value = v
  if (snap) snap.row[snap.field] = v
}

function setDraftNull() {
  draftIsNull.value = true
  draftValue.value = ''
  if (snap) snap.row[snap.field] = null
}

function blurActive() {
  ;(document.activeElement as HTMLElement | null)?.blur()
}

function onEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    blurActive()
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    void cancelEdit()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault()
    setDraftNull()
  }
}

async function cancelEdit() {
  if (!snap) return
  cancelling = true
  snap.row[snap.field] = snap.oldValue
  await api()?.clearEdit?.()
  snap = null
  cancelling = false
}

function onEditActivated({ row, column }: { row: Record<string, any>; column: { field?: string } }) {
  const field = column.field
  if (!field || field === '_actions') return
  snap = { row, field, oldValue: row[field] }
  draftIsNull.value = row[field] === null
  draftValue.value = row[field] === null || row[field] === undefined ? '' : String(row[field])
  nextTick(() => {
    const root = (api() as any)?.$el as HTMLElement | undefined
    const input = root?.querySelector?.('.db-cell-input') as HTMLInputElement | null
    input?.focus()
    input?.select()
  })
}

async function onEditClosed({ row, column }: { row: Record<string, any>; column: { field?: string } }) {
  if (cancelling || committing) {
    snap = null
    return
  }
  const field = column.field
  if (!field || !snap || snap.row !== row || snap.field !== field) {
    snap = null
    return
  }

  const oldValue = snap.oldValue
  const newValue = draftIsNull.value ? null : row[field]
  snap = null
  if (draftIsNull.value) row[field] = null

  if (valuesEqual(oldValue, newValue)) {
    row[field] = oldValue
    return
  }

  committing = true
  try {
    emit('cell-commit', { row, field, newValue, oldValue })
  } finally {
    committing = false
  }
}

function onCellDblClick(params: { row: Record<string, any>; column?: { field?: string } }) {
  if (!props.canEdit) return
  const field = params.column?.field
  if (!field || field === '_actions') return
  void api()?.setEditCell?.(params.row, field)
}

function onSortChange(params: any) {
  const field = params?.field || params?.property || ''
  const order = params?.order === 'asc' || params?.order === 'desc' ? params.order : null
  emit('sort-change', { field, order })
}

function copySelectedRows() {
  const list = selected.value.length
    ? props.rows.filter(r => selected.value.includes(r))
    : []
  if (!list.length || !props.columns.length) return
  const header = props.columns.map(c => c.name).join('\t')
  const lines = list.map(row =>
    props.columns.map(c => {
      const v = row[c.name]
      if (v === null || v === undefined) return 'NULL'
      return String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
    }).join('\t')
  )
  const text = [header, ...lines].join('\n')
  void navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  })
}

function onGridKeydown(e: KeyboardEvent) {
  if (snap) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    setSelection([...props.rows])
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    if (!selected.value.length) return
    e.preventDefault()
    copySelectedRows()
  }
}

function revertCell(row: Record<string, any>, field: string, oldValue: any) {
  row[field] = oldValue
  api()?.revertData?.(row, field)
}

watch(() => props.rows, () => {
  selected.value = []
  applyDomHighlight()
})

onBeforeUnmount(() => {
  stopDragListeners()
})

defineExpose({
  revertCell,
  clearEdit: () => api()?.clearEdit?.(),
  getSelectedRows: () => selected.value.slice(),
})
</script>

<style scoped>
.db-result-grid {
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
  outline: none;
}
.db-result-grid.is-rowing {
  user-select: none;
  cursor: default;
}
.db-vxe-table {
  --vxe-ui-font-color: var(--text-primary);
  --vxe-ui-font-primary-color: var(--accent);
  --vxe-ui-layout-background-color: var(--bg-surface);
  --vxe-ui-table-header-background-color: var(--bg-elevated, var(--bg-surface));
  --vxe-ui-table-body-background-color: var(--bg-surface);
  --vxe-ui-table-border-color: var(--border-subtle);
  --vxe-ui-table-header-font-color: var(--text-secondary);
  --vxe-ui-table-row-hover-background-color: var(--bg-hover);
  --vxe-ui-table-column-hover-background-color: var(--bg-hover);
  --vxe-ui-table-cell-dirty-width: 5px;
  --vxe-ui-input-background-color: var(--bg-base);
  --vxe-ui-input-border-color: var(--accent);
  height: 100%;
}
.db-vxe-table :deep(tr.vxe-body--row.row--selected > td),
.db-vxe-table :deep(tr.vxe-body--row.row--selected > .vxe-body--column),
.db-vxe-table :deep(tr.vxe-body--row.row--selected:hover > td),
.db-vxe-table :deep(tr.vxe-body--row.row--selected:hover > .vxe-body--column) {
  background-color: var(--accent-subtle) !important;
}
.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.row-actions :deep(svg) { pointer-events: none; }
.cell-null {
  color: var(--text-muted);
  font-style: italic;
}
.cell-value {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}
.db-cell-edit {
  display: flex;
  align-items: stretch;
  width: 100%;
  gap: 2px;
}
.db-cell-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--accent);
  border-radius: 2px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  outline: none;
}
.null-btn {
  flex-shrink: 0;
  width: 22px;
  border: 1px solid var(--border-subtle);
  border-radius: 2px;
  background: var(--bg-elevated, var(--bg-hover));
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  font-style: italic;
}
.null-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}
</style>
