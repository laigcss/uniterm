<template>
  <div class="sftp-file-list">
    <div class="filter-bar">
      <el-input
        v-model="filterText"
        :placeholder="t('sftp.filterByName')"
       
        clearable
      />
      <button class="filter-icon-btn" @click="emit('refresh')" :title="t('sftp.refresh')">
        <el-icon><RefreshCw :size="14" /></el-icon>
      </button>
      <button class="filter-icon-btn" :class="{ active: showHidden }" @click="showHidden = !showHidden" :title="showHidden ? t('sftp.hideHidden') : t('sftp.showHidden')">
        <el-icon><Eye :size="14" /></el-icon>
      </button>
      <button v-if="mode === 'remote'" class="filter-icon-btn" @click="emit('upload')" :title="t('sftp.upload')">
        <el-icon><Upload :size="14" /></el-icon>
      </button>
    </div>
    <SFTPPathBreadcrumb
      v-if="breadcrumbMode"
      :path="breadcrumbPath || ''"
      :drives="breadcrumbDrives"
      :bookmark-mode="breadcrumbMode"
      :saved-paths="breadcrumbSavedPaths"
      @navigate="(p: string) => emit('navigate', p)"
      @save-bookmark="(p: string) => emit('saveBookmark', p)"
      @remove-bookmark="(p: string) => emit('removeBookmark', p)"
    />
    <div v-if="clipboardCount" class="clipboard-bar">
      <span class="clipboard-info">{{ clipboardMode === 'cut' ? t('sftp.cut') : t('sftp.copy') }} ({{ clipboardCount }})</span>
      <el-button type="primary" @click="emit('paste')">{{ t('sftp.paste') }}</el-button>
      <el-button @click="emit('clearClipboard')">{{ t('sftp.dialog.cancel') }}</el-button>
    </div>
    <div class="table-wrapper" @contextmenu.prevent="onEmptyAreaContextMenu">
      <div v-if="loading || pasteLoading" class="loading-overlay">
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <span class="loading-text">{{ pasteLoading ? t('sftp.pasting') : t('sftp.loading') }}</span>
          <el-button @click="pasteLoading ? emit('cancelPaste') : emit('cancelLoad')">{{ t('sftp.cancel') }}</el-button>
        </div>
      </div>
      <el-table
        ref="tableRef"
        :key="locale"
        :data="filteredFiles"
        size="small"
        :row-class-name="getRowClassName"
        @row-click="onRowClick"
        @row-dblclick="onRowDblClick"
        @row-contextmenu="onRowContextMenu"
      >
      <el-table-column :label="t('sftp.name')" min-width="160" sortable :sort-method="sortByName">
        <template #default="{ row }">
          <div class="name-cell" :draggable="true" @dragstart="onDragStart($event, row)">
            <el-icon v-if="isSymlink(row)"><Link :size="14" /></el-icon>
            <el-icon v-else-if="row.isDir"><Folder :size="14" /></el-icon>
            <el-icon v-else><File :size="14" /></el-icon>
            <div class="name-info">
              <span class="file-name" :class="{ selected: isSelected(row) }">{{ row.name }}</span>
              <span class="file-mode">{{ row.mode }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column :label="t('sftp.modified')" width="150" sortable :sort-method="sortByTime">
        <template #default="{ row }">
          {{ formatDate(row.modTime) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('sftp.size')" width="70" align="right" sortable :sort-method="sortBySize">
        <template #default="{ row }">
          {{ row.isDir ? '-' : formatSize(row.size) }}
        </template>
      </el-table-column>
    </el-table>
    </div>

    <Menu ref="ctxMenuRef" v-model:visible="ctxMenuVisible" @contextmenu.stop v-slot="{ current }">
        <template v-if="menuType === 'file'">
          <MenuItem @click="doEdit">{{ t('sftp.edit') }}</MenuItem>
          <MenuItem @click="doNewFile">{{ t('sftp.newFile') }}</MenuItem>
          <MenuItem @click="doMkdir">{{ t('sftp.newDirectory') }}</MenuItem>
          <MenuDivider />
          <MenuItem @click="doCopyToClipboard">{{ t('sftp.copy') }}</MenuItem>
          <MenuItem @click="doCutToClipboard">{{ t('sftp.cut') }}</MenuItem>
          <MenuItem :class="{ disabled: !clipboardCount }" @click="clipboardCount && doPaste()">{{ t('sftp.paste') }}</MenuItem>
          <MenuDivider />
          <MenuItem @click="doSendToOther">{{ t(sendToKey) }}</MenuItem>
          <MenuItem v-if="mode === 'remote'" @click="doDownloadTo">{{ t('sftp.downloadTo') }}</MenuItem>
          <MenuDivider />
          <MenuItem @click="doRename">{{ t('sftp.rename') }}</MenuItem>
          <MenuItem @click="doDelete">{{ t('sftp.delete') }}</MenuItem>
          <MenuItem v-if="mode === 'remote'" @click="doChmod">{{ t('sftp.changePermission') }}</MenuItem>
        </template>
        <template v-else-if="menuType === 'dir'">
          <MenuItem @click="doNewFile">{{ t('sftp.newFile') }}</MenuItem>
          <MenuItem @click="doMkdir">{{ t('sftp.newDirectory') }}</MenuItem>
          <MenuDivider />
          <MenuItem @click="doCopyToClipboard">{{ t('sftp.copy') }}</MenuItem>
          <MenuItem @click="doCutToClipboard">{{ t('sftp.cut') }}</MenuItem>
          <MenuItem :class="{ disabled: !clipboardCount }" @click="clipboardCount && doPaste()">{{ t('sftp.paste') }}</MenuItem>
          <MenuDivider />
          <MenuItem @click="doSendToOther">{{ t(sendToKey) }}</MenuItem>
          <MenuItem v-if="mode === 'remote'" @click="doDownloadTo">{{ t('sftp.downloadTo') }}</MenuItem>
          <MenuDivider />
          <MenuItem @click="doRename">{{ t('sftp.rename') }}</MenuItem>
          <MenuItem @click="doDelete">{{ t('sftp.delete') }}</MenuItem>
          <MenuItem v-if="mode === 'remote'" @click="doChmod">{{ t('sftp.changePermission') }}</MenuItem>
        </template>
        <template v-else-if="menuType === 'batch'">
          <MenuItem @click="doCopyToClipboard">{{ t('sftp.copy') }}</MenuItem>
          <MenuItem @click="doCutToClipboard">{{ t('sftp.cut') }}</MenuItem>
          <MenuItem :class="{ disabled: !clipboardCount }" @click="clipboardCount && doPaste()">{{ t('sftp.paste') }}</MenuItem>
          <MenuDivider />
          <MenuItem @click="doSendToOther">{{ t(sendToKey) }}</MenuItem>
          <MenuItem v-if="mode === 'remote'" @click="doDownloadTo">{{ t('sftp.downloadTo') }}</MenuItem>
          <MenuDivider />
          <MenuItem v-if="mode === 'remote'" class="disabled">{{ t('sftp.renameDisabled') }}</MenuItem>
          <MenuItem v-if="mode === 'local'" @click="doRename">{{ t('sftp.rename') }}</MenuItem>
          <MenuItem @click="doDelete">{{ t('sftp.delete') }}</MenuItem>
          <MenuItem v-if="mode === 'remote'" class="disabled">{{ t('sftp.chmodDisabled') }}</MenuItem>
        </template>
        <template v-else-if="menuType === 'empty'">
          <MenuItem @click="doNewFile">{{ t('sftp.newFile') }}</MenuItem>
          <MenuItem @click="doMkdir">{{ t('sftp.newDirectory') }}</MenuItem>
          <MenuDivider />
          <MenuItem :class="{ disabled: !clipboardCount }" @click="clipboardCount && doPaste()">{{ t('sftp.paste') }}</MenuItem>
        </template>
    </Menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Folder, File, Link, RefreshCw, Eye, Upload } from '@lucide/vue'
import { useI18n } from '../i18n'
import SFTPPathBreadcrumb from './SFTPPathBreadcrumb.vue'
import Menu from './Menu.vue'
import MenuItem from './MenuItem.vue'
import MenuDivider from './MenuDivider.vue'

export interface FileItem {
  name: string
  size: number
  modTime: string
  mode: string
  isDir: boolean
  isHidden: boolean
  owner: string
  group: string
}

const props = defineProps<{
  files: FileItem[]
  mode: 'local' | 'remote'
  loading?: boolean
  pasteLoading?: boolean
  cutItemNames?: string[]
  clipboardCount?: number
  clipboardMode?: 'copy' | 'cut'
  breadcrumbMode?: 'local' | 'remote'
  breadcrumbPath?: string
  breadcrumbSavedPaths?: string[]
  breadcrumbDrives?: string[]
}>()

const emit = defineEmits<{
  open: [item: FileItem]
  navigate: [path: string]
  sendToOther: [items: FileItem[]]
  rename: [item: FileItem]
  delete: [items: FileItem[]]
  refresh: []
  mkdir: []
  chmod: [item: FileItem]
  upload: []
  downloadTo: [items: FileItem[]]
  cancelLoad: []
  cancelPaste: []
  edit: [item: FileItem]
  newFile: []
  copyToClipboard: [items: FileItem[]]
  cutToClipboard: [items: FileItem[]]
  paste: []
  clearClipboard: []
  saveBookmark: [path: string]
  removeBookmark: [path: string]
}>()

const { t, locale } = useI18n()

const filterText = ref('')
const showHidden = ref(false)
const selectedItems = ref<FileItem[]>([])
const lastClickedIndex = ref(-1)
const ctxMenuRef = ref<InstanceType<typeof Menu> | null>(null)
const ctxMenuVisible = ref(false)
const menuType = ref<'file' | 'dir' | 'batch' | 'empty'>('file')
const tableRef = ref<any>(null)

const targetSide = computed(() => props.mode === 'local' ? t('sftp.remote') : t('sftp.local'))
const sendToKey = computed(() => props.mode === 'local' ? 'sftp.sendToRemote' : 'sftp.sendToLocal')

const filteredFiles = computed(() => {
  let list = [...props.files]
  if (!list.find(f => f.name === '..')) {
    list.unshift({ name: '..', size: 0, modTime: '', mode: '', isDir: true, isHidden: false, owner: '', group: '' })
  }
  list.sort((a, b) => {
    if (a.name === '..') return -1
    if (b.name === '..') return 1
    if (a.isDir && !b.isDir) return -1
    if (!a.isDir && b.isDir) return 1
    return a.name.localeCompare(b.name)
  })
  if (!showHidden.value) {
    list = list.filter(f => f.name === '..' || (!f.name.startsWith('.') && !f.isHidden))
  }
  const q = filterText.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(f => f.name.toLowerCase().includes(q))
})

function isSelected(row: FileItem): boolean {
  return selectedItems.value.some(s => s.name === row.name)
}

function isSymlink(row: FileItem): boolean {
  return row.mode.startsWith('L') || row.mode.startsWith('l')
}

function formatDate(ts: string): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleString()
}

function sortByName(a: FileItem, b: FileItem): number {
  if (a.name === '..') return -1
  if (b.name === '..') return 1
  return a.name.localeCompare(b.name)
}

function sortByTime(a: FileItem, b: FileItem): number {
  if (a.name === '..') return -1
  if (b.name === '..') return 1
  const ta = a.modTime ? new Date(a.modTime).getTime() : 0
  const tb = b.modTime ? new Date(b.modTime).getTime() : 0
  return ta - tb
}

function sortBySize(a: FileItem, b: FileItem): number {
  if (a.name === '..') return -1
  if (b.name === '..') return 1
  if (a.isDir && !b.isDir) return -1
  if (!a.isDir && b.isDir) return 1
  return a.size - b.size
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
}

function onRowClick(row: FileItem, _column: any, event: MouseEvent) {
  const index = filteredFiles.value.findIndex(f => f.name === row.name)
  if (event.ctrlKey || event.metaKey) {
    const idx = selectedItems.value.findIndex(s => s.name === row.name)
    if (idx >= 0) {
      selectedItems.value.splice(idx, 1)
    } else {
      selectedItems.value.push(row)
    }
  } else if (event.shiftKey && lastClickedIndex.value >= 0) {
    const start = Math.min(lastClickedIndex.value, index)
    const end = Math.max(lastClickedIndex.value, index)
    selectedItems.value = filteredFiles.value.slice(start, end + 1)
  } else {
    selectedItems.value = [row]
    lastClickedIndex.value = index
  }
}

function onRowDblClick(row: FileItem) {
  if (row.name === '..') {
    emit('navigate', '..')
    return
  }
  if (row.isDir) {
    emit('navigate', row.name)
  } else {
    emit('open', row)
  }
}

function onRowContextMenu(row: FileItem, _column: any, event: MouseEvent) {
  if (row.name === '..') {
    // Show empty area menu for parent directory
    event.preventDefault()
    event.stopPropagation()
    selectedItems.value = []
    menuType.value = 'empty'
    ctxMenuRef.value?.openAt(event.clientX, event.clientY)
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (!selectedItems.value.some(s => s.name === row.name)) {
    selectedItems.value = [row]
  }
  if (selectedItems.value.length > 1) {
    menuType.value = 'batch'
  } else if (selectedItems.value[0]?.isDir) {
    menuType.value = 'dir'
  } else {
    menuType.value = 'file'
  }
  ctxMenuRef.value?.openAt(event.clientX, event.clientY)
}

function onEmptyAreaContextMenu(event: MouseEvent, force = false) {
  const target = event.target as HTMLElement
  // Only show empty menu if not clicking on a row (unless forced)
  if (!force && target.closest('tr')) return
  event.stopPropagation()
  selectedItems.value = []
  menuType.value = 'empty'
  ctxMenuRef.value?.openAt(event.clientX, event.clientY)
}

function doSendToOther() { emit('sendToOther', [...selectedItems.value]); ctxMenuVisible.value = false }
function doDownloadTo() { emit('downloadTo', [...selectedItems.value]); ctxMenuVisible.value = false }
function doRename() { emit('rename', selectedItems.value[0]); ctxMenuVisible.value = false }
function doDelete() { emit('delete', [...selectedItems.value]); ctxMenuVisible.value = false }
function doChmod() { emit('chmod', selectedItems.value[0]); ctxMenuVisible.value = false }
function doEdit() { emit('edit', selectedItems.value[0]); ctxMenuVisible.value = false }
function doNewFile() { emit('newFile'); ctxMenuVisible.value = false }
function doMkdir() { emit('mkdir'); ctxMenuVisible.value = false }
function doCopyToClipboard() { emit('copyToClipboard', [...selectedItems.value]); ctxMenuVisible.value = false }
function doCutToClipboard() { emit('cutToClipboard', [...selectedItems.value]); ctxMenuVisible.value = false }
function doPaste() { emit('paste'); ctxMenuVisible.value = false }
function doUpload() { emit('upload'); ctxMenuVisible.value = false }
function doRefresh() { emit('refresh'); ctxMenuVisible.value = false }

function getRowClassName({ row }: { row: FileItem }): string {
  if (props.cutItemNames && props.cutItemNames.includes(row.name)) {
    return 'cut-item-row'
  }
  return ''
}

function onDragStart(event: DragEvent, row: FileItem) {
  if (event.dataTransfer) {
    // Carry the whole selection when the dragged row is part of it, so
    // ctrl/shift multi-selection drags up/ down more than one item.
    const inSelection = selectedItems.value.some(s => s.name === row.name)
    const dragged = (inSelection ? selectedItems.value : [row]).filter(i => i.name !== '..')
    event.dataTransfer.setData('application/sftp-file', JSON.stringify({
      mode: props.mode,
      items: dragged.map(i => ({ name: i.name, isDir: i.isDir }))
    }))
  }
}
</script>

<style scoped>
.sftp-file-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.filter-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-top: 0;
  padding-left: 10px;
  padding-right: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle);
}
.filter-bar .el-input {
  flex: 1;
}
/* Match the sidebar's tab / close icon-button style (transparent, 26px, muted) */
.filter-icon-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.12s ease;
}
.filter-icon-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.filter-icon-btn.active {
  color: var(--accent);
  background: var(--accent-subtle);
}
.clipboard-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 12px;
}
.clipboard-info {
  flex: 1;
  color: var(--text-secondary);
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.name-info {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.file-name {
  color: var(--text-primary);
}
.file-name.selected {
  color: var(--accent);
}
.file-mode {
  font-size: 11px;
  color: var(--text-disabled);
}

</style>

<style>
/* Custom loading overlay */
.table-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--scrim);
}
.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.loading-text {
  font-size: 12px;
  color: var(--text-primary);
}

/* Remove horizontal borders between data rows (keep header border) */
.sftp-file-list .el-table__inner-wrapper::before {
  height: 0 !important;
}
.sftp-file-list .el-table td.el-table__cell {
  border-bottom: none !important;
}

/* Make table fill entire pane with consistent background */
.sftp-file-list .el-table__body-wrapper {
  background: transparent;
}
.sftp-file-list .el-table__empty-block,
.sftp-file-list .el-table__empty-text {
  background: transparent;
}

/* Override ElMessage popup to match dark theme */
.el-message {
  background: var(--bg-surface) !important;
  border: 1px solid var(--border-subtle) !important;
  box-shadow: var(--shadow-md) !important;
}
.el-message .el-message__content {
  color: var(--text-primary) !important;
}
.el-message--error {
  background: var(--bg-surface) !important;
}
.el-message--error .el-message__content {
  color: var(--error) !important;
}
.el-table tr.cut-item-row {
  opacity: 0.4;
}

/* Make table fill pane and keep scrollbar at bottom */
.sftp-file-list .table-wrapper .el-table {
  height: 100%;
}
</style>
