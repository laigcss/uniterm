<template>
  <div class="vnc-tab-content">
    <!-- Connecting state -->
    <div v-if="status === 'connecting'" class="vnc-overlay">
      <el-icon class="is-loading" :size="32"><Loader /></el-icon>
      <p>{{ t('vnc.connecting', { host: config?.host || '...' }) }}</p>
    </div>

    <!-- Error state -->
    <div v-else-if="status === 'error'" class="vnc-overlay">
      <p class="vnc-error-text">{{ t('vnc.error') }}</p>
      <p v-if="lastError" class="vnc-error-detail">{{ lastError }}</p>
      <el-button type="primary" @click="reconnect">{{ t('vnc.retry') }}</el-button>
    </div>

    <!-- Disconnected state -->
    <div v-else-if="status === 'disconnected'" class="vnc-overlay">
      <p>{{ t('vnc.disconnected') }}</p>
      <el-button type="primary" @click="reconnect">{{ t('vnc.reconnect') }}</el-button>
    </div>

    <!-- Connected: noVNC Canvas mounts here -->
    <div
      v-show="status === 'connected'"
      ref="vncContainer"
      class="vnc-area"
      tabindex="0"
      @paste="onPaste"
    />

    <!-- Status bar -->
    <div v-show="status === 'connected'" class="vnc-statusbar">
      <span class="vnc-status-dot" />
      <span>{{ t('vnc.connected') }}</span>
      <span class="vnc-status-sep">|</span>
      <span>{{ config?.host }}:{{ config?.port || 5900 }}</span>
      <span class="vnc-status-sep">|</span>
      <span class="vnc-status-label">{{ t('vnc.scale') }}</span>
      <el-switch
        v-model="scaleViewport"
        inline-prompt
        :active-text="t('vnc.scaleOn')"
        :inactive-text="t('vnc.scaleOff')"
        style="--el-switch-on-color: var(--success); --el-switch-off-color: var(--text-disabled)"
      />
      <span class="vnc-status-sep">|</span>
      <span class="vnc-status-label">{{ t('vnc.viewOnly') }}</span>
      <el-switch
        v-model="viewOnly"
        inline-prompt
        :active-text="t('vnc.scaleOn')"
        :inactive-text="t('vnc.scaleOff')"
        style="--el-switch-on-color: var(--success); --el-switch-off-color: var(--text-disabled)"
      />
      <span class="vnc-status-sep">|</span>
      <span class="vnc-status-label">{{ t('vnc.showDotCursor') }}</span>
      <el-switch
        v-model="showDotCursor"
        inline-prompt
        :active-text="t('vnc.scaleOn')"
        :inactive-text="t('vnc.scaleOff')"
        style="--el-switch-on-color: var(--success); --el-switch-off-color: var(--text-disabled)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Loader } from '@lucide/vue'
import { useI18n } from '../i18n'
import { usePanelStore } from '../stores/panelStore'
import type { ConnectionConfig } from '../types/session'
import { CreateSession, CloseSession } from '../../wailsjs/go/main/App'
import { EventsOn, ClipboardSetText, ClipboardGetText } from '../../wailsjs/runtime'

const { t } = useI18n()
const panelStore = usePanelStore()

const props = defineProps<{
  panelId: string
  config: ConnectionConfig | null
  sessionId: string | null
}>()

const status = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting')
const lastError = ref<string>('')
const currentSessionId = ref<string | null>(props.sessionId)
const vncContainer = ref<HTMLDivElement | null>(null)
const savedPassword = ref<string>('')
const scaleViewport = ref(false)
const viewOnly = ref(false)
const showDotCursor = ref(false)

function readThemeBackground(): string {
  // Pull the resolved --bg-base CSS variable, which the global theme
  // system (settingsStore.applyTheme) updates on `data-theme` change.
  // Returning the computed value rather than a hardcoded color keeps
  // the VNC canvas background in sync with the app's light / dark /
  // deep-blue / custom themes.
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--bg-base')
    .trim() || '#000000'
}

let themeObserver: MutationObserver | null = null
function watchThemeBackground() {
  if (themeObserver) return
  themeObserver = new MutationObserver(() => {
    if (rfb) rfb.background = readThemeBackground()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

let rfb: any = null
let unsubStatus: (() => void) | null = null
let isIniting = false

async function connect() {
  if (!props.config) return
  if (status.value === 'connecting' || status.value === 'connected') return
  status.value = 'connecting'
  lastError.value = ''
  try {
    const info = await CreateSession('vnc', props.config)
    currentSessionId.value = info.id
  } catch (e: any) {
    console.error('VNC connect error:', e)
    lastError.value = e?.message || String(e)
    status.value = 'error'
  }
}

async function reconnect() {
  if (currentSessionId.value) {
    try { await CloseSession(currentSessionId.value) } catch (_) {}
    currentSessionId.value = null
  }
  if (rfb) {
    rfb.disconnect()
    rfb = null
  }
  await connect()
}

function initRFB(proxyAddr: string, password: string) {
  if (isIniting) return
  isIniting = true

  if (rfb) {
    try { rfb.disconnect() } catch (_) {}
    rfb = null
  }
  if (vncContainer.value) {
    vncContainer.value.innerHTML = ''
  }

  const RFB = (window as any).__novnc_RFB
  if (RFB) {
    createRFB(RFB, proxyAddr, password)
    return
  }

  import('@novnc/novnc').then((module: any) => {
    const LoadedRFB = module.default || module
    ;(window as any).__novnc_RFB = LoadedRFB
    createRFB(LoadedRFB, proxyAddr, password)
  }).catch((e: any) => {
    console.error('Failed to load noVNC module:', e)
    lastError.value = e?.message || String(e)
    status.value = 'error'
    isIniting = false
  })
}

function applyRFBOptions() {
  if (!rfb) return
  rfb.viewOnly = viewOnly.value
  rfb.scaleViewport = scaleViewport.value
  rfb.showDotCursor = showDotCursor.value
  rfb.background = readThemeBackground()
}

function createRFB(RFB: any, proxyAddr: string, password: string) {
  if (!vncContainer.value || vncContainer.value.childElementCount > 0) {
    isIniting = false
    return
  }

  try {
    rfb = new RFB(vncContainer.value, proxyAddr, {
      credentials: { password: password || '' },
      shared: props.config?.vncShared ?? true,
      repeaterID: props.config?.vncRepeaterID || '',
    })
  } catch (e: any) {
    console.error('Failed to create RFB instance:', e)
    lastError.value = e?.message || String(e)
    status.value = 'error'
    isIniting = false
    return
  }

  applyRFBOptions()

  // issue #95: only flip to 'connected' on the noVNC connect event.
  // Previously status='connected' was set as soon as the local proxy was
  // up, well before the RFB handshake completed, producing a black
  // screen with no error on security failure or wrong password.
  rfb.addEventListener('connect', () => {
    const scheme = rfb._rfbAuthScheme as number | undefined

    if (props.config?.vncEncryption === 'require' && scheme !== 19) {
      rfb.disconnect()
      lastError.value = t('vnc.errorRequireEncryption', { scheme: schemeName(scheme) })
      status.value = 'error'
      return
    }

    lastError.value = ''
    status.value = 'connected'
  })

  rfb.addEventListener('securityfailure', (e: any) => {
    const reason = e.detail?.reason ?? e.detail?.status
    lastError.value = t('vnc.errorSecurity', { reason: String(reason ?? '') })
    status.value = 'error'
  })

  rfb.addEventListener('credentialsrequired', (e: any) => {
    const types = (e.detail?.types || []).join(', ')
    lastError.value = t('vnc.errorCredentials', { types })
    status.value = 'error'
  })

  rfb.addEventListener('disconnect', (e: any) => {
    if (!e.detail.clean) {
      if (!lastError.value) lastError.value = t('vnc.errorClosed')
      status.value = 'error'
    } else {
      status.value = 'disconnected'
    }
  })

  rfb.addEventListener('clipboard', (e: any) => {
    const text = e.detail.text
    ClipboardSetText(text).catch(() => {})
  })

  isIniting = false
}

function schemeName(scheme: number | undefined): string {
  switch (scheme) {
    case 1: return 'None'
    case 2: return 'VNC-Auth'
    case 19: return 'TLS'
    default: return `unknown(${scheme})`
  }
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text')
  if (text && rfb) {
    rfb.clipboardPasteFrom(text)
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (!rfb || status.value !== 'connected') return
  if (e.ctrlKey && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault()
    ClipboardGetText().then(text => {
      if (text && rfb) {
        rfb.clipboardPasteFrom(text)
      }
    }).catch(() => {})
  }
}

onMounted(() => {
  if (props.sessionId) {
    currentSessionId.value = props.sessionId
  }

  const cached = panelStore.getVNCCache(props.panelId)
  if (cached && vncContainer.value) {
    const children = Array.from(cached.container.children)
    children.forEach(child => vncContainer.value!.appendChild(child))
    rfb = cached.rfb
    panelStore.removeVNCCache(props.panelId)
    status.value = 'connected'
    applyRFBOptions()
    document.addEventListener('keydown', handleKeyDown)
    watchThemeBackground()
    return
  }

  const storedProxy = panelStore.getProxyAddr(props.panelId)
  if (storedProxy && props.config) {
    savedPassword.value = props.config.password || ''
    initRFB(storedProxy, savedPassword.value)
  } else if (currentSessionId.value) {
    connect()
  } else {
    connect()
  }

  document.addEventListener('keydown', handleKeyDown)

  watchThemeBackground()

  unsubStatus = EventsOn('session:status', (data: any) => {
    if (data.id !== currentSessionId.value) return
    switch (data.status) {
      case 'connected':
        // issue #95: do NOT flip to 'connected' here. The RFB 'connect'
        // event is the source of truth — see createRFB above. We only
        // hand the proxyAddr off to noVNC.
        if (data.proxyAddr) {
          panelStore.setProxyAddr(props.panelId, data.proxyAddr)
        }
        if (props.config) {
          savedPassword.value = props.config.password || ''
        }
        if (data.proxyAddr && props.config) {
          initRFB(data.proxyAddr, props.config.password || '')
        } else {
          const proxy = panelStore.getProxyAddr(props.panelId)
          if (proxy) {
            initRFB(proxy, savedPassword.value)
          }
        }
        break
      case 'disconnected':
        if (status.value !== 'error') status.value = 'disconnected'
        break
      case 'error':
        if (!lastError.value) lastError.value = t('vnc.errorClosed')
        status.value = 'error'
        break
    }
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown)
  themeObserver?.disconnect()
  themeObserver = null
  unsubStatus?.()

  if (rfb && vncContainer.value && vncContainer.value.childElementCount > 0) {
    const container = document.createElement('div')
    container.style.display = 'none'
    const children = Array.from(vncContainer.value.children)
    children.forEach(child => container.appendChild(child))
    document.body.appendChild(container)
    panelStore.setVNCCache(props.panelId, { rfb, container })
  } else if (rfb) {
    rfb.disconnect()
    rfb = null
  }
})

watch(() => props.sessionId, (newId) => {
  if (newId && !currentSessionId.value) {
    currentSessionId.value = newId
  }
})

watch(scaleViewport, (val) => {
  if (rfb) rfb.scaleViewport = val
})
watch(viewOnly, (val) => {
  if (rfb) rfb.viewOnly = val
})
watch(showDotCursor, (val) => {
  if (rfb) rfb.showDotCursor = val
})
</script>

<style scoped>
.vnc-tab-content {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
}
.vnc-area {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 24px;
  background: #000;
  outline: none;
  overflow: auto;
}
.vnc-area :deep(canvas) {
  display: block;
  image-rendering: pixelated;
  flex-shrink: 0;
}
.vnc-overlay {
  position: absolute;
  inset: 0;
  bottom: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
  z-index: 10;
}
.vnc-error-text { color: var(--error); }
.vnc-error-detail {
  color: var(--text-muted);
  font-size: 12px;
  max-width: 80%;
  text-align: center;
  word-break: break-word;
}
.vnc-statusbar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 12px;
  box-sizing: border-box;
  z-index: 5;
}
.vnc-status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
}
.vnc-status-sep { color: var(--text-disabled); }
.vnc-status-label { font-size: 11px; }
</style>
