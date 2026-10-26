<template>
  <div class="vnc-tab-content">
    <!-- Connecting state -->
    <div v-if="status === 'connecting'" class="vnc-overlay">
      <el-icon class="is-loading" :size="'2rem'"><Loader /></el-icon>
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
import { useSessionStore } from '../stores/sessionStore'
import type { ConnectionConfig } from '../types/session'
import { Clipboard, Events } from '@wailsio/runtime'
import { CreateSession, CloseSession } from '../../bindings/github.com/ys-ll/uniterm/app'
const { t } = useI18n()
const panelStore = usePanelStore()
const sessionStore = useSessionStore()

const props = defineProps<{
  panelId: string
  config: ConnectionConfig | null
  sessionId: string | null
}>()

const status = ref<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected')
const lastError = ref<string>('')
const currentSessionId = ref<string | null>(props.sessionId)
const vncContainer = ref<HTMLDivElement | null>(null)
const savedPassword = ref<string>('')
const scaleViewport = ref(true)
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
// RFB version-negotiation retry state: currentProxyAddr powers the 3.3
// downgrade rebuild; everConnected/rfb33Retried guard the one-shot retry.
let currentProxyAddr = ''
let everConnected = false
let rfb33Retried = false

// Clipboard sync: intercept Cmd+V / Ctrl+V to sync local clipboard → VNC
// server before the keypress reaches the remote. noVNC's canvas captures
// the keydown and sends Ctrl+V directly, but doesn't sync the local
// clipboard first — so the remote pastes stale content.
let clipboardKeydownHandler: ((e: KeyboardEvent) => void) | null = null

async function connect() {
  if (!props.config) return
  if (status.value === 'connecting' || status.value === 'connected') return
  status.value = 'connecting'
  lastError.value = ''
  try {
    const info = await CreateSession('vnc', props.config)
    currentSessionId.value = info.id
    // Bind the session to the panel so tab-close cleanup and later
    // session:status events resolve to this id. The proxy address comes
    // straight from the CreateSession result: the synchronous VNC connect
    // makes it available here, independent of the racy session:status
    // 'connected' event that used to be dropped before the session id was
    // set, leaving VNC stuck on "connecting".
    panelStore.bindSession(props.panelId, info.id)
    sessionStore.initSession(info.id)
    if (info.proxyAddr) {
      panelStore.setProxyAddr(props.panelId, info.proxyAddr)
      savedPassword.value = props.config.password || ''

      initRFB(info.proxyAddr, savedPassword.value)
    }
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

function initRFB(proxyAddr: string, password: string, forceRfb33 = false) {
  if (isIniting) return
  isIniting = true

  // Fresh attempt (not the 3.3 downgrade retry): reset negotiation state
  // and remember the proxy address the downgrade retry would reuse.
  if (!forceRfb33) {
    currentProxyAddr = proxyAddr
    everConnected = false
    rfb33Retried = false
  }

  if (rfb) {
    try { rfb.disconnect() } catch (_) {}
    rfb = null
  }
  if (clipboardKeydownHandler && vncContainer.value) {
    vncContainer.value.removeEventListener('keydown', clipboardKeydownHandler, true)
    clipboardKeydownHandler = null
  }
  if (vncContainer.value) {
    vncContainer.value.innerHTML = ''
  }

  const RFB = (window as any).__novnc_RFB
  if (RFB) {
    createRFB(RFB, proxyAddr, password, forceRfb33)
    return
  }

  import('@novnc/novnc').then((module: any) => {
    const LoadedRFB = module.default || module
    ;(window as any).__novnc_RFB = LoadedRFB
    createRFB(LoadedRFB, proxyAddr, password, forceRfb33)
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

function createRFB(RFB: any, proxyAddr: string, password: string, forceRfb33 = false) {
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

  // Smart RFB version negotiation (replaces the old blanket
  // `_rfbMaxVersion = 3.3` hammer):
  //
  // - Default (modern servers): normal 3.8 list negotiation. noVNC picks
  //   from the server's offered security types (VncAuth / None / MS-Logon
  //   II all reachable). Two types are skipped in the preference order:
  //   RA2ne (6) — RealVNC advertises [6,130,2,...] and noVNC's RA2ne
  //   implementation dies with an unexplained 1006 against RealVNC
  //   servers; and VeNCrypt (19) — noVNC only implements the Plain
  //   sub-type while TigerVNC-style servers offer TLS sub-types, so
  //   picking 19 fails the handshake instead of falling through to the
  //   VNC Auth (2) they also offer.
  // - Legacy fallback (forceRfb33, auto-retried once): cap to RFB 3.3 so
  //   legacy servers (UltraVNC 003.003/003.006 banners) that reject 3.8
  //   viewers or single-handedly dictate a security type still connect.
  //   This preserves the original RealVNC workaround as a fallback instead
  //   of penalising every server.
  if (forceRfb33) {
    rfb._rfbMaxVersion = 3.3
  } else {
    const origIsSupported = rfb._isSupportedSecurityType?.bind(rfb)
    if (typeof origIsSupported === 'function') {
      rfb._isSupportedSecurityType = (type: number) =>
        type !== 6 && type !== 19 && origIsSupported(type)
    }
  }

  applyRFBOptions()

  // issue #95: only flip to 'connected' on the noVNC connect event.
  // Previously status='connected' was set as soon as the local proxy was
  // up, well before the RFB handshake completed, producing a black
  // screen with no error on security failure or wrong password.
  rfb.addEventListener('connect', () => {
    lastError.value = ''
    status.value = 'connected'
    everConnected = true
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

  // Auto-downgrade retry: if the 3.8 negotiation dies without ever
  // reaching 'connected' (typical symptom: unexplained 1006 close or a
  // legacy server that refuses modern viewers), rebuild once under
  // RFB 3.3 before surfacing the error to the user.
  rfb.addEventListener('disconnect', (e: any) => {
    if (!e.detail.clean && !everConnected && !rfb33Retried && currentProxyAddr) {
      rfb33Retried = true
      status.value = 'connecting'
      // Give the backend VNCProxy a beat to release the previous
      // WebSocket/TCP pair before reconnecting through it.
      setTimeout(() => {
        initRFB(currentProxyAddr!, savedPassword.value, true)
      }, 500)
      return
    }
    if (!e.detail.clean) {
      if (!lastError.value) lastError.value = t('vnc.errorClosed')
      status.value = 'error'
    } else {
      status.value = 'disconnected'
    }
  })

  rfb.addEventListener('clipboard', (e: any) => {
    const text = e.detail.text
    Clipboard.SetText(text).catch(() => {})
  })

  // Clipboard sync: intercept paste shortcut in capture phase (before noVNC's
  // canvas processes it). Read local clipboard, send via RFB clipboard message
  // to set the remote clipboard, then manually send Ctrl+V keypress to trigger
  // paste on the remote side.
  if (vncContainer.value) {
    clipboardKeydownHandler = (e: KeyboardEvent) => {
      // Mac: Cmd+V (metaKey), Windows/Linux: Ctrl+V (ctrlKey)
      if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !e.shiftKey && !e.altKey && rfb) {
        e.preventDefault()
        e.stopPropagation()
        Clipboard.Text().then((text: string) => {
          if (text) rfb.clipboardPasteFrom(text)
          // XK_Control_L = 0xffe3, XK_v = 0x0076
          rfb.sendKey(0xffe3, 'ControlLeft', true)
          rfb.sendKey(0x0076, 'KeyV', true)
          rfb.sendKey(0x0076, 'KeyV', false)
          rfb.sendKey(0xffe3, 'ControlLeft', false)
        }).catch(() => {
          // Clipboard read failed — still send Ctrl+V
          rfb.sendKey(0xffe3, 'ControlLeft', true)
          rfb.sendKey(0x0076, 'KeyV', true)
          rfb.sendKey(0x0076, 'KeyV', false)
          rfb.sendKey(0xffe3, 'ControlLeft', false)
        })
      }
    }
    vncContainer.value.addEventListener('keydown', clipboardKeydownHandler, true)
  }

  isIniting = false
}

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text')
  if (text && rfb) {
    rfb.clipboardPasteFrom(text)
  }
}

function onReconnectEvent(e: Event) {
  const panelId = (e as CustomEvent)?.detail?.panelId
  if (panelId && panelId === props.panelId) reconnect()
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
    // Cached RFB instances already completed their handshake; mark them so
    // a later disconnect doesn't fire the 3.3 downgrade retry against a
    // stale proxy address.
    everConnected = true
    applyRFBOptions()
    watchThemeBackground()
    return
  }

  // Register event listener BEFORE connect() — with synchronous VNC/SPICE
  // connect the session:status event is emitted during CreateSession and
  // would arrive before the listener if we registered it after.
  unsubStatus = Events.On('session:status', (ev) => { const data: any = ev.data; 
    if (data.id !== currentSessionId.value) return
    switch (data.status) {
      case 'connected':
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

  const storedProxy = panelStore.getProxyAddr(props.panelId)
  if (storedProxy && props.config) {
    savedPassword.value = props.config.password || ''
    initRFB(storedProxy, savedPassword.value)
  } else {
    connect()
  }

  watchThemeBackground()

  // Tab right-click 「重连」(Reconnect) menu → forced reconnect of this panel.
  window.addEventListener('panel:reconnect', onReconnectEvent)
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  unsubStatus?.()
  window.removeEventListener('panel:reconnect', onReconnectEvent)

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
  bottom: 1.5rem;
  background: #000;
  outline: none;
  overflow: auto;
}
.vnc-area :deep(canvas) {
  display: block;
  flex-shrink: 0;
}
.vnc-overlay {
  position: absolute;
  inset: 0;
  bottom: 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--text-muted);
  z-index: 10;
}
.vnc-error-text { color: var(--error); }
.vnc-error-detail {
  color: var(--text-muted);
  font-size: 0.75rem;
  max-width: 80%;
  text-align: center;
  word-break: break-word;
}
.vnc-statusbar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.75rem;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 0.75rem;
  box-sizing: border-box;
  z-index: 5;
}
.vnc-status-dot {
  width: 0.5rem; height: 0.5rem;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
}
.vnc-status-sep { color: var(--text-disabled); }
.vnc-status-label { font-size: 0.6875rem; }
</style>
