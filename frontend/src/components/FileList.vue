<template>
  <div
    ref="listRootRef"
    class="sftp-file-list"
    tabindex="0"
    @keydown="onListKeydown"
    @click="onListClick"
  >
    <div class="filter-bar">
      <el-input
        v-model="filterText"
        :placeholder="t('sftp.filterByName')"
       
        clearable
      />
      <button class="filter-icon-btn" @click="emit('refresh')" :title="t('sftp.refresh')">
        <el-icon><RefreshCw :size="14" /></el-icon>
      </button>
      <button v-if="mode === 'remote'" class="filter-icon-btn" @click="emit('upload')" :title="t('sftp.upload')">
        <el-icon><Upload :size="14" /></el-icon>
      </button>
      <button class="filter-icon-btn" @click.stop="moreMenuRef?.toggle($event.currentTarget as HTMLElement)" :title="t('sftp.more')">
        <el-icon><MoreHorizontal :size="14" /></el-icon>
      </button>
    </div>
    <PathBreadcrumb
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
      <div class="fl-table" :key="locale">
        <div class="fl-thead">
          <div class="fl-row fl-head-row">
            <div class="fl-cell fl-cell-name fl-th" @click="toggleSort('name')">
              <span>{{ t('sftp.name') }}</span>
              <el-icon v-if="sortKey === 'name'" class="fl-sort-icon"><ArrowUp v-if="sortOrder === 'asc'" /><ArrowDown v-else /></el-icon>
            </div>
            <div class="fl-cell fl-cell-type fl-th" @click="toggleSort('type')">
              <span>{{ t('sftp.type') }}</span>
              <el-icon v-if="sortKey === 'type'" class="fl-sort-icon"><ArrowUp v-if="sortOrder === 'asc'" /><ArrowDown v-else /></el-icon>
            </div>
            <div class="fl-cell fl-cell-modified fl-th" @click="toggleSort('modified')">
              <span>{{ t('sftp.modified') }}</span>
              <el-icon v-if="sortKey === 'modified'" class="fl-sort-icon"><ArrowUp v-if="sortOrder === 'asc'" /><ArrowDown v-else /></el-icon>
            </div>
            <div class="fl-cell fl-cell-size fl-th fl-th-right" @click="toggleSort('size')">
              <span>{{ t('sftp.size') }}</span>
              <el-icon v-if="sortKey === 'size'" class="fl-sort-icon"><ArrowUp v-if="sortOrder === 'asc'" /><ArrowDown v-else /></el-icon>
            </div>
            <div class="fl-cell fl-cell-permission fl-th"><span>{{ t('sftp.permission') }}</span></div>
            <div class="fl-cell fl-cell-owner fl-th"><span>{{ t('sftp.owner') }}</span></div>
            <div class="fl-cell fl-cell-group fl-th"><span>{{ t('sftp.group') }}</span></div>
          </div>
        </div>
        <RecycleScroller
          ref="scrollerRef"
          class="fl-tbody"
          :items="filteredFiles"
          :item-size="36"
          key-field="name"
        >
          <template #default="{ item, index }">
            <div
              class="fl-row fl-body-row"
              :class="getRowClassName(item)"
              :draggable="true"
              @click="onRowClick(item, index, $event)"
              @dblclick="onRowDblClick(item)"
              @contextmenu="onRowContextMenu(item, $event)"
              @dragstart="onDragStart($event, item)"
            >
              <div class="fl-cell fl-cell-name">
                <div class="name-cell">
                  <el-icon v-if="isSymlink(item)"><Link :size="14" /></el-icon>
                  <el-icon v-else-if="item.isDir"><Folder :size="14" /></el-icon>
                  <el-icon v-else><File :size="14" /></el-icon>
                  <div class="name-info">
                    <span class="file-name" :class="{ selected: isSelected(item) }">{{ item.name }}</span>
                  </div>
                </div>
              </div>
              <div class="fl-cell fl-cell-type"><span class="cell-secondary">{{ fileTypeLabel(item) }}</span></div>
              <div class="fl-cell fl-cell-modified"><span class="cell-secondary">{{ formatDate(item.modTime) }}</span></div>
              <div class="fl-cell fl-cell-size"><span class="cell-secondary">{{ item.isDir ? '-' : formatSize(item.size) }}</span></div>
              <div class="fl-cell fl-cell-permission"><span class="cell-secondary">{{ item.mode || '-' }}</span></div>
              <div class="fl-cell fl-cell-owner"><span class="cell-secondary">{{ item.owner || '-' }}</span></div>
              <div class="fl-cell fl-cell-group"><span class="cell-secondary">{{ item.group || '-' }}</span></div>
            </div>
          </template>
        </RecycleScroller>
      </div>
    </div>

    <Menu ref="ctxMenuRef" v-model:visible="ctxMenuVisible" @contextmenu.stop v-slot>
        <template v-if="menuType === 'file'">
          <MenuItem @click="doEdit">{{ t('sftp.edit') }}</MenuItem>
          <MenuItem @click="doEditExternal">{{ t('sftp.editExternal') }}</MenuItem>
          <MenuItem @click="doNewFile">{{ t('sftp.newFile') }}</MenuItem>
          <MenuItem @click="doMkdir">{{ t('sftp.newDirectory') }}</MenuItem>
          <MenuDivider />
          <MenuItem @click="doCopyToClipboard">{{ t('sftp.copy') }}</MenuItem>
          <MenuItem @click="doCutToClipboard">{{ t('sftp.cut') }}</MenuItem>
          <MenuItem :class="{ disabled: !clipboardCount }" @click="clipboardCount && doPaste()">{{ t('sftp.paste') }}</MenuItem>
          <MenuDivider />
          <MenuItem v-if="props.showSendToOther !== false" @click="doSendToOther">{{ t(sendToKey) }}</MenuItem>
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
          <MenuItem v-if="props.showSendToOther !== false" @click="doSendToOther">{{ t(sendToKey) }}</MenuItem>
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
          <MenuItem v-if="props.showSendToOther !== false" @click="doSendToOther">{{ t(sendToKey) }}</MenuItem>
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

    <Menu ref="moreMenuRef" v-model:visible="moreMenuVisible">
      <MenuItem @click="doNewFile">{{ t('sftp.newFile') }}</MenuItem>
      <MenuItem @click="doMkdir">{{ t('sftp.newDirectory') }}</MenuItem>
      <MenuDivider />
      <MenuItem class="iconic" :class="{ active: showHidden }" @click="toggleShowHidden">
        <el-icon><Eye :size="14" /></el-icon>
        {{ showHidden ? t('sftp.hideHidden') : t('sftp.showHidden') }}
      </MenuItem>
    </Menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { Folder, File, Link, RefreshCw, Eye, Upload, MoreHorizontal, ArrowUp, ArrowDown } from '@lucide/vue'
import { useI18n } from '../i18n'
import PathBreadcrumb from './PathBreadcrumb.vue'
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
  /** Hide the "send to other pane" entry — for hosts with a single pane. */
  showSendToOther?: boolean
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
  editExternal: [item: FileItem]
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
// Keep the selection pointing at live row objects: after a refresh the list is
// rebuilt with new objects, and stale ones would carry outdated fields (e.g.
// the old permission mode when re-opening the chmod dialog).
watch(() => props.files, (fresh) => {
  if (!selectedItems.value.length) return
  selectedItems.value = selectedItems.value
    .map(sel => fresh.find(f => f.name === sel.name))
    .filter((f): f is FileItem => !!f)
})
const lastClickedIndex = ref(-1)
const ctxMenuRef = ref<InstanceType<typeof Menu> | null>(null)
const ctxMenuVisible = ref(false)
const menuType = ref<'file' | 'dir' | 'batch' | 'empty'>('file')
const moreMenuRef = ref<InstanceType<typeof Menu> | null>(null)
const moreMenuVisible = ref(false)
const scrollerRef = ref<any>(null)
// P1: 列排序状态（替代 el-table 内置 sortable）
const sortKey = ref<'name' | 'type' | 'modified' | 'size' | null>(null)
const sortOrder = ref<'asc' | 'desc'>('asc')
function toggleSort(key: 'name' | 'type' | 'modified' | 'size') {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortOrder.value = 'asc'
  }
}


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
  if (q) {
    list = list.filter(f => f.name.toLowerCase().includes(q))
  }
  // P1: 列排序（替代 el-table sortable + sort-method）
  if (sortKey.value) {
    const dir = sortOrder.value === 'asc' ? 1 : -1
    list.sort((a, b) => {
      if (a.name === '..') return -1
      if (b.name === '..') return 1
      let cmp = 0
      if (sortKey.value === 'name') cmp = sortByName(a, b)
      else if (sortKey.value === 'type') cmp = sortByType(a, b)
      else if (sortKey.value === 'modified') cmp = sortByTime(a, b)
      else if (sortKey.value === 'size') cmp = sortBySize(a, b)
      return cmp * dir
    })
  }
  return list
})

// --- Progressive loading ---------------------------------------------------
// P1: 已改用 RecycleScroller 虚拟滚动，无需递增分页；filteredFiles 直接作为
// 虚拟列表的 items，渲染 DOM 数量恒定（仅可视区 + 少量缓冲），不再随目录大小
// 线性增长，超大目录不再卡死。原 PAGE_SIZE/visibleCount/bindTableScroll 逻辑移除。

// --- Quick locate (issue #700) ----------------------------------------------
// Pressing a letter key while the list has focus jumps to the first entry whose
// name starts with that letter (case-insensitive, dirs listed first), like
// Windows Explorer. Pressing the same letter again cycles to the next match.
const listRootRef = ref<HTMLElement | null>(null)
const quickTargetName = ref<string | null>(null)
let quickKey = ''
let quickIndex = -1
let quickTimer: ReturnType<typeof setTimeout> | null = null
const QUICK_RESET_MS = 1200

function onListClick(e: MouseEvent) {
  // Focus the list on click so letter keys locate within it, but only when the
  // click lands on the table itself (not the filter/breadcrumb/clipboard bars
  // or other controls), so we never steal focus while the user is editing.
  const t = e.target as HTMLElement
  if (t.closest && !t.closest('.table-wrapper')) return
  listRootRef.value?.focus({ preventScroll: true })
}

function onListKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  // Never hijack typing that is going somewhere else (filter box, editors).
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const k = e.key
  if (k.length !== 1 || !/[\x00-\x7F]/.test(k)) return // printable single char only
  e.preventDefault()
  locateByKey(k.toLowerCase())
}

function locateByKey(key: string) {
  // Candidate indices in display order (skip the '..' row).
  const matches: number[] = []
  filteredFiles.value.forEach((f, i) => {
    if (f.name !== '..' && f.name.toLowerCase().startsWith(key)) matches.push(i)
  })
  if (!matches.length) return

  if (quickKey !== key) {
    // New letter: start from the first match.
    quickKey = key
    quickIndex = matches[0]
  } else {
    // Same letter again: cycle to the next match.
    const pos = matches.indexOf(quickIndex)
    quickIndex = pos >= 0 ? matches[(pos + 1) % matches.length] : matches[0]
  }

  // Reset the "repeated same key" state after a short pause.
  if (quickTimer) clearTimeout(quickTimer)
  quickTimer = setTimeout(() => {
    quickKey = ''
    quickIndex = -1
    quickTargetName.value = null
  }, QUICK_RESET_MS)

  scrollToIndex(quickIndex)
}

function scrollToIndex(index: number) {
  const target = filteredFiles.value[index]
  if (!target) return
  // P1: RecycleScroller 自带虚拟滚动，直接 scrollToItem 即可，无需先扩页。
  selectedItems.value = [target]
  quickTargetName.value = target.name
  nextTick(() => {
    scrollerRef.value?.scrollToItem(index)
  })
}

// <div class="fl-table" :key="locale"> remounts the virtual table on locale
// switch so the head labels re-render in the new language.
watch(locale, () => {
  // no-op: :key="locale" handles remount; RecycleScroller needs no scroll rebind.
})

onMounted(() => {
  // P1: RecycleScroller manages its own scroll listener; nothing to bind here.
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

// File type column: based purely on the filename suffix (no MIME detection).
// Directories and symlinks have no suffix, so label them explicitly. The '..'
// row has no type.
function fileTypeLabel(row: FileItem): string {
  if (row.name === '..') return ''
  if (isSymlink(row)) return t('sftp.link')
  if (row.isDir) return t('sftp.folder')
  const dot = row.name.lastIndexOf('.')
  if (dot <= 0 || dot === row.name.length - 1) return '-'
  return row.name.slice(dot + 1).toLowerCase()
}

function sortByType(a: FileItem, b: FileItem): number {
  return fileTypeLabel(a).toLowerCase().localeCompare(fileTypeLabel(b).toLowerCase())
}

function onRowClick(row: FileItem, index: number, event: MouseEvent) {
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

function onRowContextMenu(row: FileItem, event: MouseEvent) {
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
  if (!force && target.closest('.fl-body-row')) return
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
function doEditExternal() { emit('editExternal', selectedItems.value[0]); ctxMenuVisible.value = false }
function doNewFile() { emit('newFile'); ctxMenuVisible.value = false; moreMenuVisible.value = false }
function doMkdir() { emit('mkdir'); ctxMenuVisible.value = false; moreMenuVisible.value = false }
function toggleShowHidden() { showHidden.value = !showHidden.value }
function doCopyToClipboard() { emit('copyToClipboard', [...selectedItems.value]); ctxMenuVisible.value = false }
function doCutToClipboard() { emit('cutToClipboard', [...selectedItems.value]); ctxMenuVisible.value = false }
function doPaste() { emit('paste'); ctxMenuVisible.value = false }

function getRowClassName(row: FileItem): string {
  const cls: string[] = []
  if (props.cutItemNames && props.cutItemNames.includes(row.name)) cls.push('cut-item-row')
  if (row.name === quickTargetName.value) cls.push('quick-target-row')
  return cls.join(' ')
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
/* The list root is focusable so letter keys can quick-locate; hide the ring. */
.sftp-file-list:focus {
  outline: none;
}
/* Brief highlight shown while a quick-located row is in view (issue #700). */
:deep(.quick-target-row) {
  background-color: rgba(var(--color-primary, 64, 158, 255), 0.14);
}
/* Non-name columns read dimmer than the file name (issue #702). */
.cell-secondary {
  color: var(--el-text-color-secondary, #909399);
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

/* P1: 虚拟滚动表格样式（替代 el-table） */
.fl-table {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border-subtle, var(--el-border-color-lighter));
  background: transparent;
  overflow: hidden;
}
.fl-thead {
  flex-shrink: 0;
  background: var(--el-table-header-bg-color, transparent);
  border-bottom: 1px solid var(--border-subtle, var(--el-border-color-lighter));
}
.fl-row {
  display: flex;
  align-items: stretch;
  width: 100%;
}
.fl-head-row {
  height: 32px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular, var(--text-secondary));
}
.fl-body-row {
  height: 36px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: default;
  border-bottom: 1px solid var(--el-border-color-lighter, rgba(0, 0, 0, 0.06));
}
.fl-body-row:hover {
  background: var(--bg-hover, var(--el-table-row-hover-bg-color));
}
.fl-cell {
  display: flex;
  align-items: center;
  padding: 0 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  flex-shrink: 0;
}
.fl-cell-name {
  flex: 1;
  min-width: 160px;
}
.fl-cell-type { width: 90px; }
.fl-cell-modified { width: 150px; }
.fl-cell-size { width: 70px; justify-content: flex-end; }
.fl-cell-permission { width: 110px; }
.fl-cell-owner { width: 100px; }
.fl-cell-group { width: 100px; }
.fl-th {
  cursor: pointer;
  user-select: none;
  gap: 4px;
}
.fl-th:hover {
  color: var(--text-primary);
}
.fl-th-right {
  justify-content: flex-end;
}
.fl-sort-icon {
  color: var(--accent, var(--el-color-primary));
}
.fl-tbody {
  flex: 1;
  min-height: 0;
}
/* RecycleScroller 内部需要确定高度才能虚拟滚动 */
.fl-tbody :deep(.vue-recycle-scroller) {
  height: 100%;
}
.fl-body-row.cut-item-row {
  opacity: 0.4;
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
</style>
