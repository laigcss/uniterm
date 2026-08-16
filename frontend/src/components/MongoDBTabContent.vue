<template>
  <div class="mongodb-tab-content" @click="closeContextMenu">
    <div class="mongo-main">
      <!-- Left tree panel -->
      <div class="mongo-left" :style="{ width: leftWidth + 'px' }">
        <div class="search-wrap">
          <input
            v-model="treeSearchQuery"
            class="search-input"
            :placeholder="t('db.searchTables')"
          />
        </div>
        <div class="tree-content" @contextmenu.prevent="onTreeContextMenu">
          <div v-if="treeLoading" class="tree-loading">{{ t('db.loading') }}</div>
          <template v-else>
            <div v-for="db in filteredDatabases" :key="db">
              <div
                class="db-header"
                :class="{ selected: activeTab?.kind === 'query' && activeTab?.dbName === db }"
                @click="toggleDb(db)"
                @contextmenu.prevent="onDbContextMenu($event, db)"
              >
                <span class="db-arrow" @click.stop="toggleDb(db)">
                  <component :is="expandedDbs.has(db) ? ChevronDown : ChevronRight" :size="12" />
                </span>
                <Database :size="14" class="db-icon" />
                <span class="db-name">{{ db }}</span>
              </div>
              <div v-if="expandedDbs.has(db)" class="child-list">
                <div
                  v-for="col in (collections[db] || [])"
                  :key="col"
                  class="table-item"
                  :class="{ selected: activeTab?.kind === 'collection' && activeTab?.dbName === db && activeTab?.collectionName === col }"
                  @dblclick="openCollectionTab(db, col)"
                  @click="highlightedDb = db; highlightedCol = col"
                  @contextmenu.prevent="onColContextMenu($event, db, col)"
                >
                  <span class="table-icon-spacer" />
                  <Layers :size="14" class="table-icon" />
                  <span class="table-name">{{ col }}</span>
                </div>
                <div v-if="!collections[db] || collections[db].length === 0" class="empty-hint">
                  {{ t('mongodb.noData') }}
                </div>
              </div>
            </div>
            <div v-if="filteredDatabases.length === 0 && !treeLoading" class="empty-hint">
              {{ t('mongodb.noData') }}
            </div>
          </template>
        </div>
      </div>

      <!-- Resizer -->
      <div class="mongo-resizer" @mousedown="onResizeStart" />

      <!-- Right content area -->
      <div class="mongo-right">
        <template v-if="tabs.length">
          <!-- Tab bar -->
          <div class="mongo-tab-bar">
            <div class="mongo-tab-scroll">
              <div
                v-for="tab in tabs"
                :key="tab.id"
                class="mongo-tab-item"
                :class="{ active: tab.id === activeTabId }"
                @click="activateTab(tab.id)"
                @middleclick.prevent="closeTab(tab.id)"
              >
                <component :is="tab.kind === 'collection' ? Layers : Database" :size="12" class="tab-icon" />
                <span class="tab-title">{{ tabTitle(tab) }}</span>
                <button class="tab-close" :title="t('db.tabClose')" @click.stop="closeTab(tab.id)">×</button>
              </div>
            </div>
          </div>

          <!-- Panels (keep-alive via v-show) -->
          <div
            v-for="tab in tabs"
            :key="tab.id"
            v-show="tab.id === activeTabId"
            class="mongo-panel"
          >
            <div class="mongo-breadcrumb">
              <span class="crumb crumb-static">{{ tab.dbName }}</span>
              <template v-if="tab.collectionName">
                <span class="crumb-sep">/</span>
                <span class="crumb current">{{ tab.collectionName }}</span>
              </template>
            </div>
            <MongoDBCollectionView
              v-if="tab.kind === 'collection'"
              :session-id="sessionId"
              :db-name="tab.dbName"
              :collection-name="tab.collectionName || ''"
            />
            <div v-else class="db-placeholder">
              <span>{{ t('mongodb.selectHint') }}</span>
            </div>
          </div>
        </template>
        <div v-else class="db-placeholder">
          <span>{{ t('mongodb.selectHint') }}</span>
        </div>
      </div>
    </div>

    <!-- Context menu -->
    <div
      v-if="ctxVisible"
      class="ctx-menu"
      :style="{ left: ctxX + 'px', top: ctxY + 'px' }"
      @click.stop
    >
      <template v-if="ctxTargetType === 'blank'">
        <div class="ctx-item" @click="onCtxNewDatabase">{{ t('db.newDatabase') }}</div>
        <div class="ctx-sep" />
        <div class="ctx-item" @click="onCtxRefresh">{{ t('mongodb.refresh') }}</div>
      </template>
      <template v-else-if="ctxTargetType === 'db'">
        <div class="ctx-item" @click="onCtxOpenQuery">{{ t('mongodb.openQuery') }}</div>
        <div class="ctx-item" @click="onCtxNewCollection">{{ t('mongodb.newCollection') }}</div>
        <div class="ctx-sep" />
        <div class="ctx-item" @click="onCtxRefresh">{{ t('mongodb.refresh') }}</div>
        <div class="ctx-sep" />
        <div class="ctx-item danger" @click="onCtxDropDatabase">{{ t('mongodb.dropDatabase') }}</div>
      </template>
      <template v-else-if="ctxTargetType === 'col'">
        <div class="ctx-item" @click="onCtxOpenColQuery">{{ t('mongodb.openQuery') }}</div>
        <div class="ctx-item" @click="onCtxNewColDocument">{{ t('mongodb.newDocument') }}</div>
        <div class="ctx-item" @click="onCtxViewIndexes">{{ t('mongodb.indexesTab') }}</div>
        <div class="ctx-sep" />
        <div class="ctx-item" @click="onCtxCopyName">{{ t('mongodb.copyName') }}</div>
        <div class="ctx-sep" />
        <div class="ctx-item danger" @click="onCtxDropCollection">{{ t('mongodb.dropCollection') }}</div>
      </template>
    </div>

    <!-- New Collection dialog -->
    <el-dialog append-to-body
      v-model="newColDialogVisible"
      :title="t('mongodb.newCollection')"
      width="380px"
    >
      <el-form label-width="80px">
        <el-form-item :label="t('mongodb.collection')">
          <el-input v-model="newColName" :placeholder="t('mongodb.collection')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <button class="btn btn-default" @click="newColDialogVisible = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!newColName.trim()" @click="createCollection">
          {{ t('common.confirm') }}
        </button>
      </template>
    </el-dialog>

    <!-- New Database dialog -->
    <el-dialog append-to-body v-model="newDbDialogVisible" :title="t('db.newDatabase')" width="380px">
      <el-form label-width="80px">
        <el-form-item :label="t('db.databases')">
          <el-input v-model="newDbName" :placeholder="t('db.databases')" />
        </el-form-item>
        <el-form-item :label="t('mongodb.collection')">
          <el-input v-model="newDbFirstCol" placeholder="optional" />
        </el-form-item>
      </el-form>
      <template #footer>
        <button class="btn btn-default" @click="newDbDialogVisible = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="!newDbName.trim()" @click="createDatabase">
          {{ t('common.confirm') }}
        </button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted, onUnmounted, computed } from 'vue'
import { Database, Layers, ChevronRight, ChevronDown } from '@lucide/vue'
import { ElMessageBox } from 'element-plus'
import { useI18n } from '../i18n'
import { msg } from '../services/message'
import {
  MongoListDatabases,
  MongoListCollections,
  MongoCreateCollection,
  MongoDropCollection,
  MongoDropDatabase,
} from '../../wailsjs/go/main/App'
import MongoDBCollectionView from './MongoDBCollectionView.vue'

defineOptions({ name: 'MongoDBTabContent' })

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
}>()

// ── Resize state ──
const leftWidth = ref(220)
let resizeStartX = 0
let resizeStartWidth = 0
let resizing = false

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

// ── Tree state ──
const databases = ref<string[]>([])
const collections = ref<Record<string, string[]>>({})
const expandedDbs = reactive(new Set<string>())
const treeLoading = ref(false)
const treeSearchQuery = ref('')
const highlightedDb = ref('')
const highlightedCol = ref('')

const filteredDatabases = computed(() => {
  const q = treeSearchQuery.value.trim().toLowerCase()
  if (!q) return databases.value
  return databases.value.filter(db => db.toLowerCase().includes(q))
})

// ── Tabs state ──
interface MongoTab {
  id: number
  kind: 'collection' | 'query'
  dbName: string
  collectionName?: string
}

const tabs = ref<MongoTab[]>([])
const activeTabId = ref<number | null>(null)
let nextTabId = 1

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) || null)

function tabTitle(tab: MongoTab): string {
  return tab.kind === 'collection' ? (tab.collectionName || '') : tab.dbName
}

function activateTab(id: number) {
  activeTabId.value = id
}

function openCollectionTab(dbName: string, collectionName: string) {
  const existing = tabs.value.find(t => t.kind === 'collection' && t.dbName === dbName && t.collectionName === collectionName)
  if (existing) {
    activeTabId.value = existing.id
    return
  }
  const tab: MongoTab = { id: nextTabId++, kind: 'collection', dbName, collectionName }
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

function openQueryTab(dbName: string) {
  const existing = tabs.value.find(t => t.kind === 'query' && t.dbName === dbName)
  if (existing) {
    activeTabId.value = existing.id
    return
  }
  const tab: MongoTab = { id: nextTabId++, kind: 'query', dbName }
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

function closeTab(tabId: number) {
  const idx = tabs.value.findIndex(t => t.id === tabId)
  if (idx < 0) return
  tabs.value.splice(idx, 1)
  if (activeTabId.value === tabId) {
    if (!tabs.value.length) {
      activeTabId.value = null
    } else {
      const next = tabs.value[Math.min(idx, tabs.value.length - 1)]
      activeTabId.value = next.id
    }
  }
}

// ── Context menu state ──
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxTargetType = ref<'db' | 'col' | 'blank'>('db')
const ctxDbName = ref('')
const ctxColName = ref('')

function closeContextMenu() {
  ctxVisible.value = false
}

function fitContextMenu(x: number, y: number, type: string) {
  const heights: Record<string, number> = { blank: 90, db: 160, col: 190 }
  const menuW = 160
  const menuH = heights[type] || 150

  let left = x
  let top = y

  if (left + menuW > window.innerWidth) left = x - menuW
  if (left < 0) left = 4

  if (top + menuH > window.innerHeight) top = y - menuH
  if (top < 0) top = window.innerHeight - menuH - 4
  if (top < 0) top = 4

  return { left, top }
}

// ── Dialog state ──
const newColDialogVisible = ref(false)
const newColName = ref('')

const newDbDialogVisible = ref(false)
const newDbName = ref('')
const newDbFirstCol = ref('')

// ── Tree methods ──
async function refreshDatabases() {
  if (!props.sessionId) return
  treeLoading.value = true
  try {
    const allDbs = await MongoListDatabases(props.sessionId)
    databases.value = allDbs.filter(d => d !== 'config' && d !== 'local')
  } catch (e: any) {
    const err = e?.message || String(e)
    if (err.includes('not connected') || err.includes('session not found')) {
      await new Promise(r => setTimeout(r, 300))
      try {
        const allDbs = await MongoListDatabases(props.sessionId)
        databases.value = allDbs.filter(d => d !== 'config' && d !== 'local')
        treeLoading.value = false
        return
      } catch (_e2: any) {
        msg.error(_e2?.message || String(_e2))
      }
    } else {
      msg.error(err)
    }
  }
  treeLoading.value = false
}

async function toggleDb(db: string) {
  if (expandedDbs.has(db)) {
    expandedDbs.delete(db)
  } else {
    expandedDbs.add(db)
    if (!collections.value[db]) {
      try {
        const cols = await MongoListCollections(props.sessionId, db)
        collections.value[db] = cols.filter(c => !c.startsWith('system.'))
        collections.value = { ...collections.value }
      } catch (e: any) {
        msg.error(e?.message || String(e))
      }
    }
  }
}

// ── Context menu handlers ──
function onTreeContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.db-header') || target.closest('.table-item')) return
  ctxTargetType.value = 'blank'
  const pos = fitContextMenu(e.clientX, e.clientY, 'blank')
  ctxX.value = pos.left
  ctxY.value = pos.top
  ctxVisible.value = true
}

function onDbContextMenu(e: MouseEvent, db: string) {
  ctxTargetType.value = 'db'
  ctxDbName.value = db
  ctxColName.value = ''
  const pos = fitContextMenu(e.clientX, e.clientY, 'db')
  ctxX.value = pos.left
  ctxY.value = pos.top
  ctxVisible.value = true
}

function onColContextMenu(e: MouseEvent, db: string, col: string) {
  ctxTargetType.value = 'col'
  ctxDbName.value = db
  ctxColName.value = col
  const pos = fitContextMenu(e.clientX, e.clientY, 'col')
  ctxX.value = pos.left
  ctxY.value = pos.top
  ctxVisible.value = true
}

function onCtxOpenQuery() {
  openQueryTab(ctxDbName.value)
  ctxVisible.value = false
}

function onCtxOpenColQuery() {
  openCollectionTab(ctxDbName.value, ctxColName.value)
  ctxVisible.value = false
}

function onCtxNewColDocument() {
  // Open the collection tab; the "New Document" action lives inside it.
  openCollectionTab(ctxDbName.value, ctxColName.value)
  ctxVisible.value = false
}

function onCtxViewIndexes() {
  // Open the collection tab; switch to the indexes sub-tab inside it.
  openCollectionTab(ctxDbName.value, ctxColName.value)
  ctxVisible.value = false
}

function onCtxCopyName() {
  navigator.clipboard.writeText(ctxColName.value)
  ctxVisible.value = false
}

function onCtxNewDatabase() {
  newDbName.value = ''
  newDbFirstCol.value = ''
  newDbDialogVisible.value = true
  ctxVisible.value = false
}

async function createDatabase() {
  const dbName = newDbName.value.trim()
  if (!dbName) return
  const colName = newDbFirstCol.value.trim() || '_default'
  try {
    await MongoCreateCollection(props.sessionId, dbName, colName)
    msg.success(t('mongodb.collectionCreated'))
    newDbDialogVisible.value = false
    refreshDatabases()
  } catch (e: any) {
    msg.error(e?.message || String(e))
  }
}

function onCtxRefresh() {
  refreshDatabases()
  ctxVisible.value = false
}

function onCtxNewCollection() {
  newColName.value = ''
  newColDialogVisible.value = true
}

async function createCollection() {
  const name = newColName.value.trim()
  if (!name || !ctxDbName.value) return
  try {
    await MongoCreateCollection(props.sessionId, ctxDbName.value, name)
    msg.success(t('mongodb.collectionCreated'))
    newColDialogVisible.value = false
    const cols = await MongoListCollections(props.sessionId, ctxDbName.value)
    collections.value[ctxDbName.value] = cols.filter(c => !c.startsWith('system.'))
    collections.value = { ...collections.value }
  } catch (e: any) {
    msg.error(e?.message || String(e))
  }
}

function onCtxDropDatabase() {
  const db = ctxDbName.value
  ElMessageBox.confirm(t('mongodb.dropDatabase') + ': ' + db, t('common.confirm'), { type: 'warning' })
    .then(async () => {
      try {
        await MongoDropDatabase(props.sessionId, db)
        msg.success(t('mongodb.databaseDropped'))
        databases.value = databases.value.filter(d => d !== db)
        // close any tabs belonging to this database
        const beforeLen = tabs.value.length
        tabs.value = tabs.value.filter(t => t.dbName !== db)
        if (tabs.value.length !== beforeLen && !tabs.value.find(t => t.id === activeTabId.value)) {
          activeTabId.value = tabs.value.length ? tabs.value[tabs.value.length - 1].id : null
        }
      } catch (e: any) {
        msg.error(e?.message || String(e))
      }
    })
    .catch(() => {})
  ctxVisible.value = false
}

function onCtxDropCollection() {
  const db = ctxDbName.value
  const col = ctxColName.value
  ElMessageBox.confirm(t('mongodb.dropCollection') + ': ' + col, t('common.confirm'), { type: 'warning' })
    .then(async () => {
      try {
        await MongoDropCollection(props.sessionId, db, col)
        msg.success(t('mongodb.collectionDropped'))
        if (collections.value[db]) {
          collections.value[db] = collections.value[db].filter(c => c !== col)
          collections.value = { ...collections.value }
        }
        // close the tab for this collection
        const closed = tabs.value.find(t => t.kind === 'collection' && t.dbName === db && t.collectionName === col)
        if (closed) closeTab(closed.id)
      } catch (e: any) {
        msg.error(e?.message || String(e))
      }
    })
    .catch(() => {})
  ctxVisible.value = false
}

// ── Lifecycle ──
onMounted(() => {
  document.addEventListener('click', closeContextMenu)
  if (props.sessionId) {
    refreshDatabases()
  }
})

onUnmounted(() => {
  if (resizing) {
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
  }
  document.removeEventListener('click', closeContextMenu)
})

watch(() => props.sessionId, () => {
  if (props.sessionId) {
    tabs.value = []
    activeTabId.value = null
    databases.value = []
    collections.value = {}
    expandedDbs.clear()
    refreshDatabases()
  }
})
</script>

<style scoped>
/* ── Root ── */
.mongodb-tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* ── Main layout ── */
.mongo-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.mongo-left {
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mongo-resizer {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s ease;
}
.mongo-resizer:hover {
  background: var(--border-subtle);
}

.mongo-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Search ── */
.search-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  flex-shrink: 0;
}
.search-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s ease;
}
.search-input:focus {
  border-color: var(--accent);
}
.search-input::placeholder {
  color: var(--text-muted);
}

/* ── Tree ── */
.tree-content {
  flex: 1;
  overflow: auto;
}
.tree-loading {
  padding: 12px;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: 12px;
  text-align: center;
}
.db-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}
.db-header:hover {
  background: var(--bg-hover);
}
.db-header.selected {
  background: var(--bg-hover);
}
.db-arrow {
  width: 12px;
  flex-shrink: 0;
  color: var(--text-muted);
  display: flex;
  align-items: center;
}
.db-arrow:hover {
  color: var(--text-primary);
}
.db-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}
.db-name {
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.table-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}
.table-item:hover {
  background: var(--bg-hover);
}
.table-item.selected {
  background: var(--bg-hover);
}
.table-icon-spacer {
  width: 30px;
  flex-shrink: 0;
}
.table-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}
.table-name {
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-hint {
  padding: 4px 8px 4px 28px;
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--text-muted);
}

/* ── Tab bar ── */
.mongo-tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  flex-shrink: 0;
  min-height: 30px;
}
.mongo-tab-scroll {
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
}
.mongo-tab-scroll::-webkit-scrollbar { height: 4px; }
.mongo-tab-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px 5px 10px;
  border-right: 1px solid var(--border-subtle);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.1s ease;
}
.mongo-tab-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.mongo-tab-item.active {
  color: var(--text-primary);
  background: var(--bg-base);
  border-bottom: 2px solid var(--accent);
}
.tab-icon { flex-shrink: 0; color: var(--text-muted); }
.tab-title { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.tab-close {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 0 2px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.tab-close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.mongo-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

/* ── Breadcrumb ── */
.mongo-breadcrumb {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
}
.crumb {
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.crumb.current {
  color: var(--text-primary);
  font-weight: 600;
}
.crumb-sep {
  color: var(--text-disabled);
  margin: 0 2px;
  flex-shrink: 0;
}

/* ── Placeholder ── */
.db-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: 14px;
}

/* ── Context menu ── */
.ctx-menu {
  position: fixed;
  z-index: 1000;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 4px 0;
  min-width: 150px;
  box-shadow: var(--shadow-md);
}
.ctx-item {
  padding: 6px 12px;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.1s ease;
}
.ctx-item:hover {
  background: var(--bg-hover);
}
.ctx-item.danger {
  color: var(--error);
}
.ctx-sep {
  height: 1px;
  background: var(--border-subtle);
  margin: 4px 0;
}
</style>
