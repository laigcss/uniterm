<template>
  <div class="db-query-editor">
    <div v-if="loading" class="loading-overlay">
      <div class="loading-box">
        <div class="spinner" />
        <span class="loading-text">{{ t('db.loading') }}</span>
        <button class="btn btn-default" @click="onCancelQuery">{{ t('common.cancel') }}</button>
      </div>
    </div>
    <div class="editor-top" :style="{ height: topHeight + 'px' }">
      <div class="editor-toolbar">
        <input
          v-model="nlInput"
          class="nl-input"
          :placeholder="t('mongodb.aiPlaceholder')"
          @keydown.enter="generateSQL"
        />
        <button class="btn btn-default btn-sm" @click="generateSQL" :disabled="aiGenerating || !nlInput.trim()">
          <Sparkles :size="14" :class="{ 'ai-pulse': aiGenerating }" />
          {{ aiGenerating ? '...' : 'AI' }}
        </button>
        <button class="btn btn-default btn-sm" @click="historyOpen = !historyOpen">
          <History :size="14" />
          {{ t('db.queryHistory') }}
        </button>
        <button class="btn btn-primary btn-sm" @click="onExecute">{{ t('db.execute') }}</button>
        <span class="shortcut-hint">Ctrl/⌘+Enter</span>
      </div>
      <div v-if="historyOpen" class="history-panel">
        <div v-if="history.length === 0" class="history-empty">{{ t('db.noHistory') }}</div>
        <button
          v-for="item in history"
          :key="item.id"
          class="history-item"
          @click="applyHistory(item)"
        >
          <span class="history-sql">{{ item.sql }}</span>
          <span class="history-meta">
            <span v-if="item.error" class="history-err">err</span>
            <span v-else>{{ item.rowCount ?? 0 }} {{ t('db.rows') }}</span>
            · {{ item.durationMs }}ms
          </span>
        </button>
      </div>
      <div class="sql-editor-wrap">
        <SyntaxEditor
          ref="editorRef"
          v-model="sql"
          file-path="query.sql"
          compact
          @execute="onExecute"
        />
      </div>
    </div>
    <div class="editor-resizer" @mousedown="onResizeStart" />
    <div class="editor-bottom">
      <div v-if="error" class="error-msg">{{ error }}</div>
      <div v-if="execResult" class="result-info">
        {{ t('db.affectedRows') }}: {{ execResult.affected }}
        <span v-if="lastDurationMs != null" class="result-duration"> · {{ lastDurationMs }}ms</span>
      </div>

      <div v-if="queryResult" class="result-toolbar">
        <input
          v-model="resultFilter"
          class="result-filter"
          :placeholder="t('db.filterResults')"
        />
        <div class="result-toolbar-right">
          <span class="result-count">
            {{ displayRows.length }}{{ resultFilter ? ` / ${queryResult.rows.length}` : '' }} {{ t('db.rows') }}
            <span v-if="lastDurationMs != null"> · {{ lastDurationMs }}ms</span>
          </span>
          <el-pagination
            v-if="browseMode"
            small
            background
            layout="sizes, prev, pager, next"
            :total="browsePageTotal"
            :page-size="pageSize"
            :current-page="page + 1"
            :page-sizes="[100, 200, 500]"
            @current-change="onPageChange"
            @size-change="onPageSizeChange"
          />
        </div>
      </div>

      <div v-if="queryResult" class="result-grid">
        <el-table
          :data="displayRows"
          border
          size="small"
          style="width:100%"
          :empty-text="t('db.noData')"
          @cell-dblclick="onCellDblClick"
          @sort-change="onSortChange"
        >
          <el-table-column
            v-if="canEditRows"
            :label="t('db.actions')"
            width="120"
            fixed="right"
          >
            <template #default="{ row }">
              <button class="btn btn-ghost btn-icon btn-sm" title="Edit" @click="startEditRow(rowIndexOf(row))"><Pencil :size="14" /></button>
              <button class="btn btn-ghost btn-icon btn-sm danger" title="Delete" @click="onDeleteRow(rowIndexOf(row))"><Trash2 :size="14" /></button>
            </template>
          </el-table-column>
          <el-table-column
            v-for="col in queryResult.columns"
            :key="col.name"
            :prop="col.name"
            :label="col.name"
            min-width="100"
            sortable="custom"
            show-overflow-tooltip
          >
            <template #default="{ row, column }">
              <div
                v-if="editingCell && editingCell.rowIndex === rowIndexOf(row) && editingCell.colName === column.property"
                class="cell-edit-wrap"
              >
                <input
                  ref="cellInputEl"
                  v-model="editingCell.value"
                  class="cell-edit-input"
                  @keydown.enter="onCellEditConfirm"
                  @keydown.escape="onCellEditCancel"
                  @blur="onCellEditConfirm"
                />
              </div>
              <span v-else-if="row[column.property] === null" class="cell-null">NULL</span>
              <span v-else class="cell-value">{{ row[column.property] }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="queryResult && tableName && !isView" class="insert-row-bar">
        <button class="btn btn-primary" @click="startInsertRow">{{ t('db.insertRow') }}</button>
      </div>

      <div v-if="insertingRow" class="insert-row-form">
        <div class="insert-row-fields">
          <div v-for="col in insertColumns" :key="col" class="insert-field">
            <div class="field-label-row">
              <label>{{ col }} <span class="col-type-hint">{{ getColumnType(col) }}</span></label>
              <label v-if="isColumnAuto(col)" class="null-toggle"><input type="checkbox" v-model="insertAutoIncrement[col]" /> {{ t('db.autoIncrement') }}</label>
              <label v-else-if="!isColumnPrimary(col) && getColumnNullable(col)" class="null-toggle"><input type="checkbox" v-model="insertNulls[col]" /> NULL</label>
            </div>
            <input v-model="insertValues[col]" class="insert-input" :disabled="insertNulls[col] || insertAutoIncrement[col]" :placeholder="getColumnPlaceholder(col)" />
          </div>
        </div>
        <div class="insert-actions">
          <button class="btn btn-primary" @click="onInsertConfirm">{{ t('common.confirm') }}</button>
          <button class="btn btn-default" @click="onInsertCancel">{{ t('common.cancel') }}</button>
        </div>
      </div>

      <div v-if="editingRow" class="insert-row-form">
        <div class="insert-row-fields">
          <div v-for="col in editRowColumns" :key="col" class="insert-field">
            <div class="field-label-row">
              <label>{{ col }} <span class="col-type-hint">{{ getColumnType(col) }}</span></label>
              <label v-if="!isColumnPrimary(col) && getColumnNullable(col)" class="null-toggle"><input type="checkbox" v-model="editNulls[col]" /> NULL</label>
            </div>
            <input v-model="editRowValues[col]" class="insert-input" :disabled="editNulls[col]" />
          </div>
        </div>
        <div class="insert-actions">
          <button class="btn btn-primary" @click="onEditRowConfirm">{{ t('common.save') }}</button>
          <button class="btn btn-default" @click="onEditRowCancel">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, nextTick, onMounted } from 'vue'
import { Pencil, Trash2, Sparkles, History } from '@lucide/vue'
import { ElMessageBox } from 'element-plus'
import { useI18n } from '../i18n'
import SyntaxEditor from './SyntaxEditor.vue'
import { ExecuteQuery, ExecuteStatement, GetTables, GetTableSchema, DBDefaultTableQuery, DBInsertRow, DBUpdateRow, DBDeleteRow } from '../../wailsjs/go/main/App'
import { chat } from '../services/llm'
import { msg } from '../services/message'
import { loadSqlHistory, pushSqlHistory } from '../composables/useDbSqlHistory'
import type { QueryResult, ExecResult, ColumnInfo, HistoryEntry } from '../types/database'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  sessionId: string
  tableName?: string
  dbName?: string
  dbType?: string
  primaryKeys?: string[]
  tableColumns?: ColumnInfo[]
  isView?: boolean
  autoRun?: boolean
}>(), {
  autoRun: true,
})

const emit = defineEmits<{
  cellUpdated: []
}>()

const sql = ref('')
const nlInput = ref('')
const aiGenerating = ref(false)
const queryResult = shallowRef<QueryResult | null>(null)
const execResult = ref<ExecResult | null>(null)
const error = ref('')
const loading = ref(false)
const lastDurationMs = ref<number | null>(null)
const editorRef = ref<InstanceType<typeof SyntaxEditor> | null>(null)
let cancelled = false

const page = ref(0)
const pageSize = ref(100)
const browseMode = ref(false)
const browseHasMore = ref(false)
const resultFilter = ref('')
const sortProp = ref('')
const sortOrder = ref<'ascending' | 'descending' | null>(null)

const historyOpen = ref(false)
const history = ref<HistoryEntry[]>([])

const canEditRows = computed(() => {
  if (!props.tableName || !props.primaryKeys?.length || !queryResult.value) return false
  const resultCols = new Set(queryResult.value.columns.map(c => c.name))
  return props.primaryKeys.every(pk => resultCols.has(pk))
})

const displayRows = computed(() => {
  let rows = queryResult.value?.rows || []
  const q = resultFilter.value.trim().toLowerCase()
  if (q) {
    rows = rows.filter(row =>
      Object.values(row).some(v => v != null && String(v).toLowerCase().includes(q))
    )
  }
  if (sortProp.value && sortOrder.value) {
    const prop = sortProp.value
    const dir = sortOrder.value === 'ascending' ? 1 : -1
    rows = [...rows].sort((a, b) => {
      const av = a[prop]
      const bv = b[prop]
      if (av == null && bv == null) return 0
      if (av == null) return -1 * dir
      if (bv == null) return 1 * dir
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir
    })
  }
  return rows
})

const browsePageTotal = computed(() => {
  const rows = queryResult.value?.rows.length ?? 0
  if (browseHasMore.value) return (page.value + 1) * pageSize.value + 1
  return page.value * pageSize.value + rows
})

function refreshHistory() {
  history.value = loadSqlHistory(props.sessionId)
}

function applyHistory(item: HistoryEntry) {
  sql.value = item.sql
  browseMode.value = false
  historyOpen.value = false
}

function firstStatement(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(';').map(s => s.trim()).filter(Boolean)
  return parts[0] || trimmed
}

function isQuerySql(text: string): boolean {
  const stmt = firstStatement(text)
  return /^\s*(WITH|SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|PRAGMA)\b/i.test(stmt)
}

function normalizeSql(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

async function loadBrowseSql(offset = 0) {
  if (!props.tableName) return
  sql.value = await DBDefaultTableQuery(
    props.sessionId,
    props.dbName || '',
    props.tableName,
    pageSize.value,
    offset,
  )
  browseMode.value = true
}

watch(() => props.tableName, async (name) => {
  insertingRow.value = false
  editingRow.value = false
  if (!name) return
  page.value = 0
  await loadBrowseSql(0)
  if (props.autoRun) await onExecute()
})

onMounted(async () => {
  refreshHistory()
  if (!props.tableName) return
  page.value = 0
  await loadBrowseSql(0)
  if (props.autoRun) await onExecute()
})

async function generateSQL() {
  const input = nlInput.value.trim()
  if (!input) return
  aiGenerating.value = true
  error.value = ''
  try {
    const dbType = props.dbType || 'MySQL'
    const dbName = props.dbName || 'unknown'

    let tables: Array<{ name: string; type?: string }> = []
    try {
      tables = await GetTables(props.sessionId, dbName)
    } catch { /* ignore */ }

    // Pick relevant tables: current table, names mentioned in the prompt, else first 12.
    const lower = input.toLowerCase()
    const mentioned = tables.filter(t => lower.includes(t.name.toLowerCase())).map(t => t.name)
    const preferred: string[] = []
    if (props.tableName) preferred.push(props.tableName)
    for (const n of mentioned) {
      if (!preferred.includes(n)) preferred.push(n)
    }
    if (preferred.length === 0) {
      preferred.push(...tables.slice(0, 12).map(t => t.name))
    }

    const schemas: Record<string, unknown> = {}
    // Prefer already-loaded columns for the active table.
    if (props.tableName && props.tableColumns?.length) {
      schemas[props.tableName] = props.tableColumns.map(c => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        comment: c.comment || undefined,
      }))
    }
    for (const name of preferred.slice(0, 12)) {
      if (schemas[name]) continue
      try {
        const schema = await GetTableSchema(props.sessionId, dbName, name)
        schemas[name] = schema.columns?.map(c => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          comment: c.comment || undefined,
        })) || []
      } catch {
        schemas[name] = []
      }
    }

    const tableList = tables.map(t => t.name).join(', ')
    let result = ''
    await chat({
      system: `You are a SQL assistant for ${dbType}. Convert the user's natural language into ONE executable ${dbType} SQL statement.
Rules:
- Output ONLY raw SQL. No markdown fences, no explanation, no comments.
- Use ${dbType}-specific syntax and identifier quoting.
- For SELECT queries, always include LIMIT 100 (or dialect equivalent such as FETCH/TOP) unless the user asks otherwise.
- Prefer the provided schema. If unsure about a column, pick the closest match from schema.`,
      messages: [
        {
          role: 'user',
          content: `Database: ${dbName}
All tables: ${tableList || '(unknown)'}
Schema JSON: ${JSON.stringify(schemas)}
${props.tableName ? `Current table: ${props.tableName}\n` : ''}
Request: ${input}`,
        },
      ],
      onChunk: (chunk: string) => { result += chunk },
    })

    const cleaned = result.trim()
      .replace(/^```[\w]*\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim()
    if (!cleaned) {
      throw new Error(t('db.aiEmptyResult'))
    }
    sql.value = cleaned
    browseMode.value = false
    await nextTick()
    editorRef.value?.focus?.()
  } catch (e: any) {
    const message = e?.message || String(e)
    error.value = message
    msg.error(message)
  } finally {
    aiGenerating.value = false
  }
}

async function onExecute() {
  const selected = editorRef.value?.getSelectedOrAll?.() ?? sql.value
  const toRun = selected.trim()
  if (!toRun) return
  error.value = ''
  queryResult.value = null
  execResult.value = null
  loading.value = true
  cancelled = false
  resultFilter.value = ''
  const started = performance.now()

  // If user edited away from browse SQL, leave browse mode
  if (browseMode.value && props.tableName) {
    try {
      const expected = await DBDefaultTableQuery(
        props.sessionId,
        props.dbName || '',
        props.tableName,
        pageSize.value,
        page.value * pageSize.value,
      )
      if (normalizeSql(sql.value) !== normalizeSql(expected) && normalizeSql(toRun) !== normalizeSql(expected)) {
        browseMode.value = false
      }
    } catch { /* ignore */ }
  }

  try {
    if (isQuerySql(toRun)) {
      const result = await ExecuteQuery(props.sessionId, props.dbName || '', firstStatement(toRun))
      if (!cancelled) {
        queryResult.value = result
        browseHasMore.value = browseMode.value && result.rows.length >= pageSize.value
        lastDurationMs.value = Math.round(performance.now() - started)
        history.value = pushSqlHistory(props.sessionId, {
          sql: toRun,
          executedAt: new Date().toISOString(),
          durationMs: lastDurationMs.value,
          rowCount: result.rows.length,
        })
      }
    } else {
      const result = await ExecuteStatement(props.sessionId, props.dbName || '', toRun)
      if (!cancelled) {
        execResult.value = result
        lastDurationMs.value = Math.round(performance.now() - started)
        history.value = pushSqlHistory(props.sessionId, {
          sql: toRun,
          executedAt: new Date().toISOString(),
          durationMs: lastDurationMs.value,
          rowCount: result.affected,
        })
      }
    }
  } catch (e: any) {
    if (!cancelled) {
      error.value = e?.message || String(e)
      lastDurationMs.value = Math.round(performance.now() - started)
      history.value = pushSqlHistory(props.sessionId, {
        sql: toRun,
        executedAt: new Date().toISOString(),
        durationMs: lastDurationMs.value,
        error: error.value,
      })
    }
  } finally {
    loading.value = false
  }
}

function onCancelQuery() {
  cancelled = true
  loading.value = false
}

async function onPageChange(p: number) {
  page.value = Math.max(0, p - 1)
  await loadBrowseSql(page.value * pageSize.value)
  await onExecute()
}

async function onPageSizeChange(size: number) {
  pageSize.value = size
  page.value = 0
  await loadBrowseSql(0)
  await onExecute()
}

function onSortChange(payload: { prop: string; order: 'ascending' | 'descending' | null }) {
  sortProp.value = payload.prop || ''
  sortOrder.value = payload.order
}

function rowIndexOf(row: Record<string, any>): number {
  return queryResult.value?.rows.indexOf(row) ?? -1
}

// ── Resize splitter ──

const topHeight = ref(200)
let resizeStartY = 0
let resizeStartHeight = 0

function onResizeStart(e: MouseEvent) {
  resizeStartY = e.clientY
  resizeStartHeight = topHeight.value
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  const dy = e.clientY - resizeStartY
  const el = document.querySelector('.db-query-editor') as HTMLElement
  const maxTop = el ? el.clientHeight - 100 : 600
  topHeight.value = Math.max(100, Math.min(maxTop, resizeStartHeight + dy))
}

function onResizeEnd() {
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}

// ── Inline cell editing ──

interface EditingCell {
  rowIndex: number
  colName: string
  originalValue: any
  value: string
}

const editingCell = ref<EditingCell | null>(null)
const cellInputEl = ref<HTMLInputElement | null>(null)
let cellConfirming = false

function onCellDblClick(row: any, column: any) {
  if (!canEditRows.value) return
  const colName = column.property
  const originalValue = row[colName]
  editingCell.value = {
    rowIndex: rowIndexOf(row),
    colName,
    originalValue,
    value: originalValue ?? ''
  }
  nextTick(() => {
    const el = Array.isArray(cellInputEl.value) ? cellInputEl.value[0] : cellInputEl.value
    el?.focus()
    el?.select()
  })
}

async function onCellEditConfirm() {
  if (cellConfirming) return
  if (!editingCell.value || !props.tableName || !props.primaryKeys) return
  cellConfirming = true

  const { rowIndex, colName, originalValue, value } = editingCell.value
  if (value === String(originalValue ?? '')) {
    editingCell.value = null
    cellConfirming = false
    return
  }

  const row = queryResult.value!.rows[rowIndex]
  const where: Record<string, any> = {}
  for (const pk of props.primaryKeys) {
    where[pk] = row[pk] ?? null
  }

  try {
    await DBUpdateRow(props.sessionId, props.dbName || '', props.tableName, { [colName]: value }, where)
    const updatedRow = { ...queryResult.value!.rows[rowIndex], [colName]: value }
    queryResult.value = {
      ...queryResult.value!,
      rows: queryResult.value!.rows.map((r, i) => i === rowIndex ? updatedRow : r)
    }
    error.value = ''
    emit('cellUpdated')
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
  editingCell.value = null
  cellConfirming = false
}

function onCellEditCancel() {
  editingCell.value = null
}

async function onDeleteRow(rowIndex: number) {
  if (rowIndex < 0 || !props.tableName || !props.primaryKeys || props.primaryKeys.length === 0) return

  try {
    await ElMessageBox.confirm(t('db.deleteRowConfirm'), t('common.confirm'), {
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    })
  } catch {
    return
  }

  const row = queryResult.value!.rows[rowIndex]
  const where: Record<string, any> = {}
  for (const pk of props.primaryKeys) {
    where[pk] = row[pk] ?? null
  }

  try {
    await DBDeleteRow(props.sessionId, props.dbName || '', props.tableName, where)
    queryResult.value = {
      ...queryResult.value!,
      rows: queryResult.value!.rows.filter((_, i) => i !== rowIndex)
    }
    error.value = ''
    emit('cellUpdated')
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

const insertingRow = ref(false)
const insertValues = ref<Record<string, string>>({})
const insertNulls = ref<Record<string, boolean>>({})
const insertAutoIncrement = ref<Record<string, boolean>>({})
const insertColumns = ref<string[]>([])

async function startInsertRow() {
  let cols: ColumnInfo[]
  try {
    const schema = await GetTableSchema(props.sessionId, props.dbName || '', props.tableName || '')
    cols = schema.columns
  } catch {
    cols = queryResult.value!.columns.map(c => ({ name: c.name, type: c.type, nullable: true, defaultVal: '', defaultType: 'none', isPrimary: false, collation: '', comment: '', onUpdate: false }))
  }
  insertColumns.value = cols.map(c => c.name)
  insertNulls.value = {}
  insertAutoIncrement.value = {}
  insertValues.value = {}
  for (const col of cols) {
    if (col.defaultType === 'auto') {
      insertAutoIncrement.value[col.name] = true
      insertNulls.value[col.name] = false
      insertValues.value[col.name] = ''
    } else {
      const isNullDefault = col.defaultType === 'null' || (col.nullable && col.defaultType === 'none')
      insertNulls.value[col.name] = isNullDefault
      const rawDefault = col.defaultType === 'value' ? (col.defaultVal ?? '') : ''
      insertValues.value[col.name] = rawDefault === "''" ? '' : rawDefault
    }
  }
  editingRow.value = false
  insertingRow.value = true
}

async function onInsertConfirm() {
  if (!props.tableName) return

  const includedCols = insertColumns.value.filter(c => !insertAutoIncrement.value[c])
  const values: Record<string, any> = {}
  for (const col of includedCols) {
    values[col] = insertNulls.value[col] ? null : (insertValues.value[col] ?? '')
  }

  try {
    await DBInsertRow(props.sessionId, props.dbName || '', props.tableName, values)
    error.value = ''
    insertingRow.value = false
    emit('cellUpdated')
    await onExecute()
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

function onInsertCancel() {
  insertingRow.value = false
}

function getColumnType(colName: string): string {
  return props.tableColumns?.find(c => c.name === colName)?.type ?? ''
}

function isColumnPrimary(colName: string): boolean {
  return props.tableColumns?.find(c => c.name === colName)?.isPrimary ?? false
}

function isColumnAuto(colName: string): boolean {
  if (props.tableColumns) {
    const col = props.tableColumns.find(c => c.name === colName)
    if (col) return col.defaultType === 'auto'
  }
  return insertAutoIncrement.value[colName] === true
}

function getColumnNullable(colName: string): boolean {
  return props.tableColumns?.find(c => c.name === colName)?.nullable ?? true
}

function getColumnPlaceholder(colName: string): string {
  const val = props.tableColumns?.find(c => c.name === colName)?.defaultVal ?? ''
  return val === "''" ? '' : val
}

const editingRow = ref(false)
const editingRowIndex = ref(-1)
const editRowValues = ref<Record<string, string>>({})
const editNulls = ref<Record<string, boolean>>({})
const editRowColumns = ref<string[]>([])

function startEditRow(rowIndex: number) {
  if (rowIndex < 0) return
  editingRowIndex.value = rowIndex
  const row = queryResult.value!.rows[rowIndex]
  editRowColumns.value = queryResult.value!.columns.map(c => c.name)
  editRowValues.value = {}
  editNulls.value = {}
  for (const col of editRowColumns.value) {
    if (row[col] === null) {
      editRowValues.value[col] = ''
      editNulls.value[col] = true
    } else {
      editRowValues.value[col] = String(row[col] ?? '')
      editNulls.value[col] = false
    }
  }
  insertingRow.value = false
  editingRow.value = true
}

async function onEditRowConfirm() {
  if (!props.tableName) return
  if (!props.primaryKeys || props.primaryKeys.length === 0) {
    error.value = t('db.noPrimaryKey')
    return
  }
  if (editingRowIndex.value < 0) return

  const row = queryResult.value!.rows[editingRowIndex.value]
  const set: Record<string, any> = {}
  for (const col of editRowColumns.value) {
    if (editNulls.value[col]) {
      if (row[col] !== null) set[col] = null
    } else {
      const newVal = editRowValues.value[col] ?? ''
      const oldVal = String(row[col] ?? '')
      if (newVal !== oldVal) set[col] = newVal
    }
  }
  if (Object.keys(set).length === 0) {
    editingRow.value = false
    return
  }

  const where: Record<string, any> = {}
  for (const pk of props.primaryKeys) {
    where[pk] = row[pk] ?? null
  }

  try {
    await DBUpdateRow(props.sessionId, props.dbName || '', props.tableName, set, where)
    const idx = editingRowIndex.value
    const updatedRow = { ...queryResult.value!.rows[idx] }
    for (const col of editRowColumns.value) {
      updatedRow[col] = editNulls.value[col] ? null : editRowValues.value[col]
    }
    queryResult.value = {
      ...queryResult.value!,
      rows: queryResult.value!.rows.map((r, i) => i === idx ? updatedRow : r)
    }
    error.value = ''
    editingRow.value = false
    emit('cellUpdated')
  } catch (e: any) {
    error.value = e?.message || String(e)
  }
}

function onEditRowCancel() {
  editingRow.value = false
}
</script>

<style scoped>
.db-query-editor {
  height: 100%;
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.loading-overlay {
  position: absolute;
  inset: 0;
  background: var(--scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.loading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.loading-text {
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--text-primary);
}
.editor-top {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 8px 8px 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}
.editor-toolbar {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  align-items: center;
  flex-shrink: 0;
}
.sql-editor-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 80px;
  min-width: 0;
  width: 100%;
  align-self: stretch;
  overflow: hidden;
}
.shortcut-hint {
  font-family: var(--font-ui);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}
.nl-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 13px;
  outline: none;
}
.nl-input:focus { border-color: var(--accent); }
.nl-input::placeholder { color: var(--text-muted); }
.ai-pulse { animation: fade-pulse 1.2s ease-in-out infinite; }
@keyframes fade-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.history-panel {
  max-height: 140px;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  margin-bottom: 6px;
  flex-shrink: 0;
}
.history-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-muted);
}
.history-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
}
.history-item:hover { background: var(--bg-hover); }
.history-sql {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.history-meta {
  font-family: var(--font-ui);
  font-size: 11px;
  color: var(--text-muted);
}
.history-err { color: var(--error); }
.editor-resizer {
  height: 4px;
  cursor: row-resize;
  background: transparent;
  flex-shrink: 0;
}
.editor-resizer:hover { background: var(--border-subtle); }
.editor-bottom {
  flex: 1;
  padding: 0 8px 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.error-msg {
  color: var(--error);
  padding: 8px;
  background: var(--error-subtle);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
  user-select: text;
  font-family: var(--font-mono);
  font-size: 13px;
  flex-shrink: 0;
}
.result-info {
  padding: 4px 0;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.result-duration { color: var(--text-muted); }
.result-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  flex-shrink: 0;
}
.result-filter {
  width: 200px;
  padding: 3px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}
.result-filter:focus { border-color: var(--accent); }
.result-toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.result-grid { flex: 1; overflow: auto; display: flex; flex-direction: column; min-height: 0; }
.result-count {
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.cell-value { cursor: default; }
.cell-null {
  color: var(--text-muted);
  font-style: italic;
}
.cell-edit-wrap { margin: -8px -12px; }
.cell-edit-input {
  width: 100%;
  padding: 4px 8px;
  border: 2px solid var(--accent);
  border-radius: var(--radius-sm);
  font-family: var(--font-ui);
  font-size: 13px;
  outline: none;
}
.insert-row-bar { padding: 4px 0; flex-shrink: 0; }
.insert-row-form {
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 8px;
  margin-top: 4px;
  flex-shrink: 0;
  overflow: auto;
  max-height: 40%;
}
.insert-row-fields { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.insert-field { display: flex; flex-direction: column; gap: 2px; }
.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.field-label-row label {
  font-family: var(--font-ui);
  font-size: 11px;
  color: var(--text-secondary);
}
.null-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  cursor: pointer;
  color: var(--text-muted);
}
.null-toggle input { cursor: pointer; margin: 0; }
.insert-input {
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-ui);
  font-size: 13px;
  width: 140px;
  background: var(--bg-base);
  color: var(--text-primary);
}
.insert-input:disabled {
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: not-allowed;
}
.col-type-hint {
  font-size: 10px;
  color: var(--text-muted);
}
.insert-actions { display: flex; gap: 8px; }
</style>
