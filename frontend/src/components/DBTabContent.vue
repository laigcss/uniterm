<template>
  <div class="db-tab-content">
    <div class="db-main">
      <div class="db-left" :style="{ width: leftWidth + 'px' }">
        <DBTreePanel
          ref="treeRef"
          :session-id="sessionId"
          :default-db-name="defaultDbName"
          :active-db="activeTab?.dbName"
          :active-table="activeTab?.kind === 'table' ? activeTab.tableName : ''"
          @select-table="onSelectTable"
          @open-database="onOpenDatabase"
          @view-structure="onViewStructure"
        />
      </div>
      <div class="db-resizer" @mousedown="onResizeStart" />
      <div class="db-right">
        <div v-if="!tabs.length" class="db-placeholder">
          <span>{{ t('db.selectTableHint') }}</span>
        </div>
        <template v-else>
          <div class="db-tab-bar">
            <div class="db-tab-scroll">
              <div
                v-for="tab in tabs"
                :key="tab.id"
                class="db-tab-item"
                :class="{ active: tab.id === activeTabId }"
                @click="activateTab(tab.id)"
                @middleclick.prevent="closeTab(tab.id)"
              >
                <component :is="tab.kind === 'table' ? (tab.isView ? Eye : Table2) : Database" :size="12" class="tab-icon" />
                <span class="tab-title">{{ tabTitle(tab) }}</span>
                <button class="tab-close" :title="t('db.tabClose')" @click.stop="closeTab(tab.id)">×</button>
              </div>
            </div>
          </div>
          <div class="db-tab-panels">
            <div
              v-for="tab in tabs"
              :key="tab.id"
              v-show="tab.id === activeTabId"
              class="db-tab-panel"
            >
              <!-- Table tab: data query + structure -->
              <template v-if="tab.kind === 'table'">
                <div class="db-breadcrumb">
                  <span class="crumb crumb-static">{{ hostName }}</span>
                  <span class="crumb-sep">/</span>
                  <span class="crumb clickable" @click="onOpenDatabase(tab.dbName)">{{ tab.dbName }}</span>
                  <span class="crumb-sep">/</span>
                  <span class="crumb current">{{ tab.tableName }}</span>
                </div>
                <div class="db-right-top">
                  <div class="db-tabs">
                    <button class="db-tab" :class="{ active: tab.subView === 'query' }" @click="setSubView(tab.id, 'query')">{{ t('db.dataQuery') }}</button>
                    <button v-if="!tab.isView" class="db-tab" :class="{ active: tab.subView === 'structure' }" @click="onStructureTabClick(tab.id)">{{ t('db.tableStructure') }}</button>
                  </div>
                  <div class="db-right-top-content">
                    <DBQueryEditor
                      v-show="tab.subView === 'query'"
                      :key="'q-' + tab.id"
                      :session-id="sessionId"
                      :table-name="tab.tableName"
                      :db-name="tab.dbName"
                      :db-type="dbType"
                      :primary-keys="tab.primaryKeys"
                      :table-columns="tab.tableColumns"
                      :is-view="tab.isView"
                    />
                    <DBTableStructure
                      v-show="tab.subView === 'structure'"
                      :session-id="sessionId"
                      :db-name="tab.dbName"
                      :table-name="tab.tableName || ''"
                      :load-trigger="tab.structureLoadTrigger"
                      @schema-loaded="(pks: string[]) => onSchemaLoaded(tab.id, pks)"
                    />
                  </div>
                </div>
              </template>
              <!-- Database tab: query + object list -->
              <template v-else>
                <div class="db-breadcrumb">
                  <span class="crumb crumb-static">{{ hostName }}</span>
                  <span class="crumb-sep">/</span>
                  <span class="crumb current">{{ tab.dbName }}</span>
                </div>
                <div class="db-right-top">
                  <div class="db-tabs">
                    <button class="db-tab" :class="{ active: tab.subView === 'query' }" @click="setSubView(tab.id, 'query')">{{ t('db.dataQuery') }}</button>
                    <button class="db-tab" :class="{ active: tab.subView === 'objects' }" @click="setSubView(tab.id, 'objects')">{{ t('db.tableList') }}</button>
                  </div>
                  <div class="db-right-top-content">
                    <DBQueryEditor
                      v-show="tab.subView === 'query'"
                      :key="'dbq-' + tab.id"
                      :session-id="sessionId"
                      :db-name="tab.dbName"
                      :db-type="dbType"
                    />
                    <DBObjectList
                      v-show="tab.subView === 'objects'"
                      :session-id="sessionId"
                      :db-name="tab.dbName"
                      @open="onSelectTable"
                      @changed="onObjectsChanged"
                    />
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { Table2, Eye, Database } from '@lucide/vue'
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

interface DbTab {
  id: number
  kind: 'table' | 'query'
  dbName: string
  tableName?: string
  isView?: boolean
  subView: 'query' | 'structure' | 'objects'
  primaryKeys: string[]
  tableColumns: ColumnInfo[]
  structureLoadTrigger: number
}

const tabs = ref<DbTab[]>([])
const activeTabId = ref<number | null>(null)
let nextTabId = 1

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) || null)

const treeRef = ref<InstanceType<typeof DBTreePanel> | null>(null)

function tabTitle(tab: DbTab): string {
  return tab.kind === 'table' ? (tab.tableName || '') : tab.dbName
}

function activateTab(id: number) {
  activeTabId.value = id
}

function loadSchema(tab: DbTab) {
  if (!tab.tableName) return
  GetTableSchema(props.sessionId, tab.dbName, tab.tableName)
    .then(schema => {
      tab.tableColumns = schema.columns
      tab.primaryKeys = schema.columns.filter(c => c.isPrimary).map(c => c.name)
    })
    .catch(() => { /* ignore */ })
}

function openTableTab(dbName: string, tableName: string, isView: boolean) {
  const existing = tabs.value.find(t => t.kind === 'table' && t.dbName === dbName && t.tableName === tableName)
  if (existing) {
    existing.subView = 'query'
    activeTabId.value = existing.id
    return
  }
  const tab: DbTab = {
    id: nextTabId++,
    kind: 'table',
    dbName,
    tableName,
    isView,
    subView: 'query',
    primaryKeys: [],
    tableColumns: [],
    structureLoadTrigger: 0,
  }
  tabs.value.push(tab)
  activeTabId.value = tab.id
  loadSchema(tab)
}

function openQueryTab(dbName: string, subView: 'query' | 'objects' = 'query') {
  const existing = tabs.value.find(t => t.kind === 'query' && t.dbName === dbName)
  if (existing) {
    existing.subView = subView
    activeTabId.value = existing.id
    return
  }
  const tab: DbTab = {
    id: nextTabId++,
    kind: 'query',
    dbName,
    subView,
    primaryKeys: [],
    tableColumns: [],
    structureLoadTrigger: 0,
  }
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

function onSelectTable(dbName: string, tableName: string, isView = false) {
  openTableTab(dbName, tableName, isView)
}

function onOpenDatabase(dbName: string, tab: 'query' | 'objects' = 'query') {
  openQueryTab(dbName, tab)
}

function onViewStructure(dbName: string, tableName: string) {
  let tab = tabs.value.find(t => t.kind === 'table' && t.dbName === dbName && t.tableName === tableName)
  if (!tab) {
    tab = {
      id: nextTabId++,
      kind: 'table',
      dbName,
      tableName,
      isView: false,
      subView: 'structure',
      primaryKeys: [],
      tableColumns: [],
      structureLoadTrigger: 1,
    }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    loadSchema(tab)
    return
  }
  tab.subView = 'structure'
  tab.structureLoadTrigger++
  activeTabId.value = tab.id
}

function onStructureTabClick(tabId: number) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (!tab) return
  tab.subView = 'structure'
  tab.structureLoadTrigger++
}

function setSubView(tabId: number, view: DbTab['subView']) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (!tab) return
  tab.subView = view
}

function onSchemaLoaded(tabId: number, pks: string[]) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (tab) tab.primaryKeys = pks
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

function onObjectsChanged(dbName: string) {
  treeRef.value?.refreshDb(dbName)
}

// ── Resize splitter ──

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

onUnmounted(() => {
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
}
.db-tab-bar {
  display: flex;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  flex-shrink: 0;
  min-height: 30px;
}
.db-tab-scroll {
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 1;
}
.db-tab-scroll::-webkit-scrollbar { height: 4px; }
.db-tab-item {
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
.db-tab-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.db-tab-item.active {
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
.db-tab-panels {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}
.db-tab-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.db-right-top {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.db-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-subtle);
  padding: 0 8px;
  flex-shrink: 0;
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
.db-breadcrumb {
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
.crumb.clickable {
  cursor: pointer;
  transition: all 0.1s ease;
}
.crumb.clickable:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
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
</style>
