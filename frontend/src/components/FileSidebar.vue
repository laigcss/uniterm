<template>
  <div
    class="companion-sidebar file-sidebar"
  >
    <div v-if="!sessionId" class="companion-empty">
      <span v-if="connecting">{{ t('companion.connecting') }}</span>
      <span v-else-if="connectError">{{ connectError }}</span>
      <span v-else>{{ t('companion.needSsh') }}</span>
    </div>

    <template v-else>
      <div
        class="file-body"
        :class="{ 'drag-active': dragOver }"
        :id="FILE_DROP_ID"
        data-file-drop-target
        @dragenter.prevent="onDragEnter"
        @dragleave.prevent="onDragLeave"
        @dragover.prevent="onDragOver"
        @drop.prevent="onDropUpload"
      >
        <div v-if="dragOver" class="drop-overlay">
          <span>{{ preparingUpload ? t('companion.preparingUpload') : t('sftp.dropHere') }}</span>
        </div>

        <SFTPFileList
          mode="remote"
          breadcrumb-mode="remote"
          :breadcrumb-path="cwd"
          :breadcrumb-saved-paths="settingsStore.sftpBookmarks.remotePaths"
          :files="files"
          :loading="loading"
          :paste-loading="false"
          :cut-item-names="[]"
          :clipboard-count="0"
          @navigate="onNavigate"
          @refresh="onRefresh"
          @upload="onUpload"
          @download-to="onDownloadTo"
          @rename="onRename"
          @delete="onDelete"
          @mkdir="onMkdir"
          @chmod="onChmod"
          @send-to-other="onDownloadTo"
          @edit="onEditFile"
          @new-file="onNewFile"
          @copy-to-clipboard="() => {}"
          @cut-to-clipboard="() => {}"
          @paste="() => {}"
          @clear-clipboard="() => {}"
          @cancel-paste="() => {}"
          @open="onEditFile"
          @cancel-load="onCancelLoad"
          @save-bookmark="onSaveBookmark"
          @remove-bookmark="onRemoveBookmark"
        />
      </div>

      <!-- Transfer history / progress panel (pinned at the sidebar bottom) -->
      <div ref="transferPanelRef" class="transfer-panel" :style="{ height: transferHeight + 'px' }">
        <div class="transfer-panel-resize" @mousedown.prevent="onTransferResizeStart" />
        <div class="transfer-panel-head">
          <span>{{ t('companion.transfers') }}</span>
          <div class="transfer-panel-actions">
            <button
              class="companion-action-btn"
              :disabled="!transferTasks.length"
              :title="t('companion.clearTransfers')"
              @click="clearFinishedTransfers"
            >{{ t('companion.clearTransfers') }}</button>
          </div>
        </div>
        <div v-if="!transferTasks.length" class="transfer-empty">{{ t('companion.noTransfers') }}</div>
        <SFTPTransferProgress
          v-else
          :tasks="transferTasks"
          @cancel="onCancelTransfer"
          @pause="onPauseTransfer"
          @resume="onResumeTransfer"
        />
      </div>
    </template>

    <!-- Remote file editor -->
    <el-dialog
      append-to-body
      v-model="editorVisible"
      :title="editorTitle"
      width="80%"
      :close-on-click-modal="false"
      destroy-on-close
      class="companion-editor-dialog"
      @opened="onEditorOpened"
    >
      <div class="companion-editor-meta" v-if="editorLangLabel">
        <span class="lang-badge">{{ editorLangLabel }}</span>
      </div>
      <SyntaxEditor
        v-if="editorVisible"
        ref="syntaxEditorRef"
        v-model="editorContent"
        :file-path="editorPath"
      />
      <template #footer>
        <div class="companion-editor-footer">
          <div class="companion-editor-opts">
            <el-select v-model="editorEncoding" style="width: 110px">
              <el-option label="UTF-8" value="utf-8" />
              <el-option label="UTF-16 LE" value="utf-16le" />
              <el-option label="UTF-16 BE" value="utf-16be" />
              <el-option label="GBK" value="gbk" />
            </el-select>
            <el-select v-model="editorLineEnding" style="width: 150px">
              <el-option label="LF (Linux/macOS)" value="lf" />
              <el-option label="CRLF (Windows)" value="crlf" />
              <el-option label="CR (old Mac)" value="cr" />
            </el-select>
          </div>
          <div>
            <el-button @click="editorVisible = false">{{ t('sftp.dialog.cancel') }}</el-button>
            <el-button type="primary" :loading="editorSaving" @click="onEditorSave">{{ t('sftp.edit.save') }}</el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useI18n } from '../i18n'
import { msg } from '../services/message'
import { useCompanionStore } from '../stores/companionStore'
import { usePanelStore } from '../stores/panelStore'
import { useSettingsStore } from '../stores/settingsStore'
import {
  SftpListRemote, SftpChangeRemoteDir,
  SftpMakeDir, SftpRemove, SftpRename, SftpChmod, SftpPutContent, SftpGetContent,
  SftpGet, SftpPut, WriteTempFile, CreateTempUpload, AppendTempUpload,
  SftpCancelTransfer, SftpPauseTransfer, SftpResumeTransfer,
  OpenMultipleFilesDialog, OpenDirectoryDialog, ListSessions,
} from '../../bindings/github.com/ys-ll/uniterm/app'
import SFTPFileList from './SFTPFileList.vue'
import type { FileItem } from './SFTPFileList.vue'
import SFTPTransferProgress from './SFTPTransferProgress.vue'
import { Events } from '@wailsio/runtime'
import SyntaxEditor from './SyntaxEditor.vue'

const { t } = useI18n()
const companionStore = useCompanionStore()
const panelStore = usePanelStore()
const settingsStore = useSettingsStore()

const connecting = ref(false)
const connectError = ref('')
// Transfer panel: default height (px), adjustable by dragging its top edge.
const transferHeight = ref(200)
const transferPanelRef = ref<HTMLDivElement | null>(null)

function onTransferResizeStart(e: MouseEvent) {
  const el = transferPanelRef.value
  if (!el) return
  const startY = e.clientY
  const startH = el.offsetHeight
  const maxH = el.parentElement ? Math.max(el.parentElement.clientHeight - 60, 120) : 600
  function onMove(ev: MouseEvent) {
    transferHeight.value = Math.min(Math.max(startH + (startY - ev.clientY), 120), maxH)
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

const cwd = ref('')
const files = ref<FileItem[]>([])
const loading = ref(false)
const dragOver = ref(false)
const preparingUpload = ref(false)
let dragEnterCount = 0
let loadVersion = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let refreshDebounce: ReturnType<typeof setTimeout> | null = null
let lastWailsDropAt = 0
let fileDropBound = false
let fileDropUnsub: (() => void) | null = null
// Unique id on this component's drop zone. Wails v3 forwards the id of the
// element the file was dropped on via common:WindowFilesDropped, so keep only
// the drops that actually landed on this sidebar (SFTP panes are also targets).
const FILE_DROP_ID = 'file-sidebar-drop'

const sessionId = computed(() => companionStore.currentSftpSessionId)
const transferKey = computed(() => companionStore.transferKey || 'companion-sftp')
const transferTasks = computed(() => panelStore.getTransferTasks(transferKey.value))
const activeTransferCount = computed(() =>
  transferTasks.value.filter(t => t.status === 'running' || t.status === 'paused').length
)

const fileCount = computed(() => files.value.filter(f => !f.isDir && f.name !== '..').length)
const folderCount = computed(() => files.value.filter(f => f.isDir && f.name !== '..').length)

const LIST_TIMEOUT_MS = 20000
const REMOVE_TIMEOUT_MS = 60000

function joinPath(base: string, name: string): string {
  if (base.endsWith('/')) return base + name
  return base + '/' + name
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

function scheduleRefreshRetry() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    if (sessionId.value && companionStore.filesVisible && files.value.length === 0) {
      onRefresh()
    }
  }, 800)
}

/** Coalesce bursty refresh (transfer complete + delete + mkdir). */
function scheduleRefresh(delay = 250) {
  if (refreshDebounce) clearTimeout(refreshDebounce)
  refreshDebounce = setTimeout(() => {
    refreshDebounce = null
    onRefresh()
  }, delay)
}

async function ensureConnected() {
  const pid = companionStore.activeSshPanelId
  if (!pid || !companionStore.filesVisible) return
  connecting.value = true
  connectError.value = ''
  try {
    await companionStore.ensureSftp(pid)
  } catch (e: any) {
    connectError.value = e?.toString?.() || t('companion.listFailed')
  } finally {
    connecting.value = false
  }
}

async function onRefresh() {
  const sid = sessionId.value
  if (!sid) return
  const version = ++loadVersion
  loading.value = true
  try {
    const result = await withTimeout(
      SftpListRemote(sid, cwd.value || ''),
      LIST_TIMEOUT_MS,
      'list',
    )
    if (version !== loadVersion) return
    files.value = result.files || []
    if (result.dir) cwd.value = result.dir
    connectError.value = ''
  } catch (e: any) {
    if (version !== loadVersion) return
    const err = e?.toString() || t('companion.listFailed')
    if (/not connected/i.test(err)) {
      scheduleRefreshRetry()
      return
    }
    if (/timeout/i.test(err)) {
      msg.warning(t('companion.refreshTimeout'))
      return
    }
    msg.error(err)
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

function onCancelLoad() {
  loadVersion++
  loading.value = false
}

async function onNavigate(path: string) {
  const sid = sessionId.value
  if (!sid) return
  let fullPath: string
  if (path === '..') {
    fullPath = '/' + cwd.value.split('/').filter(Boolean).slice(0, -1).join('/')
  } else if (!path.startsWith('/')) {
    fullPath = joinPath(cwd.value, path)
  } else {
    fullPath = path
  }
  const version = ++loadVersion
  loading.value = true
  try {
    const result = await SftpChangeRemoteDir(sid, fullPath)
    if (version !== loadVersion) return
    files.value = result.files || []
    cwd.value = result.dir || fullPath
  } catch (e: any) {
    if (version !== loadVersion) return
    msg.error(e?.toString() || t('companion.navFailed'))
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

function onSaveBookmark(path: string) {
  settingsStore.addSftpBookmark('remote', path)
}

function onRemoveBookmark(path: string) {
  settingsStore.removeSftpBookmark('remote', path)
}

async function onUpload() {
  const sid = sessionId.value
  if (!sid) return
  try {
    const localFiles = await OpenMultipleFilesDialog()
    if (!localFiles?.length) return
    const names = localFiles.map(fp => fp.replace(/\\/g, '/').split('/').pop() || 'upload')
    const action = await resolveConflicts(names)
    if (action === 'cancel') return
    const existing = files.value.map(f => f.name)
        for (let i = 0; i < localFiles.length; i++) {
      let name = names[i]
      if (action === 'rename' && existing.includes(name)) {
        name = autoRename(name, existing)
      }
      existing.push(name)
      SftpPut(sid, localFiles[i], joinPath(cwd.value, name), false)
    }
  } catch (e) {
    console.error('upload:', e)
  }
}

function autoRename(targetName: string, existingNames: string[]): string {
  if (!existingNames.includes(targetName)) return targetName
  const dotIdx = targetName.lastIndexOf('.')
  const base = dotIdx > 0 ? targetName.slice(0, dotIdx) : targetName
  const ext = dotIdx > 0 ? targetName.slice(dotIdx) : ''
  let n = 1
  let candidate: string
  do {
    candidate = `${base} (${n})${ext}`
    n++
  } while (existingNames.includes(candidate))
  return candidate
}

async function resolveConflicts(fileNames: string[]): Promise<'overwrite' | 'rename' | 'cancel'> {
  const existing = files.value.map(f => f.name)
  const conflicts = fileNames.filter(n => existing.includes(n))
  if (!conflicts.length) return 'overwrite'
  try {
    await ElMessageBox.confirm(
      `${t('sftp.dialog.conflictPrompt')}\n${conflicts.slice(0, 8).join('\n')}${conflicts.length > 8 ? '\n...' : ''}`,
      t('sftp.dialog.conflictTitle'),
      {
        distinguishCancelAndClose: true,
        confirmButtonText: t('sftp.dialog.conflictOverwrite'),
        cancelButtonText: t('sftp.dialog.conflictRename'),
        type: 'warning',
      }
    )
    return 'overwrite'
  } catch (action) {
    if (action === 'cancel') return 'rename'
    return 'cancel'
  }
}

function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  dragEnterCount++
  dragOver.value = true
}

function onDragLeave() {
  dragEnterCount--
  if (dragEnterCount <= 0) {
    dragEnterCount = 0
    dragOver.value = false
  }
}

function onDragOver(e: DragEvent) {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function clearDragState() {
  dragOver.value = false
  dragEnterCount = 0
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** Chunked temp write — avoids freezing UI on large drops without native path. */
async function readAndUploadChunked(file: File, remotePath: string) {
  const sid = sessionId.value
  if (!sid) return
  try {
    const tmpPath = await CreateTempUpload(file.name)
    const chunkSize = 512 * 1024
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const blob = file.slice(offset, Math.min(offset + chunkSize, file.size))
      const buf = await blob.arrayBuffer()
      await AppendTempUpload(tmpPath, arrayBufferToBase64(buf))
      await yieldToUI()
    }
    SftpPut(sid, tmpPath, remotePath, false)
  } catch {
    msg.error(t('companion.uploadFailed'))
  }
}

async function readAndUpload(file: File, remotePath: string): Promise<void> {
  // Small files: single WriteTempFile is fine; larger: chunk to keep UI responsive
  if (file.size > 256 * 1024) {
    return readAndUploadChunked(file, remotePath)
  }
  const sid = sessionId.value
  if (!sid) return
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]
      try {
        const tmpPath = await WriteTempFile(file.name, base64)
        SftpPut(sid, tmpPath, remotePath, false)
      } catch {
        msg.error(t('companion.uploadFailed'))
      } finally {
        resolve()
      }
    }
    reader.onerror = () => {
      msg.error(t('companion.uploadFailed'))
      resolve()
    }
    reader.readAsDataURL(file)
  })
}

async function uploadLocalPaths(localPaths: string[]) {
  const sid = sessionId.value
  if (!sid || !localPaths.length) return
  const names = localPaths.map(fp => fp.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || 'upload')
  const action = await resolveConflicts(names)
  if (action === 'cancel') return
  const existing = files.value.map(f => f.name)
    for (let i = 0; i < localPaths.length; i++) {
    let name = names[i]
    if (action === 'rename' && existing.includes(name)) {
      name = autoRename(name, existing)
    }
    existing.push(name)
    // false = single file; backend auto-upgrades to recursive for directories
    SftpPut(sid, localPaths[i], joinPath(cwd.value, name), false)
  }
}

async function onDropUpload(e: DragEvent) {
  e.preventDefault()
  clearDragState()
  // When Wails native file-drop is bound, it owns the upload.
  // Handling HTML5 drop as well causes duplicate transfer records.
  if (fileDropBound) return
  if (Date.now() - lastWailsDropAt < 800) return

  const sid = sessionId.value
  if (!sid) return

  const dropped = e.dataTransfer?.files
  if (!dropped?.length) return

  // Prefer native paths if WebView exposes them
  const nativePaths: string[] = []
  for (let i = 0; i < dropped.length; i++) {
    const p = (dropped[i] as any).path as string | undefined
    if (p) nativePaths.push(p)
  }
  if (nativePaths.length === dropped.length) {
    await uploadLocalPaths(nativePaths)
    return
  }

  const fileList = Array.from(dropped).filter(f => f.size > 0 || f.type)
  // Folder drops without native paths aren't supported via FileReader
  if (!fileList.length) {
    msg.warning(t('companion.folderDropHint'))
    return
  }

  const names = fileList.map(f => f.name)
  const action = await resolveConflicts(names)
  if (action === 'cancel') return

  const existing = files.value.map(f => f.name)
  preparingUpload.value = true
    try {
    for (const f of fileList) {
      let resolvedName = f.name
      if (action === 'rename' && existing.includes(f.name)) {
        resolvedName = autoRename(f.name, existing)
      }
      existing.push(resolvedName)
      const remotePath = joinPath(cwd.value, resolvedName)
      await readAndUpload(f, remotePath)
    }
  } finally {
    preparingUpload.value = false
  }
}

function bindFileDrop() {
  if (fileDropBound) return
  try {
    fileDropUnsub = Events.On('common:WindowFilesDropped', (ev) => {
      const d = ev.data as { x: number; y: number; elementId?: string; filenames: string[] }
      if (!companionStore.filesVisible || !sessionId.value) return
      if (!d?.filenames?.length) return
      // Only react to drops that landed on this sidebar's own drop zone; the
      // SFTP tab's remote pane is also a data-file-drop-target and shares the
      // same event.
      if (d.elementId && d.elementId !== FILE_DROP_ID) return
      lastWailsDropAt = Date.now()
      clearDragState()
      uploadLocalPaths(d.filenames)
    })
    fileDropBound = true
  } catch {
    // runtime may be unavailable in browser preview
  }
}

function unbindFileDrop() {
  if (!fileDropBound) return
  try { fileDropUnsub?.(); fileDropUnsub = null } catch { /* ignore */ }
  fileDropBound = false
}

function clearFinishedTransfers() {
  const tasks = transferTasks.value
  for (let i = tasks.length - 1; i >= 0; i--) {
    const st = tasks[i].status
    if (st === 'done' || st === 'error' || st === 'cancelled') {
      tasks.splice(i, 1)
    }
  }
}

async function onDownloadTo(items: FileItem[]) {
  const sid = sessionId.value
  if (!sid) return
  try {
    const dir = await OpenDirectoryDialog()
    if (!dir) return
        for (const item of items) {
      if (item.name === '..') continue
      const remotePath = joinPath(cwd.value, item.name)
      const localPath = (dir + '/' + item.name).replace(/\\/g, '/')
      SftpGet(sid, remotePath, localPath, item.isDir)
    }
  } catch (e) {
    console.error('downloadTo:', e)
  }
}

async function onRename(item: FileItem) {
  const sid = sessionId.value
  if (!sid) return
  try {
    const { value } = await ElMessageBox.prompt(t('sftp.rename'), t('sftp.rename'), {
      inputValue: item.name,
      confirmButtonText: t('sftp.dialog.confirm'),
      cancelButtonText: t('sftp.dialog.cancel'),
    })
    if (!value || value === item.name) return
    await SftpRename(sid, joinPath(cwd.value, item.name), joinPath(cwd.value, value))
    scheduleRefresh()
  } catch { /* cancelled */ }
}

async function onDelete(items: FileItem[]) {
  const sid = sessionId.value
  if (!sid) return
  const targets = items.filter(i => i.name !== '..')
  if (!targets.length) return
  try {
    await ElMessageBox.confirm(
      t('sftp.dialog.deleteConfirmMixed', { count: targets.length }),
      t('sftp.dialog.deleteTitle'),
      { type: 'warning', confirmButtonText: t('sftp.dialog.confirm'), cancelButtonText: t('sftp.dialog.cancel') }
    )
    const names = new Set(targets.map(i => i.name))
    // Stop any in-flight upload/download of these files first — otherwise
    // SftpRemove can block forever while the transfer holds the SFTP handle.
    for (const task of [...transferTasks.value]) {
      if ((task.status === 'running' || task.status === 'paused') && names.has(task.name)) {
        try { await SftpCancelTransfer(sid, task.id) } catch { /* ignore */ }
        task.status = 'cancelled'
      }
    }

    // Optimistic UI — remove from list immediately so delete never "looks stuck"
    files.value = files.value.filter(f => !names.has(f.name))

    for (const item of targets) {
      try {
        await withTimeout(
          SftpRemove(sid, joinPath(cwd.value, item.name), item.isDir),
          REMOVE_TIMEOUT_MS,
          'remove',
        )
      } catch (e: any) {
        const err = e?.toString?.() || String(e)
        // File may already be gone — ignore not-found; otherwise put back & report
        if (!/no such file|not found|no such file or directory|timeout/i.test(err)) {
          msg.error(err)
          if (!files.value.some(f => f.name === item.name)) {
            files.value = [...files.value, item]
          }
        } else if (/timeout/i.test(err)) {
          // Likely deleted on server but reply stalled — keep optimistic removal
          msg.warning(t('companion.deleteTimeout'))
        }
      }
    }
    scheduleRefresh(300)
  } catch { /* cancelled */ }
}

async function onMkdir() {
  const sid = sessionId.value
  if (!sid) return
  try {
    const { value } = await ElMessageBox.prompt(t('sftp.newDirectory'), t('sftp.newDirectory'), {
      confirmButtonText: t('sftp.dialog.confirm'),
      cancelButtonText: t('sftp.dialog.cancel'),
    })
    if (!value) return
    await SftpMakeDir(sid, joinPath(cwd.value, value))
    scheduleRefresh()
  } catch { /* cancelled */ }
}

async function onNewFile() {
  const sid = sessionId.value
  if (!sid) return
  try {
    const { value } = await ElMessageBox.prompt(t('sftp.newFile'), t('sftp.newFile'), {
      confirmButtonText: t('sftp.dialog.confirm'),
      cancelButtonText: t('sftp.dialog.cancel'),
    })
    if (!value) return
    await SftpPutContent(sid, joinPath(cwd.value, value), '', 'utf-8')
    scheduleRefresh()
  } catch { /* cancelled */ }
}

async function onChmod(item: FileItem) {
  const sid = sessionId.value
  if (!sid) return
  try {
    const { value } = await ElMessageBox.prompt(t('sftp.changePermission'), t('sftp.changePermission'), {
      inputValue: '644',
      confirmButtonText: t('sftp.dialog.confirm'),
      cancelButtonText: t('sftp.dialog.cancel'),
    })
    if (!value) return
    await SftpChmod(sid, joinPath(cwd.value, item.name), value)
    scheduleRefresh()
  } catch { /* cancelled */ }
}

// ── Remote file editor ──
type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gbk'
type LineEnding = 'lf' | 'crlf' | 'cr'

const editorVisible = ref(false)
const editorTitle = ref('')
const editorPath = ref('')
const editorContent = ref('')
const editorRawBytes = ref<Uint8Array | null>(null)
const editorSaving = ref(false)
const editorEncoding = ref<Encoding>('utf-8')
const editorLineEnding = ref<LineEnding>('lf')
const syntaxEditorRef = ref<{ focus: () => void } | null>(null)

const editorLangLabel = computed(() => {
  const path = editorPath.value
  if (!path) return ''
  const base = path.replace(/\\/g, '/').split('/').pop() || ''
  const lower = base.toLowerCase()
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'Dockerfile'
  if (lower === '.bashrc' || lower === '.zshrc' || lower === '.profile') return 'Shell'
  const i = lower.lastIndexOf('.')
  const ext = i >= 0 ? lower.slice(i + 1) : ''
  const map: Record<string, string> = {
    json: 'JSON', jsonc: 'JSON', js: 'JavaScript', ts: 'TypeScript',
    sh: 'Shell', bash: 'Shell', zsh: 'Shell',
    conf: 'Config', cfg: 'Config', ini: 'INI', properties: 'Properties',
    yml: 'YAML', yaml: 'YAML', xml: 'XML', html: 'HTML', css: 'CSS',
    py: 'Python', sql: 'SQL', md: 'Markdown', toml: 'TOML',
    service: 'Config', vue: 'Vue',
  }
  return map[ext] || (ext ? ext.toUpperCase() : '')
})

function onEditorOpened() {
  nextTick(() => syntaxEditorRef.value?.focus())
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function isBinaryContent(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 8192)
  if (!sample.length) return false
  let nonPrintable = 0
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i]
    if (c < 0x09 || (c > 0x0D && c < 0x20)) nonPrintable++
  }
  return nonPrintable > sample.length * 0.3
}

function detectEncoding(bytes: Uint8Array): Encoding {
  if (bytes.length >= 2) {
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le'
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be'
  }
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8'
  try {
    const sample = bytes.slice(0, 8192)
    let i = 0
    let valid = true
    while (i < sample.length) {
      const b = sample[i]
      if (b < 0x80) { i++; continue }
      let trailing: number
      if ((b & 0xE0) === 0xC0) trailing = 1
      else if ((b & 0xF0) === 0xE0) trailing = 2
      else if ((b & 0xF8) === 0xF0) trailing = 3
      else { valid = false; break }
      if (i + trailing >= sample.length) { valid = false; break }
      for (let j = 1; j <= trailing; j++) {
        if ((sample[i + j] & 0xC0) !== 0x80) { valid = false; break }
      }
      if (!valid) break
      i += trailing + 1
    }
    if (valid) return 'utf-8'
  } catch { /* fall through */ }
  return 'gbk'
}

function detectLineEnding(text: string): LineEnding {
  let crlf = 0, lf = 0, cr = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r' && text[i + 1] === '\n') { crlf++; i++ }
    else if (text[i] === '\n') lf++
    else if (text[i] === '\r') cr++
  }
  if (crlf > lf && crlf > cr) return 'crlf'
  if (cr > lf && cr > crlf) return 'cr'
  return 'lf'
}

function decodeContent(bytes: Uint8Array, enc: Encoding): string {
  if (enc === 'gbk') {
    try { return new TextDecoder('gbk').decode(bytes) }
    catch { return new TextDecoder('gb18030').decode(bytes) }
  }
  return new TextDecoder(enc === 'utf-16le' ? 'utf-16le' : enc === 'utf-16be' ? 'utf-16be' : 'utf-8').decode(bytes)
}

function encodeContent(text: string, enc: Encoding, lineEnding: LineEnding): string {
  let normalized = text
  if (lineEnding === 'crlf') normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  else if (lineEnding === 'cr') normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r')
  else normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (enc === 'utf-8' || enc === 'gbk') return toBase64(normalized)
  const buf = new Uint8Array(normalized.length * 2 + 2)
  let pos = 0
  buf[pos++] = enc === 'utf-16le' ? 0xFF : 0xFE
  buf[pos++] = enc === 'utf-16le' ? 0xFE : 0xFF
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    buf[pos++] = enc === 'utf-16le' ? (code & 0xFF) : ((code >> 8) & 0xFF)
    buf[pos++] = enc === 'utf-16le' ? ((code >> 8) & 0xFF) : (code & 0xFF)
  }
  let binary = ''
  for (let i = 0; i < pos; i++) binary += String.fromCharCode(buf[i])
  return btoa(binary)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

watch(editorEncoding, (newEnc) => {
  if (editorVisible.value && editorRawBytes.value) {
    editorContent.value = decodeContent(editorRawBytes.value, newEnc)
  }
})

async function onEditFile(item: FileItem) {
  if (item.isDir) return
  const sid = sessionId.value
  if (!sid) return
  if (item.size > 5 * 1024 * 1024) {
    msg.warning(t('sftp.edit.fileTooLarge'))
    return
  }
  if (item.size > 500 * 1024) {
    const ok = window.confirm(t('sftp.edit.fileLargeWarning', { size: formatFileSize(item.size) }))
    if (!ok) return
  }
  editorPath.value = joinPath(cwd.value, item.name)
  editorTitle.value = t('sftp.dialog.editTitle', { path: editorPath.value })
  editorContent.value = ''
  editorRawBytes.value = null
  editorVisible.value = true
  try {
    const rawB64 = await SftpGetContent(sid, editorPath.value)
    const bytes = fromBase64(rawB64)
    if (isBinaryContent(bytes)) {
      editorVisible.value = false
      msg.warning(t('sftp.edit.binaryFile'))
      return
    }
    const detected = detectEncoding(bytes)
    editorEncoding.value = detected
    editorRawBytes.value = bytes
    const text = decodeContent(bytes, detected)
    editorLineEnding.value = detectLineEnding(text)
    editorContent.value = text
  } catch (e: any) {
    editorVisible.value = false
    msg.error(e?.toString() || 'Failed to read file')
  }
}

async function onEditorSave() {
  const sid = sessionId.value
  if (!sid) return
  editorSaving.value = true
  try {
    await SftpPutContent(
      sid,
      editorPath.value,
      encodeContent(editorContent.value, editorEncoding.value, editorLineEnding.value),
      editorEncoding.value,
    )
    msg.success(t('sftp.edit.saveSuccess'))
    editorVisible.value = false
    onRefresh()
  } catch (e: any) {
    msg.error(e?.toString() || 'Failed to save file')
  } finally {
    editorSaving.value = false
  }
}

async function onCancelTransfer(taskId: string) {
  const sid = sessionId.value
  if (!sid) return
  try { await SftpCancelTransfer(sid, taskId) } catch {}
}
async function onPauseTransfer(taskId: string) {
  const sid = sessionId.value
  if (!sid) return
  try { await SftpPauseTransfer(sid, taskId) } catch {}
}
async function onResumeTransfer(taskId: string) {
  const sid = sessionId.value
  if (!sid) return
  try { await SftpResumeTransfer(sid, taskId) } catch {}
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return Math.round(bytesPerSec) + ' B/s'
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s'
  return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s'
}

function formatETA(seconds: number): string {
  if (seconds < 1) return ''
  if (seconds < 60) return Math.round(seconds) + 's'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + Math.round(seconds % 60) + 's'
  return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm'
}

let unsubStatus: (() => void) | null = null
let unsubData: (() => void) | null = null

function bindListeners() {
  unsubStatus?.()
  unsubData?.()
  unsubStatus =Events.On('session:status', (ev) => { const payload: { id: string; status: string } = ev.data; 
    if (payload.id !== sessionId.value) return
    if (payload.status === 'connected') {
      onRefresh()
    } else if (payload.status === 'error') {
      connectError.value = t('sftp.connectError')
    }
   })
  unsubData =Events.On('session:data', (ev) => { const payload: { id: string; data: string } = ev.data; 
    if (payload.id !== sessionId.value) return
    const connMatch = payload.data.match(/\[Connection failed: ([^\]]+)\]/)
    if (connMatch) {
      connectError.value = connMatch[1]
      msg.error(connMatch[1])
      return
    }
    const match = payload.data.match(/\x1b\]633;S([^\x07]*)\x07/)
    if (!match) return
    try {
      const m = JSON.parse(match[1])
      if (m.type !== 'sftp:transfer') return
      const tasks = transferTasks.value
      if (m.event === 'start') {
        const existing = tasks.find(t => t.id === m.taskId)
        if (existing) {
          existing.status = 'running'
          existing.lastBytes = 0
          existing.lastTime = Date.now()
        } else {
          tasks.push({
            id: m.taskId,
            type: m.tfType,
            name: m.name,
            percentage: 0,
            speed: '',
            eta: '',
            status: 'running',
            lastBytes: 0,
            lastTime: Date.now(),
            total: m.total || 0,
          })
          // Cap history length
          while (tasks.length > 80) tasks.shift()
        }
              } else if (m.event === 'progress') {
        const existing = tasks.find(t => t.id === m.taskId)
        if (existing) {
          existing.total = m.total || existing.total
          existing.percentage = existing.total > 0 ? Math.round((m.progress / existing.total) * 100) : 0
          const now = Date.now()
          const elapsed = (now - existing.lastTime) / 1000
          if (elapsed >= 0.5) {
            const bytesPerSec = (m.progress - existing.lastBytes) / elapsed
            existing.speed = formatSpeed(bytesPerSec)
            if (bytesPerSec > 0 && existing.total > 0) {
              existing.eta = formatETA((existing.total - m.progress) / bytesPerSec)
            }
            existing.lastBytes = m.progress
            existing.lastTime = now
          }
        }
      } else if (m.event === 'complete') {
        const existing = tasks.find(t => t.id === m.taskId)
        if (existing) {
          const st = m.status as string
          existing.status = st === 'done' ? 'done' : st === 'cancelled' ? 'cancelled' : st === 'paused' ? 'paused' : 'error'
          if (existing.status === 'done') {
            existing.percentage = 100
            scheduleRefresh(400)
          }
        }
      }
    } catch { /* ignore */ }
   })
}

/** Restore this panel's cached listing; returns true if a non-empty cache existed. */
function restoreCache(): boolean {
  const pid = companionStore.activeSshPanelId
  const cached = pid ? companionStore.getFileViewCache(pid) : null
  if (!cached || !cached.files.length) return false
  cwd.value = cached.cwd
  files.value = cached.files as FileItem[]
  return true
}

watch(sessionId, async (sid) => {
  // Re-entering an already-visited tab: restore its cached listing instead of
  // re-fetching it, so switching back shows the previous content instantly.
  if (restoreCache()) {
    if (sid) bindListeners()
    return
  }
  files.value = []
  cwd.value = ''
  if (!sid) return
  bindListeners()
  try {
    const sessions = await ListSessions()
    const sess = sessions.find(s => s.id === sid)
    if (sess?.status === 'connected') await onRefresh()
    else scheduleRefreshRetry()
  } catch {
    scheduleRefreshRetry()
  }
})

// Persist the current listing per SSH panel so a later switch-back can restore it.
watch([files, cwd], () => {
  const pid = companionStore.activeSshPanelId
  if (!pid) return
  companionStore.setFileViewCache(pid, { cwd: cwd.value, files: files.value })
})

watch(() => companionStore.filesVisible, (v) => {
  if (v) {
    ensureConnected()
    bindFileDrop()
  } else {
    unbindFileDrop()
  }
})

watch(() => companionStore.activeSshPanelId, () => {
  if (companionStore.filesVisible) ensureConnected()
})

onMounted(() => {
  bindListeners()
  // Re-mounting after the view was hidden (e.g. switching files<->monitor):
  // restore this panel's cached listing since the session didn't change.
  restoreCache()
  if (companionStore.filesVisible) {
    ensureConnected()
    bindFileDrop()
  }
})

onUnmounted(() => {
  unsubStatus?.()
  unsubData?.()
  unbindFileDrop()
  if (refreshTimer) clearTimeout(refreshTimer)
})
</script>

<style scoped>
.companion-sidebar {
  background: transparent;
  display: flex;
  flex-direction: column;
  position: relative;
  flex: 1 1 0;
  width: 100%;
  height: auto;
  min-height: 0;
  overflow: hidden;
}
.companion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.companion-actions {
  display: flex;
  gap: 2px;
  align-items: center;
}
.companion-action-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  position: relative;
  font-size: 11px;
}
.companion-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.companion-action-btn.active {
  color: var(--accent, #22d3ee);
  background: var(--bg-hover);
}
.companion-action-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.transfer-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--accent, #22d3ee);
  color: #0b1220;
  font-size: 10px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}
.companion-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
  padding: 16px;
  text-align: center;
}
.file-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  position: relative;
}
.file-body.drag-active {
  outline: 1px solid var(--accent, #22d3ee);
  outline-offset: -1px;
}
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--scrim, rgba(0, 0, 0, 0.45));
  pointer-events: none;
}
.drop-overlay span {
  font-size: 14px;
  color: var(--text-primary);
  padding: 12px 24px;
  border: 2px dashed var(--border-hover, var(--accent, #22d3ee));
  border-radius: 8px;
  background: var(--bg-elevated, rgba(0, 0, 0, 0.35));
}
.transfer-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-surface, var(--bg-elevated));
  min-height: 0;
}
.transfer-panel-resize {
  height: 5px;
  flex-shrink: 0;
  cursor: ns-resize;
  background: transparent;
}
.transfer-panel-resize:hover {
  background: var(--bg-hover);
}
.transfer-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.transfer-panel-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.transfer-empty {
  padding: 16px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}
.transfer-panel :deep(.transfer-progress-bar) {
  border-top: none;
  max-height: none;
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 8px;
}
.file-footer {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-muted);
  border-top: 1px solid var(--border-subtle);
}
.footer-transfer {
  color: var(--accent, #22d3ee);
  cursor: pointer;
}
.footer-transfer:hover {
  text-decoration: underline;
}
.companion-editor-meta {
  margin-bottom: 8px;
}
.lang-badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-hover, rgba(255,255,255,0.08));
  color: var(--text-secondary);
}
.companion-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.companion-editor-opts {
  display: flex;
  gap: 8px;
}
</style>
