<template>
  <div class="rdp-tab-content">
    <!-- Connecting state -->
    <div v-if="status === 'connecting'" class="rdp-overlay">
      <el-icon class="is-loading" :size="'2rem'"><Loader /></el-icon>
      <p>{{ t('rdp.connecting', { host: config?.host || '...' }) }}</p>
    </div>

    <!-- Error state -->
    <div v-else-if="status === 'error'" class="rdp-overlay">
      <p class="rdp-error-text">{{ t('rdp.error') }}</p>
      <p v-if="errorMessage" class="rdp-error-detail">{{ errorMessage }}</p>
      <el-button type="primary" @click="reconnect">{{ t('rdp.retry') }}</el-button>
    </div>

    <!-- Disconnected state -->
    <div v-else-if="status === 'disconnected'" class="rdp-overlay">
      <p>{{ t('rdp.disconnected') }}</p>
      <el-button type="primary" @click="reconnect">{{ t('rdp.reconnect') }}</el-button>
    </div>

    <!-- Connected: placeholder div overlaid by native RDP popup window -->
    <div
      v-show="status === 'connected'"
      class="rdp-area"
    />

    <!-- Status bar -->
    <div v-if="status === 'connected'" class="rdp-statusbar">
      <span class="rdp-status-dot" />
      <span>{{ t('rdp.connected') }}</span>
      <span class="rdp-status-sep">|</span>
      <span>{{ config?.host }}:{{ config?.port || 3389 }}</span>
      <span class="rdp-status-sep">|</span>
      <span class="rdp-status-label">{{ t('remoteDesktop.resolution') }}</span>
      <el-select
        v-model="activeResolution"
        class="rdp-quality-select"
        :disabled="status === 'connecting'"
        :aria-label="t('remoteDesktop.resolution')"
        @change="onResolutionChange"
      >
        <el-option v-for="r in resolutionOptions" :key="r.value" :value="r.value" :label="r.label" />
      </el-select>
      <span class="rdp-status-sep">|</span>
      <span class="rdp-status-label">{{ t('remoteDesktop.scale') }}</span>
      <RemoteDesktopZoomSelect
        v-model="zoom"
        :disabled="status === 'connecting'"
        :allow-fit="activeResolution !== 'adaptive'"
      />
      <span class="rdp-status-sep">|</span>
      <span class="rdp-status-label">{{ t('conn.rdpQuality') }}</span>
      <el-select
        v-model="activeQuality"
        class="rdp-quality-select"
        :disabled="status === 'connecting'"
        :aria-label="t('conn.rdpQuality')"
        @change="onQualityChange"
      >
        <el-option v-for="q in RDP_QUALITY_OPTIONS" :key="q.value" :value="q.value" :label="t(q.label)" />
      </el-select>
      <span class="rdp-status-spacer" />
      <button class="rdp-fullscreen-btn" @click="enterFullScreen">{{ t('rdp.fullscreen') }}</button>
    </div>

    <RemoteDesktopToolbar
      v-if="isFullscreen"
      v-model:zoom="zoom"
      :allow-fit="activeResolution !== 'adaptive'"
      selects
      :host="config?.host || ''"
      :port="config?.port || 3389"
      :disabled="status !== 'connected'"
      @restore="toggleFullscreen"
      @focus-desktop="focusDesktop"
      @minimize="onFocusOut"
      @error="onToolbarError"
    >
      <template #displays>
        <el-select
          v-model="activeResolution"
          class="remote-desktop-toolbar-select"
          :teleported="false"
          :fit-input-width="false"
          :disabled="status === 'connecting'"
          :aria-label="t('remoteDesktop.resolution')"
          @change="onResolutionChange"
        >
          <el-option v-for="r in resolutionOptions" :key="r.value" :value="r.value" :label="r.label" />
        </el-select>
        <span class="rdp-status-sep">|</span>
        <el-select
          v-model="activeQuality"
          class="remote-desktop-toolbar-select"
          :teleported="false"
          :fit-input-width="false"
          :disabled="status === 'connecting'"
          :aria-label="t('conn.rdpQuality')"
          @change="onQualityChange"
        >
          <el-option v-for="q in RDP_QUALITY_OPTIONS" :key="q.value" :value="q.value" :label="t(q.label)" />
        </el-select>
        <span class="rdp-status-sep">|</span>
      </template>
    </RemoteDesktopToolbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Loader } from '@lucide/vue'
import RemoteDesktopToolbar from './RemoteDesktopToolbar.vue'
import { useI18n } from '../i18n'
import type { ConnectionConfig } from '../types/session'
import { CreateSession, CloseSession, RDPHide, RDPSetFullScreen } from '../../bindings/github.com/ys-ll/uniterm/app'
import { backendErrorText, backendErrorTextOf } from '../utils/backendError'
import { Events } from '@wailsio/runtime'
import { usePanelStore } from '../stores/panelStore'
import { writeClipboard, readClipboardText } from '../composables/useClipboardWrite'
import { useConnectionStore } from '../stores/connectionStore'
import { RdpClipboardSync, RdpInputQueue } from '../utils/rdpClipboard'
import { RdpFileTransfer } from '../utils/rdpFileTransfer'
import { adaptiveRdpSize, rdpPointerPosition } from '../utils/rdpGeometry'
import type { RdpDesktopSize } from '../utils/rdpGeometry'
import { DEFAULT_RDP_QUALITY, normalizeRdpQuality, rdpQualityProfile } from '../utils/rdpQuality'
import type { RdpQuality } from '../utils/rdpQuality'
import { RDP_RESOLUTION_PRESETS, resolutionSentinels, seedResolutionChoice } from '../utils/rdpResolutions'
import type { RdpResolutionChoice } from '../utils/rdpResolutions'
import { adaptiveSizeRatio, zoomedCssSize } from '../utils/rdpZoom'
import RemoteDesktopZoomSelect from './RemoteDesktopZoomSelect.vue'
import { useRemoteDesktopPreferences } from '../composables/useRemoteDesktopPreferences'
import { queueRemoteKeyboardChange, isRdpPasteKey, REMOTE_KEY_SCANCODES as KEY_SCANCODES } from '../utils/remoteKeyboard'
import type { NativeRdpKey } from '../utils/remoteKeyboard'

const { t } = useI18n()
const panelStore = usePanelStore()
const connectionStore = useConnectionStore()

const props = defineProps<{
  panelId: string
  config: ConnectionConfig | null
  sessionId: string | null
}>()

const status = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
// Graphics/network tier. Seed from the saved connection; the status bar
// selector overrides it for the next (re)connect and persists the choice.
const activeQuality = ref<RdpQuality>(normalizeRdpQuality(props.config?.rdpQuality))
// The tier the running session was actually started with — the select may
// hold a newer value until the reconnect it triggers completes.
const sessionQuality = ref<RdpQuality>(activeQuality.value)
// Resolution mode (adaptive / fullscreen / fixed WxH). Seeded from the saved
// connection; the status bar selector overrides it and persists the choice.
// Component state, not props.config — the panel holds a snapshot taken at
// creation and never sees later edits.
const activeResolution = ref<RdpResolutionChoice>(seedResolutionChoice(props.config))
const sessionResolution = ref<RdpResolutionChoice>(activeResolution.value)
const currentSessionId = ref<string | null>(props.sessionId)
const errorMessage = ref<string>('')
const container = ref<HTMLDivElement | null>(null)
// Display zoom from the shared desktop preferences: a number scales the
// canvas to that factor (default 100%), 'adaptive' CSS-fits the pane — and
// with adaptive resolution a numeric factor drives the negotiated desktop
// size in place of devicePixelRatio.
const { zoom } = useRemoteDesktopPreferences(() => props.config)
const isFullscreen = ref(false)
const keyboardFocused = ref(false)
let keyboardCaptureId = ''
let keyboardHeartbeat: ReturnType<typeof setInterval> | null = null
const viewportEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const displayPixelRatio = ref(window.devicePixelRatio || 1)
const framebufferSize = ref<RdpDesktopSize | null>(null)
const viewportSize = ref<RdpDesktopSize>({ width: 0, height: 0 })
const scaleCanvas = computed(() => {
  if (zoom.value === 'stretch') return true
  if (zoom.value !== 'adaptive') return false
  if (!isAdaptive() || !framebufferSize.value) return true
  const target = adaptiveRdpSize(viewportSize.value.width, viewportSize.value.height, adaptiveSizeRatio(zoom.value, displayPixelRatio.value))
  return framebufferSize.value.width !== target.width || framebufferSize.value.height !== target.height
})
const canvasStyle = computed<import('vue').CSSProperties | undefined>(() => {
  const fb = framebufferSize.value
  if (!fb) return undefined
  if (zoom.value === 'stretch') {
    // Ignore the aspect ratio: fill the pane edge to edge.
    return { width: '100%', height: '100%', objectFit: 'fill' }
  }
  if (typeof zoom.value !== 'number') return undefined
  // Physical zoom: 100% renders one framebuffer pixel per device pixel.
  return {
    width: `${zoomedCssSize(fb.width, zoom.value, displayPixelRatio.value)}px`,
    height: `${zoomedCssSize(fb.height, zoom.value, displayPixelRatio.value)}px`,
  }
})

const CONNECT_TIMEOUT = 30_000 // 30 seconds

const RDP_QUALITY_OPTIONS: { value: RdpQuality; label: string }[] = [
  { value: 'high', label: 'conn.rdpQualityHigh' },
  { value: 'balanced', label: 'conn.rdpQualityBalanced' },
  { value: 'low', label: 'conn.rdpQualityLow' },
]

const resolutionOptions = computed(() => [
  { value: 'adaptive' as const, label: t('remoteDesktop.resAdaptive') },
  { value: 'fullscreen' as const, label: t('remoteDesktop.fullscreen') },
  ...RDP_RESOLUTION_PRESETS.map(r => ({ value: `${r.w}x${r.h}` as RdpResolutionChoice, label: r.label })),
])

// Switching the tier needs a new session (connection_type and performance
// flags are negotiated at connect time). Persist the choice on the
// connection like the other status bar preferences. sessionQuality is the
// comparison baseline: v-model has already written the select's value into
// activeQuality by the time @change fires.
function onQualityChange(quality: RdpQuality) {
  if (quality === sessionQuality.value) return
  if (props.config?.id) void connectionStore.update(props.config.id, { rdpQuality: quality })
  if (status.value !== 'connecting') void reconnect()
}

// Same contract as the quality tier: new framebuffer geometry is negotiated
// at connect, so the switch persists and reconnects. Custom sizes stay in
// the connection form; the bar offers adaptive/fullscreen + presets.
function onResolutionChange(choice: RdpResolutionChoice) {
  if (choice === sessionResolution.value) return
  if (props.config?.id) {
    void connectionStore.update(props.config.id, resolutionSentinels(choice))
  }
  if (status.value !== 'connecting') void reconnect()
}

// Zoom applies live (CSS + Display Control resize for adaptive), no
// reconnect. The shared preferences hook persists the choice.


// Frontend log channel → app log file (~/.uniterm/uniterm.log), alongside the
// Go proxy's [IronRDPProxy] lines.
function rdpLog(message: string) {
  try { FrontendLog('rdp', message) } catch (_) { console.error(message) }
}

let connectTimer: ReturnType<typeof setTimeout> | null = null

function clearConnectTimer() {
  if (connectTimer !== null) {
    clearTimeout(connectTimer)
    connectTimer = null
  }
}

// Desktop size from the active resolution choice (fullscreen follows the
// primary monitor, adaptive follows the viewport, fixed is explicit),
// clamped to the u16 the protocol carries.
function resolveDesktopSize(): { width: number; height: number } {
  const choice = activeResolution.value
  let width = 1280
  let height = 720
  if (choice === 'fullscreen') {
    width = window.screen?.width || 1280
    height = window.screen?.height || 720
  } else if (choice === 'adaptive') {
    const size = adaptiveDesktopSize()
    if (size) return size
  } else {
    const { rdpFixedWidth: w, rdpFixedHeight: h } = resolutionSentinels(choice)
    width = w
    height = h
  }
  // Guard against a NaN leaking into the GCC desktop size: the server
  // answers the whole handshake with a disconnect.
  if (!Number.isFinite(width)) width = 1280
  if (!Number.isFinite(height)) height = 720
  return {
    width: Math.max(640, Math.min(0xffff, Math.round(width))),
    height: Math.max(480, Math.min(0xffff, Math.round(height))),
  }
}

// "DOMAIN\user" falls back to domain like mstsc accepts; rdpDomain wins.
function splitDomainUser(cfg: ConnectionConfig): { username: string; domain: string } {
  let username = cfg.user || ''
  let domain = cfg.rdpDomain || ''
  const idx = username.indexOf('\\')
  if (idx > 0 && !domain) {
    domain = username.slice(0, idx)
    username = username.slice(idx + 1)
  }
  return { username, domain }
}

async function startClient(proxyUrl: string, desktopSizeOverride?: RdpDesktopSize) {
  if (started || !props.config || !canvasEl.value) return
  if (clientGeneration === 0) activeCredSSP = props.config.rdpEnableNLA ?? false
  started = true
  const generation = ++clientGeneration
  status.value = 'connecting'
  errorMessage.value = ''

  // Start timeout timer
  clearConnectTimer()
  connectTimer = setTimeout(() => {
    if (status.value === 'connecting') {
      errorMessage.value = t('rdp.timeout')
      status.value = 'error'
      if (currentSessionId.value) {
        try { CloseSession(currentSessionId.value) } catch (_) {}
      }
    }
  }, CONNECT_TIMEOUT)

  try {
    const mod = await loadWasm()
    if (generation !== clientGeneration) return
    const { username, domain } = splitDomainUser(props.config)
    const size = desktopSizeOverride ?? resolveDesktopSize()
    lastResizeRequest = desktopSizeOverride ?? null
    rdpLog(`client start: tier=${activeQuality.value} res=${activeResolution.value} zoom=${zoom.value} size=${size.width}x${size.height} credssp=${activeCredSSP} displayControl=${isAdaptive()} gen=${generation}`)

    // proxyUrl: ws://127.0.0.1:<port>/<token> — the token path doubles as
    // the gateway auth token the RDCleanPath handshake must echo.
    const url = new URL(proxyUrl)
    const authToken = url.pathname.slice(1)

    const builder = new mod.SessionBuilder()
      .username(username)
      .password(props.config.password || '')
      .destination(props.config.host)
      .proxyAddress(proxyUrl)
      .authToken(authToken)
      .desktopSize(new mod.DesktopSize(size.width, size.height))
      .renderCanvas(canvasEl.value)
    if (domain) builder.serverDomain(domain)
    builder.extension(new mod.Extension('enable_credssp', activeCredSSP))
    // Auto-logon with the saved credentials (mstsc saved-creds equivalent) —
    // requires the autologon extension patch in the WASM build.
    builder.extension(new mod.Extension('autologon', !!props.config.password))
    // Low-bandwidth tiers negotiate a smaller connection_type and strip
    // server-side graphics features (wallpaper, theming, animations). The
    // default tier equals the engine's built-in values, so it is not sent —
    // connections keep their current behavior on older WASM builds too.
    if (activeQuality.value !== DEFAULT_RDP_QUALITY) {
      const profile = rdpQualityProfile(activeQuality.value)
      builder.extension(new mod.Extension('connection_type', profile.connectionType))
      builder.extension(new mod.Extension('performance_flags', profile.performanceFlags))
    }
    sessionQuality.value = activeQuality.value
    sessionResolution.value = activeResolution.value
    // Servers with Display Control resize in place; older servers use the
    // reconnect fallback when the canvas does not reach the requested size.
    if (isAdaptive()) builder.extension(new mod.Extension('display_control', true))
    builder.setCursorStyleCallback(onCursorStyle)
    builder.setCursorStyleCallbackContext(null)
    builder.remoteClipboardChangedCallback((data: any) => {
      if (generation === clientGeneration) onRemoteClipboard(data)
      else data?.free?.()
    })
    builder.forceClipboardUpdateCallback(() => {
      if (generation !== clientGeneration) return
      clipboardSync?.requestFormatList().catch(error => rdpLog(`clipboard initialization failed: ${describeError(error)}`))
    })
    builder.extension(new mod.Extension('format_list_response_callback', (ok: boolean) => {
      if (generation !== clientGeneration) return
      if (ok) clipboardAck?.resolve()
      else clipboardAck?.reject(new Error('Remote rejected clipboard formats'))
    }))
    builder.extension(new mod.Extension('file_contents_request_callback', (request: any) => {
      if (generation === clientGeneration) fileTransfer?.onRequest(request)
    }))
    builder.extension(new mod.Extension('file_contents_response_callback', (response: any) => {
      if (generation === clientGeneration) fileTransfer?.onResponse(response)
    }))
    builder.extension(new mod.Extension('lock_callback', (id: number) => {
      if (generation === clientGeneration) fileTransfer?.lock(id)
    }))
    builder.extension(new mod.Extension('unlock_callback', (id: number) => {
      if (generation === clientGeneration) fileTransfer?.unlock(id)
    }))
    builder.extension(new mod.Extension('locks_expired_callback', (ids: number[]) => {
      if (generation === clientGeneration) ids.forEach(id => fileTransfer?.unlock(id))
    }))
    builder.extension(new mod.Extension('files_available_callback', (files: any[], clipDataId?: number) => {
      if (generation !== clientGeneration) return
      const transfer = fileTransfer
      if (!transfer) return
      transfer.cancelDownload()
      clipboardSync?.receiveFiles(() => transfer.download(files, clipDataId))
        .catch(error => rdpLog(`remote file copy failed: ${describeError(error)}`))
    }))

    const connectedSession = await builder.connect()
    if (generation !== clientGeneration) {
      connectedSession.shutdown()
      connectedSession.free?.()
      return
    }
    session = connectedSession
    clipboardSync = new RdpClipboardSync({
      read: async () => {
        // CF_HDROP takes precedence: Explorer may also expose a text path.
        const files = await ClipboardGetFiles()
        if (files.length) return { kind: 'files', files }
        const text = await readClipboardText()
        return text ? { kind: 'text', text } : null
      },
      publish: content => advertiseClipboard(connectedSession, async () => {
        if (content.kind === 'files') {
          fileTransfer?.setLocalFiles(content.files)
          await connectedSession.invokeExtension(new mod.Extension('initiate_file_copy', content.files))
        } else {
          fileTransfer?.setLocalFiles([])
          const data = new mod.ClipboardData()
          try {
            data.addText('text/plain', content.text)
            await connectedSession.onClipboardPaste(data)
          } finally { data.free() }
        }
      }),
      writeText: writeClipboard,
    })
    fileTransfer = new RdpFileTransfer({
      invoke: (name, value) => connectedSession.invokeExtension(new mod.Extension(name, value)),
      readChunk: ClipboardReadFileChunkByID,
      getFiles: ClipboardGetFiles,
      begin: ClipboardBeginFileTransfer,
      writeChunk: ClipboardWriteFileChunk,
      finish: ClipboardFinishFileTransfer,
      abort: ClipboardAbortFileTransfer,
      log: rdpLog,
    })
    status.value = 'connected'
    clearConnectTimer()
    startClipboardPoll()
    container.value?.focus()

    // run() resolves when the session terminates (cleanly or not).
    connectedSession.run().then(
      (term: any) => {
        if (session !== connectedSession) return
        let reason = ''
        if (typeof term?.reason === 'function') {
          const r = term.reason()
          reason = typeof r === 'string' ? r : JSON.stringify(r)
        }
        runEnded(reason)
      },
      (e: any) => {
        if (session !== connectedSession) return
        runEnded(describeError(e), true)
      },
    ).finally(() => connectedSession.free?.())
    nextTick(() => {
      if (generation === clientGeneration) onContainerResize()
    })
  } catch (e: any) {
    if (generation !== clientGeneration) return
    clearConnectTimer()
    const detail = describeError(e)
    rdpLog(`connect failed: ${detail}`)
    if (retryWithoutNLA(detail)) return
    errorMessage.value = detail
    status.value = 'error'
    teardownClient()
  }
}

function runEnded(reason: string, isError = false) {
  if (retryWithoutNLA(reason)) return
  onFocusOut()
  stopClipboardPoll()
  clearResizeProbe()
  pressedMouseButtons.clear()
  if (isError) rdpLog(`session failed: ${reason || '(unknown)'}`)
  if (status.value === 'connecting') {
    // Never reached an active session.
    errorMessage.value = reason || t('rdp.error')
    status.value = 'error'
    teardownClient()
    return
  }
  if (isError && reason) errorMessage.value = reason
  status.value = isError ? 'error' : 'disconnected'
  teardownClient()
}

function teardownClient() {
  onFocusOut()
  ++clientGeneration
  clearConnectTimer()
  stopClipboardPoll()
  clearResizeProbe()
  pressedMouseButtons.clear()
  if (session) {
    try { session.shutdown() } catch (_) {}
    session = null
  }
  started = false
}

async function connect() {
  if (!props.config) return
  status.value = 'connecting'
  errorMessage.value = ''
  try {
    const info = await CreateSession('rdp', { ...props.config, rdpEnableNLA: activeCredSSP })
    currentSessionId.value = info.id
    panelStore.bindSession(props.panelId, info.id)
  } catch (e) {
    console.error('RDP connect error:', e)
    errorMessage.value = backendErrorText(e)
    status.value = 'error'
    clearConnectTimer()
  }
}

async function reconnect() {
  clearConnectTimer()
  if (currentSessionId.value) {
    try { await CloseSession(currentSessionId.value) } catch (_) {}
    currentSessionId.value = null
  }
  await connect()
}

function retryWithoutNLA(reason: string): boolean {
  if (!activeCredSSP || nlaFallbackAttempted || framebufferSize.value) return false
  if (!/remote error: tls: internal error/i.test(reason)) return false
  nlaFallbackAttempted = true
  activeCredSSP = false
  status.value = 'connecting'
  errorMessage.value = ''
  rdpLog(`NLA handshake failed (${reason}); retrying with TLS login`)
  if (reconnecting) pendingNlaFallback = true
  else void reconnect()
  return true
}

function retryConnection() {
  if (reconnecting) return
  activeCredSSP = props.config?.rdpEnableNLA ?? false
  nlaFallbackAttempted = false
  void reconnect()
}


// ── Cursor / clipboard callbacks ──

function onCursorStyle(kind: string, data: string | undefined, hotspotX: number | undefined, hotspotY: number | undefined) {
  const canvas = canvasEl.value
  if (!canvas) return
  if (kind === 'default') canvas.style.cursor = 'default'
  else if (kind === 'none') canvas.style.cursor = 'none'
  else if (kind === 'url' && data) {
    const hx = typeof hotspotX === 'number' ? hotspotX : 0
    const hy = typeof hotspotY === 'number' ? hotspotY : 0
    canvas.style.cursor = `url(${data}) ${hx} ${hy}, default`
  }
}

function onRemoteClipboard(clipboardData: any) {
  let items: any[] = []
  try {
    items = clipboardData?.items?.() ?? []
    for (const item of items) {
      if (item.mimeType() === 'text/plain') {
        const value = item.value()
        if (typeof value === 'string') {
          fileTransfer?.cancelDownload()
          clipboardSync?.receiveText(value).catch(error => rdpLog(`remote clipboard write failed: ${describeError(error)}`))
        }
        break
      }
    }
  } catch (e) {
    rdpLog(`clipboard read failed: ${String(e)}`)
  } finally {
    for (const item of items) item.free?.()
    clipboardData?.free?.()
  }
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text')
  if (!text || !session || !wasmModule) return
  e.preventDefault()
  inputQueue.enqueue(() => syncLocalClipboardNow(text))
  // A native/menu paste has no forwarded key event of its own.
  inputQueue.enqueue(() => {
    const tx = new wasmModule.InputTransaction()
    for (const [code, down] of [[0x1d, true], [0x2f, true], [0x2f, false], [0x1d, false]] as const) {
      tx.addEvent(down ? wasmModule.DeviceEvent.keyPressed(code) : wasmModule.DeviceEvent.keyReleased(code))
    }
    session?.applyInputs(tx)
  })
}

// ── Input ──

// F12 stays local for devtools. The Windows hook swallows keys before Windows
// or WebView handles shortcuts; ordinary DOM events provide the fallback.
function isLocalKey(e: KeyboardEvent): boolean {
  return e.code === 'F12'
}

function sendScancode(scancode: number, down: boolean) {
  if (!session || !wasmModule) return
  try {
    const tx = new wasmModule.InputTransaction()
    tx.addEvent(down ? wasmModule.DeviceEvent.keyPressed(scancode) : wasmModule.DeviceEvent.keyReleased(scancode))
    session.applyInputs(tx)
  } catch (err) {
    rdpLog(`key send failed: ${String(err)}`)
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (isLocalKey(e) || !ownsRemoteKeyboard()) return
  // All following key transitions stay queued until the remote accepts the
  // local clipboard, including V/Insert-up and modifier releases.
  e.preventDefault()
  e.stopPropagation()
  const scancode = KEY_SCANCODES[e.code]
  if (scancode === undefined) return
  queueKey(scancode, true, e.repeat, e.ctrlKey, e.metaKey, e.shiftKey)
}

function onKeyUp(e: KeyboardEvent) {
  if (isLocalKey(e) || !ownsRemoteKeyboard()) return
  e.preventDefault()
  e.stopPropagation()
  const scancode = KEY_SCANCODES[e.code]
  if (scancode !== undefined) queueKey(scancode, false, false, false, false, false)
}

function queueKey(scancode: number, down: boolean, repeat: boolean, ctrl: boolean, meta: boolean, shift: boolean) {
  if (down && !repeat && isRdpPasteKey(scancode, ctrl, meta, shift)) {
    inputQueue.enqueue(() => syncLocalClipboardNow())
  }
  inputQueue.enqueue(() => sendScancode(scancode, down))
}

function ownsRemoteKeyboard(): boolean {
  return status.value === 'connected' && document.hasFocus() && document.activeElement === container.value
}

function onFocusIn() {
  if (!ownsRemoteKeyboard()) return
  keyboardFocused.value = true
  if (keyboardCaptureId || !currentSessionId.value) return
  const captureID = crypto.randomUUID()
  const sessionID = currentSessionId.value
  keyboardCaptureId = captureID
  queueRemoteKeyboardChange(() => SetRDPKeyboardCapture(sessionID, captureID, true))
    .then(enabled => {
      if (!enabled || keyboardCaptureId !== captureID) return
      let pending = false
      keyboardHeartbeat = setInterval(() => {
        if (!ownsRemoteKeyboard()) { onFocusOut(); return }
        if (pending) return
        pending = true
        queueRemoteKeyboardChange(() => SetRDPKeyboardCapture(sessionID, captureID, true))
          .catch(error => {
            if (keyboardCaptureId !== captureID) return
            if (keyboardHeartbeat !== null) clearInterval(keyboardHeartbeat)
            keyboardHeartbeat = null
            rdpLog(`keyboard capture failed: ${describeError(error)}`)
          })
          .finally(() => { pending = false })
      }, 1000)
    })
    .catch(error => rdpLog(`keyboard capture failed: ${describeError(error)}`))
}

function onNativeKey(data: NativeRdpKey) {
  if (data.captureID !== keyboardCaptureId || !ownsRemoteKeyboard()) return
  if (data.reset) {
    onFocusOut()
    onFocusIn()
    return
  }
  queueKey(data.scancode, data.down, data.repeat, data.ctrl, data.meta, data.shift)
}

function onVisibilityChange() {
  if (document.hidden) onFocusOut()
  else onFocusIn()
}

function onFocusOut() {
  if (keyboardHeartbeat !== null) clearInterval(keyboardHeartbeat)
  keyboardHeartbeat = null
  keyboardFocused.value = false
  const captureID = keyboardCaptureId
  keyboardCaptureId = ''
  if (captureID) {
    const sessionID = currentSessionId.value || ''
    queueRemoteKeyboardChange(() => SetRDPKeyboardCapture(sessionID, captureID, false))
      .catch(error => rdpLog(`keyboard release failed: ${describeError(error)}`))
  }
  inputQueue.clear()
  pressedMouseButtons.clear()
  // Prevent stuck keys when focus leaves the canvas mid-press.
  if (session) {
    try { session.releaseAllInputs() } catch (_) {}
  }
}

const pressedMouseButtons = new Set<number>()

function canvasCoords(e: MouseEvent, clampOutside = false): { x: number; y: number } | null {
  const canvas = canvasEl.value
  const size = currentDesktopSize()
  if (!canvas || !session || status.value !== 'connected' || !size) return null
  return rdpPointerPosition(e.clientX, e.clientY, canvas.getBoundingClientRect(), size, isAdaptive() || !scaleCanvas.value, clampOutside)
}

function sendMouseButton(e: MouseEvent, down: boolean) {
  if (!session || !wasmModule) return
  if (!down && !pressedMouseButtons.has(e.button)) return
  const pos = canvasCoords(e, !down)
  if (!pos) return
  e.preventDefault()
  try {
    container.value?.focus()
    const tx = new wasmModule.InputTransaction()
    tx.addEvent(wasmModule.DeviceEvent.mouseMove(pos.x, pos.y))
    tx.addEvent(down ? wasmModule.DeviceEvent.mouseButtonPressed(e.button) : wasmModule.DeviceEvent.mouseButtonReleased(e.button))
    session.applyInputs(tx)
    if (down) pressedMouseButtons.add(e.button)
    else pressedMouseButtons.delete(e.button)
  } catch (err) {
    rdpLog(`mouse send failed: ${String(err)}`)
  }
}

function onMouseDown(e: MouseEvent) {
  // Leave native scrollbars available when the desktop is larger than its pane.
  if (!scaleCanvas.value && e.target === viewportEl.value) return
  sendMouseButton(e, true)
}
function onWindowMouseUp(e: MouseEvent) { sendMouseButton(e, false) }

function onWindowMouseMove(e: MouseEvent) {
  if (pressedMouseButtons.size && e.target instanceof Node && !viewportEl.value?.contains(e.target)) onMouseMove(e)
}

function onMouseMove(e: MouseEvent) {
  if (!session || !wasmModule) return
  const pos = canvasCoords(e, pressedMouseButtons.size > 0)
  if (!pos) return
  try {
    const tx = new wasmModule.InputTransaction()
    tx.addEvent(wasmModule.DeviceEvent.mouseMove(pos.x, pos.y))
    session.applyInputs(tx)
  } catch (_) {}
}

function onWheel(e: WheelEvent) {
  if (!scaleCanvas.value && e.target === viewportEl.value) return
  if (!session || !wasmModule) return
  const pos = canvasCoords(e)
  if (!pos) return
  e.preventDefault()
  try {
    const tx = new wasmModule.InputTransaction()
    tx.addEvent(wasmModule.DeviceEvent.mouseMove(pos.x, pos.y))
    if (e.deltaY !== 0) {
      tx.addEvent(wasmModule.DeviceEvent.wheelRotations(true, Math.max(-1000, Math.min(1000, Math.round(e.deltaY))), wasmModule.RotationUnit.Pixel))
    }
    if (e.deltaX !== 0) {
      tx.addEvent(wasmModule.DeviceEvent.wheelRotations(false, Math.max(-1000, Math.min(1000, Math.round(e.deltaX))), wasmModule.RotationUnit.Pixel))
    }
    session.applyInputs(tx)
  } catch (_) {}
}

// ── Fullscreen ──

function focusDesktop() {
  if (status.value === 'connected') container.value?.focus({ preventScroll: true })
}

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === container.value
  nextTick(onContainerResize)
}

function onToolbarError(error: unknown) {
  rdpLog(`minimize error: ${String(error)}`)
}

async function toggleFullscreen() {
  const el = container.value
  if (!el) return
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await el.requestFullscreen()
    }
    el.focus()
  } catch (e) {
    rdpLog(`fullscreen error: ${String(e)}`)
  }
}

function onFullscreenEvent(event: Event) {
  if ((event as CustomEvent<{ panelId: string }>).detail?.panelId === props.panelId) void toggleFullscreen()
}

// ── Local clipboard push (mstsc-style) ──
// The webview has no clipboard-change event, so poll the local clipboard
// while the session is live and push it to the remote whenever it changes.
// By the time the user presses Ctrl+V in the remote app the content is
// already there — no paste-time race.
let clipPollTimer: ReturnType<typeof setInterval> | null = null

async function syncLocalClipboardNow(text?: string): Promise<void> {
  if (status.value === 'connected') await clipboardSync?.sync(false, text)
}

async function advertiseClipboard(target: any, send: () => Promise<void>): Promise<void> {
  if (session !== target) return
  // onClipboardPaste only queues a Rust event. Its promise does NOT mean
  // the remote has accepted the formats. Wait for the CLIPRDR response.
  let timer: ReturnType<typeof setTimeout> | undefined
  let acknowledgement: typeof clipboardAck = null
  const accepted = new Promise<void>((resolve, reject) => {
    acknowledgement = { resolve, reject }
    clipboardAck = acknowledgement
    timer = setTimeout(() => reject(new Error('Clipboard format acknowledgement timed out')), 5000)
  })
  try {
    await Promise.all([send(), accepted])
  } finally {
    clearTimeout(timer)
    if (clipboardAck === acknowledgement) clipboardAck = null
  }
}

function startClipboardPoll() {
  if (clipPollTimer !== null) clearInterval(clipPollTimer)
  clipPollTimer = setInterval(() => {
    // Hidden tabs must not replace the clipboard of another remote session.
    if (!document.hasFocus() || !container.value?.contains(document.activeElement)) return
    syncLocalClipboardNow().catch(error => rdpLog(`local clipboard sync failed: ${describeError(error)}`))
  }, 1000)
}

function stopClipboardPoll() {
  if (clipPollTimer !== null) {
    clearInterval(clipPollTimer)
    clipPollTimer = null
  }
  clipboardSync?.dispose()
  clipboardSync = null
  clipboardAck?.reject(new Error('RDP session closed'))
  clipboardAck = null
  fileTransfer?.dispose()
  fileTransfer = null
  inputQueue.clear()
}

// ── Adaptive resolution ──
// rdpFixedWidth -2: the desktop follows the tab's size. The Display Control
// channel asks the server to resize its framebuffer; until it takes effect
// the bitmap is CSS-scaled. Debounced so drag-resizing fires once at rest.

let resizeDebounce: ReturnType<typeof setTimeout> | null = null
let resizeProbeTimer: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null
let canvasObserver: MutationObserver | null = null
let pixelRatioQuery: MediaQueryList | null = null
let reconnecting = false
let lastResizeRequest: RdpDesktopSize | null = null
// Infer support from actual framebuffer changes, falling back to reconnect
// when the server does not handle Display Control resize requests.
let displayControlUsable: boolean | null = null
function isAdaptive(): boolean {
  return activeResolution.value === 'adaptive'
}

function adaptiveDesktopSize(): RdpDesktopSize | null {
  const bounds = viewportEl.value?.getBoundingClientRect()
  return bounds && bounds.width > 0 && bounds.height > 0
    ? adaptiveRdpSize(bounds.width, bounds.height, adaptiveSizeRatio(zoom.value, displayPixelRatio.value))
    : null
}

function currentDesktopSize(): RdpDesktopSize | null {
  // IronRDP's desktopSize() retains the connection's initial size. The
  // canvas attributes follow the framebuffer after Display Control resizes.
  const canvas = canvasEl.value
  return session && canvas && canvas.width > 0 && canvas.height > 0
    ? { width: canvas.width, height: canvas.height }
    : null
}

function clearResizeProbe() {
  if (resizeProbeTimer !== null) clearTimeout(resizeProbeTimer)
  resizeProbeTimer = null
}

function onPixelRatioChange() {
  displayPixelRatio.value = window.devicePixelRatio || 1
  pixelRatioQuery?.removeEventListener('change', onPixelRatioChange)
  pixelRatioQuery = window.matchMedia(`(resolution: ${displayPixelRatio.value}dppx)`)
  pixelRatioQuery.addEventListener('change', onPixelRatioChange)
  onContainerResize()
}

async function reconnectWithSize(width: number, height: number) {
  if (reconnecting) return
  reconnecting = true
  try {
    teardownClient()
    if (currentSessionId.value) {
      try { await CloseSession(currentSessionId.value) } catch (_) {}
      currentSessionId.value = null
    }
    const cfg = { ...(props.config || {}), rdpFixedWidth: width, rdpFixedHeight: height, rdpEnableNLA: activeCredSSP }
    const info = await CreateSession('rdp', cfg)
    currentSessionId.value = info.id
    panelStore.bindSession(props.panelId, info.id)
    if (info.proxyAddr) {
      panelStore.setProxyAddr(props.panelId, info.proxyAddr)
      await nextTick()
      await startClient(info.proxyAddr, { width, height })
    } else {
      throw new Error('missing proxy address')
    }
  } catch (e) {
    rdpLog(`adaptive reconnect failed: ${backendErrorText(e)}`)
    errorMessage.value = backendErrorText(e)
    status.value = 'error'
  } finally {
    reconnecting = false
    if (pendingNlaFallback) {
      pendingNlaFallback = false
      void reconnect()
    }
    // Catch viewport changes that happened while the handshake was running.
    onContainerResize()
  }
}

function requestAdaptiveResize() {
  if (!session || status.value !== 'connected' || reconnecting) return
  if (!isAdaptive()) return
  // Scrollbars in the unscaled view must not change the negotiated resolution.
  const targetSize = adaptiveDesktopSize()
  if (!targetSize) return
  const { width, height } = targetSize
  const cur = currentDesktopSize()
  if (cur?.width === width && cur.height === height) return
  // Do not reconnect repeatedly if a server clamps/refuses this resolution.
  if (lastResizeRequest?.width === width && lastResizeRequest.height === height) return
  lastResizeRequest = { width, height }
  clearResizeProbe()
  if (displayControlUsable === false) {
    reconnectWithSize(width, height)
    return
  }
  try {
    session.resize(width, height)
    const generation = clientGeneration
    resizeProbeTimer = setTimeout(() => {
      resizeProbeTimer = null
      if (generation !== clientGeneration || status.value !== 'connected' || reconnecting) return
      const target = adaptiveDesktopSize()
      if (!target) return
      if (target.width !== width || target.height !== height) {
        requestAdaptiveResize()
        return
      }
      const now = currentDesktopSize()
      if (now?.width === width && now.height === height) {
        displayControlUsable = true
      } else {
        displayControlUsable = false
        reconnectWithSize(width, height)
      }
    }, 2000)
  } catch (e) {
    rdpLog(`adaptive resize failed: ${String(e)}`)
    displayControlUsable = false
    reconnectWithSize(width, height)
  }
}

function onContainerResize() {
  const bounds = viewportEl.value?.getBoundingClientRect()
  if (bounds) viewportSize.value = { width: bounds.width, height: bounds.height }
  if (resizeDebounce !== null) clearTimeout(resizeDebounce)
  resizeDebounce = setTimeout(() => {
    resizeDebounce = null
    requestAdaptiveResize()
  }, 400)
}

// ── Lifecycle ──

let unsubStatus: (() => void) | null = null
let unsubData: (() => void) | null = null

onMounted(() => {
  if (props.sessionId) {
    currentSessionId.value = props.sessionId
  }
  if (currentSessionId.value) {
    status.value = 'connected'
  } else {
    status.value = 'connecting'
  }

  unsubStatus =Events.On('session:status', (ev) => { const data: any = ev.data; 
    if (data.id !== currentSessionId.value) return
    switch (data.status) {
      case 'connected':
        clearConnectTimer()
        status.value = 'connected'
        errorMessage.value = ''
        window.dispatchEvent(new CustomEvent('rdp:sync-position'))
        break
      case 'disconnected':
        clearConnectTimer()
        if (status.value !== 'error') status.value = 'disconnected'
        if (currentSessionId.value) RDPHide(currentSessionId.value)
        break
      case 'error':
        rdpLog(`session error: ${data.errorMessage || '(empty)'}`)
        if (retryWithoutNLA(backendErrorTextOf(data.errorMessage || ''))) break
        clearConnectTimer()
        status.value = 'error'
        errorMessage.value = backendErrorTextOf(data.errorMessage || '')
        if (currentSessionId.value) RDPHide(currentSessionId.value)
        break
    }
   })

  unsubData =Events.On('session:data', (ev) => { const data: any = ev.data; 
    if (data.id === currentSessionId.value && data.data?.includes('[Connection failed')) {
      status.value = 'error'
    }
   })

  // Tab right-click 「重连」(Reconnect) menu → forced reconnect of this panel.
  window.addEventListener('panel:reconnect', onReconnectEvent)
})

function onReconnectEvent(e: Event) {
  const panelId = (e as CustomEvent)?.detail?.panelId
  if (panelId && panelId === props.panelId) reconnect()
}

onUnmounted(() => {
  unsubStatus?.()
  unsubData?.()
  window.removeEventListener('panel:reconnect', onReconnectEvent)
  clearConnectTimer()
})

watch(() => props.sessionId, (newId) => {
  if (newId && !currentSessionId.value) {
    currentSessionId.value = newId
  }
})

watch(status, value => value === 'connected' ? onFocusIn() : onFocusOut(), { flush: 'post' })
watch(zoom, () => nextTick(() => {
  viewportEl.value?.scrollTo(0, 0)
  onContainerResize()
}))
// Pick up quality/resolution edits from the connection form; applies at the
// next (re)connect without yanking a live session. Read from the connection
// store, not props.config — the panel holds a snapshot taken at creation and
// never sees later edits.
const savedConnection = computed(() => {
  const id = props.config?.id
  return id ? connectionStore.connections.find(c => c.id === id) : undefined
})
watch(() => savedConnection.value?.rdpQuality, (q) => {
  const next = normalizeRdpQuality(q)
  if (next !== activeQuality.value) activeQuality.value = next
}, { immediate: true })
watch(() => [savedConnection.value?.rdpFixedWidth, savedConnection.value?.rdpFixedHeight], () => {
  const next = seedResolutionChoice(savedConnection.value)
  if (next !== activeResolution.value) activeResolution.value = next
}, { immediate: true })
// Fit/stretch zoom is only offered for fixed/fullscreen resolutions —
// adaptive resolution already fills the pane, so those entries coerce to 100%.
watch(activeResolution, (mode) => {
  if (mode === 'adaptive' && (zoom.value === 'adaptive' || zoom.value === 'stretch')) zoom.value = 1
})
</script>

<style scoped>
.rdp-tab-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-primary);
  position: relative;
}
.rdp-area {
  flex: 1;
}
.rdp-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--text-muted);
  z-index: 10;
}
.rdp-error-text { color: var(--error); }
.rdp-error-detail { color: var(--text-muted); font-size: 0.8125rem; max-width: 30rem; text-align: center; word-break: break-word; }
.rdp-statusbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 0.75rem;
  flex-shrink: 0;
}
.rdp-status-dot {
  width: 0.5rem; height: 0.5rem;
  border-radius: 50%;
  background: var(--success);
}
.rdp-status-sep { color: var(--text-disabled); }
.rdp-status-label { font-size: 0.6875rem; }
.rdp-quality-select {
  width: 8.5rem;
  --el-select-width: 8.5rem;
}
.rdp-statusbar .rdp-quality-select :deep(.el-select__wrapper) {
  min-height: 1.125rem;
  height: 1.125rem;
  padding: 0 0.25rem;
  font-size: 0.6875rem;
}
.rdp-status-spacer { flex: 1; }
.rdp-fullscreen-btn {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-muted);
  font-size: 0.75rem;
  padding: 1px 0.625rem;
  border-radius: var(--radius-sm);
}
.rdp-fullscreen-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
