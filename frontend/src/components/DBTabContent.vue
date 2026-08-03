<template>
  <div class="db-tab-content">
    <div class="db-main">
      <div class="db-left" :style="{ width: leftWidth + 'px' }">
        <DBTreePanel
          ref="treeRef"
          :session-id="sessionId"
          :default-db-name="defaultDbName"
          :active-db="activeDb"
          :active-table="activeTable"
          @select-table="onSelectTable"
          @open-database="onOpenDatabase"
          @view-structure="onViewStructure"
          @new-query="onNewQuery"
          @object-removed="onObjectRemoved"
        />
      </div>
      <div class="db-resizer" @mousedown="onResizeStart" />
      <div class="db-right">
        <div v-if="docs.length === 0" class="db-placeholder">
          <span>{{ t('db.selectTableHint') }}</span>
        </div>
        <template v-else>
          <div class="doc-tabs">
            <div class="doc-tabs-scroll">
              <button
                v-for="doc in docs"
                :key="doc.id"
                class="doc-tab"
                :class="{ active: doc.id === activeDocId }"
                @click="activateDoc(doc.id)"
                @auxclick.middle.prevent="closeDoc(doc.id)"
                @contextmenu.prevent="onDocTabContextMenu($event, doc.id)"
              >
                <span class="doc-tab-title" :title="docTitle(doc)">{{ docTitle(doc) }}</span>
                <span class="doc-tab-close" @click.stop="closeDoc(doc.id)">×</span>
              </button>
            </div>
            <button class="doc-tab-new" :title="t('db.newQuery')" @click="onNewQuery()">+</button>
          </div>

          <Teleport to="body">
            <div
              v-if="ctxVisible"
              class="doc-ctx-menu"
              :style="{ left: ctxX + 'px', top: ctxY + 'px' }"
              @click.stop
              @contextmenu.prevent
            >
              <div class="doc-ctx-item" @click="onCtxClose">{{ t('tab.close') }}</div>
              <div class="doc-ctx-item" :class="{ disabled: !canCloseOthers }" @click="onCtxCloseOthers">{{ t('tab.closeOther') }}</div>
              <div class="doc-ctx-item" :class="{ disabled: !canCloseLeft }" @click="onCtxCloseLeft">{{ t('tab.closeLeft') }}</div>
              <div class="doc-ctx-item" :class="{ disabled: !canCloseRight }" @click="onCtxCloseRight">{{ t('tab.closeRight') }}</div>
              <div class="doc-ctx-sep" />
              <div class="doc-ctx-item" @click="onCtxCloseAll">{{ t('tab.closeAll') }}</div>
            </div>
          </Teleport>

          <div
            v-for="doc in docs"
            v-show="doc.id === activeDocId"
            :key="doc.id"
            class="doc-pane"
          >
            <!-- Table document: data | structure -->
            <template v-if="doc.kind === 'table'">
              <div class="db-subtabs">
                <button
                  class="db-tab"
                  :class="{ active: doc.subTab === 'data' }"
                  @click="doc.subTab = 'data'"
                >
                  {{ t('db.dataQuery') }}
                </button>
                <button
                  v-if="!doc.isView"
                  class="db-tab"
                  :class="{ active: doc.subTab === 'structure' }"
                  @click="openStructureSub(doc)"
                >
                  {{ t('db.tableStructure') }}
                </button>
              </div>
              <div class="db-right-top-content">
                <DBQueryEditor
                  v-show="doc.subTab === 'data'"
                  :session-id="sessionId"
                  :table-name="doc.tableName"
                  :db-name="doc.dbName"
                  :db-type="dbType"
                  :primary-keys="doc.primaryKeys"
                  :table-columns="doc.tableColumns"
                  :is-view="doc.isView"
                />
                <DBTableStructure
                  v-show="doc.subTab === 'structure' && !doc.isView"
                  :session-id="sessionId"
                  :db-name="doc.dbName"
                  :table-name="doc.tableName"
                  :load-trigger="doc.structureLoadTrigger"
                  @schema-loaded="(pks) => onSchemaLoaded(doc, pks)"
                />
              </div>
            </template>

            <!-- Database query -->
            <template v-else-if="doc.kind === 'db-query'">
              <div class="db-subtabs db-subtabs-actions">
                <span class="db-subtabs-label">{{ doc.dbName || t('db.newQuery') }}</span>
                <div class="db-subtabs-right">
                  <button
                    v-if="doc.dbName"
                    class="btn btn-ghost btn-sm"
                    @click="onOpenDatabase(doc.dbName, 'objects')"
                  >
                    {{ t('db.tableList') }}
                  </button>
                  <button
                    v-if="doc.dbName"
                    class="btn btn-ghost btn-sm"
                    @click="treeRef?.refreshDb(doc.dbName)"
                  >
                    {{ t('db.refreshTables') }}
                  </button>
                </div>
              </div>
              <div class="db-right-top-content">
                <DBQueryEditor
                  :session-id="sessionId"
                  :db-name="doc.dbName"
                  :db-type="dbType"
                  :auto-run="false"
                />
              </div>
            </template>

            <!-- Database objects -->
            <template v-else-if="doc.kind === 'db-objects'">
              <div class="db-subtabs db-subtabs-actions">
                <span class="db-subtabs-label">{{ doc.dbName }} · {{ t('db.tableList') }}</span>
                <div class="db-subtabs-right">
                  <button class="btn btn-ghost btn-sm" @click="onOpenDatabase(doc.dbName, 'query')">
                    {{ t('db.dataQuery') }}
                  </button>
                </div>
              </div>
              <div class="db-right-top-content">
                <DBObjectList
                  :session-id="sessionId"
                  :db-name="doc.dbName"
                  @open="onSelectTable"
                  @changed="onObjectsChanged"
                  @object-removed="onObjectRemoved"
                />
              </div>
            </template>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../i18n'
import DBTreePanel from './DBTreePanel.vue'
import DBTableStructure from './DBTableStructure.vue'
import DBQueryEditor from './DBQueryEditor.vue'
import DBObjectList from './DBObjectList.vue'
import { GetTableSchema } from '../../wailsjs/go/main/App'
import type { ColumnInfo } from '../types/database'

defineOptions({ name: 'DBTabContent' })

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  hostName?: string
  defaultDbName?: string
  dbType?: string
}>()

type DocKind = 'table' | 'db-query' | 'db-objects'

interface DocTab {
  id: string
  kind: DocKind
  dbName: string
  tableName: string
  isView: boolean
  subTab: 'data' | 'structure'
  primaryKeys: string[]
  tableColumns: ColumnInfo[]
  structureLoadTrigger: number
}

const docs = ref<DocTab[]>([])
const activeDocId = ref('')
const treeRef = ref<InstanceType<typeof DBTreePanel> | null>(null)
let docSeq = 0

const activeDoc = computed(() => docs.value.find(d => d.id === activeDocId.value) || null)
const activeDb = computed(() => activeDoc.value?.dbName || '')
const activeTable = computed(() => (activeDoc.value?.kind === 'table' ? activeDoc.value.tableName : '') || '')

const leftWidth = ref(220)
let resizeStartX = 0
let resizeStartWidth = 0
let resizing = false

function nextId(prefix: string) {
  docSeq += 1
  return `${prefix}-${docSeq}`
}

function docTitle(doc: DocTab): string {
  if (doc.kind === 'table') return doc.tableName
  if (doc.kind === 'db-objects') return `${doc.dbName} · ${t('db.tableList')}`
  if (doc.dbName) return `${doc.dbName} · ${t('db.dataQuery')}`
  return t('db.newQuery')
}

function activateDoc(id: string) {
  activeDocId.value = id
}

function closeDoc(id: string) {
  const idx = docs.value.findIndex(d => d.id === id)
  if (idx < 0) return
  docs.value.splice(idx, 1)
  if (activeDocId.value === id) {
    const next = docs.value[Math.min(idx, docs.value.length - 1)]
    activeDocId.value = next?.id || ''
  }
}

const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxDocId = ref('')

const ctxIndex = computed(() => docs.value.findIndex(d => d.id === ctxDocId.value))
const canCloseOthers = computed(() => docs.value.length > 1)
const canCloseLeft = computed(() => ctxIndex.value > 0)
const canCloseRight = computed(() => ctxIndex.value >= 0 && ctxIndex.value < docs.value.length - 1)

function closeContextMenu() {
  ctxVisible.value = false
}

function onDocTabContextMenu(e: MouseEvent, id: string) {
  e.stopPropagation()
  ctxDocId.value = id
  const doc = docs.value.find(d => d.id === id)
  if (doc?.kind === 'table') {
    doc.subTab = 'data'
  }
  activateDoc(id)
  const menuW = 180
  const menuH = 180
  let left = e.clientX
  let top = e.clientY
  if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 4
  if (top + menuH > window.innerHeight) top = window.innerHeight - menuH - 4
  ctxX.value = Math.max(4, left)
  ctxY.value = Math.max(4, top)
  ctxVisible.value = true
}

function onCtxClose() {
  if (ctxDocId.value) closeDoc(ctxDocId.value)
  closeContextMenu()
}

function onCtxCloseOthers() {
  if (!canCloseOthers.value) return
  const keep = ctxDocId.value
  docs.value = docs.value.filter(d => d.id === keep)
  activeDocId.value = keep
  closeContextMenu()
}

function onCtxCloseLeft() {
  const idx = ctxIndex.value
  if (idx <= 0) return
  const keepId = activeDocId.value
  docs.value = docs.value.filter((_, i) => i >= idx)
  if (!docs.value.find(d => d.id === keepId)) {
    activeDocId.value = docs.value[0]?.id || ''
  }
  closeContextMenu()
}

function onCtxCloseRight() {
  const idx = ctxIndex.value
  if (idx < 0 || idx >= docs.value.length - 1) return
  const keepId = activeDocId.value
  docs.value = docs.value.filter((_, i) => i <= idx)
  if (!docs.value.find(d => d.id === keepId)) {
    activeDocId.value = docs.value[docs.value.length - 1]?.id || ''
  }
  closeContextMenu()
}

function onCtxCloseAll() {
  docs.value = []
  activeDocId.value = ''
  closeContextMenu()
}

function findTableDoc(dbName: string, tableName: string) {
  return docs.value.find(d => d.kind === 'table' && d.dbName === dbName && d.tableName === tableName)
}

function findDbDoc(kind: 'db-query' | 'db-objects', dbName: string) {
  return docs.value.find(d => d.kind === kind && d.dbName === dbName)
}

async function loadSchema(doc: DocTab) {
  try {
    const schema = await GetTableSchema(props.sessionId, doc.dbName, doc.tableName)
    doc.tableColumns = schema.columns
    doc.primaryKeys = schema.columns.filter(c => c.isPrimary).map(c => c.name)
  } catch { /* ignore */ }
}

async function onSelectTable(dbName: string, tableName: string, isView = false) {
  const existing = findTableDoc(dbName, tableName)
  if (existing) {
    existing.subTab = 'data'
    activateDoc(existing.id)
    return
  }
  const doc: DocTab = {
    id: nextId('table'),
    kind: 'table',
    dbName,
    tableName,
    isView,
    subTab: 'data',
    primaryKeys: [],
    tableColumns: [],
    structureLoadTrigger: 0,
  }
  docs.value.push(doc)
  activateDoc(doc.id)
  await loadSchema(doc)
}

async function onViewStructure(dbName: string, tableName: string) {
  const existing = findTableDoc(dbName, tableName)
  if (existing) {
    existing.isView = false
    openStructureSub(existing)
    activateDoc(existing.id)
    return
  }
  const doc: DocTab = {
    id: nextId('table'),
    kind: 'table',
    dbName,
    tableName,
    isView: false,
    subTab: 'structure',
    primaryKeys: [],
    tableColumns: [],
    structureLoadTrigger: 1,
  }
  docs.value.push(doc)
  activateDoc(doc.id)
  await loadSchema(doc)
}

function openStructureSub(doc: DocTab) {
  doc.subTab = 'structure'
  doc.structureLoadTrigger += 1
}

function onOpenDatabase(dbName: string, tab: 'query' | 'objects' = 'objects') {
  // Prefer objects list when opening a database; only open query when explicitly requested.
  const kind: DocKind = tab === 'query' ? 'db-query' : 'db-objects'
  const existing = findDbDoc(kind, dbName)
  if (existing) {
    activateDoc(existing.id)
    return
  }
  // If opening objects while a query tab for same db is active, still create objects (do not reuse query).
  const doc: DocTab = {
    id: nextId(kind),
    kind,
    dbName,
    tableName: '',
    isView: false,
    subTab: 'data',
    primaryKeys: [],
    tableColumns: [],
    structureLoadTrigger: 0,
  }
  docs.value.push(doc)
  activateDoc(doc.id)
}

function onNewQuery(dbName?: string) {
  const db = dbName || activeDb.value || props.defaultDbName || ''
  const doc: DocTab = {
    id: nextId('query'),
    kind: 'db-query',
    dbName: db,
    tableName: '',
    isView: false,
    subTab: 'data',
    primaryKeys: [],
    tableColumns: [],
    structureLoadTrigger: 0,
  }
  docs.value.push(doc)
  activateDoc(doc.id)
}

function onSchemaLoaded(doc: DocTab, pks: string[]) {
  doc.primaryKeys = pks
}

function onObjectsChanged(dbName: string) {
  treeRef.value?.refreshDb(dbName)
}

function onObjectRemoved(payload: { dbName: string; tableName?: string; kind: 'table' | 'view' | 'database' }) {
  treeRef.value?.refreshDb(payload.dbName)
  if (payload.kind === 'database') {
    docs.value = docs.value.filter(d => d.dbName !== payload.dbName)
    if (!docs.value.find(d => d.id === activeDocId.value)) {
      activeDocId.value = docs.value[0]?.id || ''
    }
    return
  }
  if (payload.tableName) {
    const toClose = docs.value.filter(
      d => d.kind === 'table' && d.dbName === payload.dbName && d.tableName === payload.tableName
    )
    for (const d of toClose) closeDoc(d.id)
  }
}

function onResizeStart(e: MouseEvent) {
  resizeStartX = e.clientX
  resizeStartWidth = leftWidth.value
  resizing = true
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  const dx = e.clientX - resizeStartX
  leftWidth.value = Math.max(150, Math.min(500, resizeStartWidth + dx))
}

function onResizeEnd() {
  resizing = false
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}

onMounted(() => {
  document.addEventListener('click', closeContextMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', closeContextMenu)
  if (resizing) {
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
  }
})
</script>

<style scoped>
.db-tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.db-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.db-left {
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  overflow: hidden;
}
.db-resizer {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s ease;
}
.db-resizer:hover {
  background: var(--border-subtle);
}
.db-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.doc-tabs {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  flex-shrink: 0;
  min-height: 32px;
}
.doc-tabs-scroll {
  display: flex;
  flex: 1;
  overflow-x: auto;
  min-width: 0;
}
.doc-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 6px 8px 6px 12px;
  border: none;
  border-right: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 12px;
  flex-shrink: 0;
}
.doc-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.doc-tab.active {
  background: var(--bg-base);
  color: var(--text-primary);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.doc-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-tab-close {
  width: 16px;
  height: 16px;
  line-height: 14px;
  border-radius: 3px;
  font-size: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.doc-tab-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.doc-tab-new {
  width: 32px;
  border: none;
  border-left: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
  flex-shrink: 0;
}
.doc-tab-new:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.doc-ctx-menu {
  position: fixed;
  z-index: 10000;
  min-width: 160px;
  padding: 4px 0;
  background-color: var(--bg-surface) !important;
  opacity: 1 !important;
  backdrop-filter: none !important;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
}
.doc-ctx-item {
  padding: 6px 12px;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}
.doc-ctx-item:hover:not(.disabled) {
  background: var(--bg-hover);
}
.doc-ctx-item.disabled {
  opacity: 0.4;
  cursor: default;
}
.doc-ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--border-subtle);
}
.doc-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.db-subtabs {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--border-subtle);
  padding: 0 8px;
  flex-shrink: 0;
  min-height: 32px;
}
.db-subtabs-actions {
  justify-content: space-between;
}
.db-subtabs-label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  padding: 0 8px;
}
.db-subtabs-right {
  display: flex;
  gap: 4px;
}
.db-tab {
  padding: 6px 16px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 13px;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}
.db-tab:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.db-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
}
.db-right-top-content {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
  width: 100%;
}
.db-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: 14px;
}
</style>
