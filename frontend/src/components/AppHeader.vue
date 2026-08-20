<template>
  <div
    class="app-header"
    :class="`platform-${platform}`"
    @dblclick="onDblClick"
  >
    <!-- macOS: spacer for native traffic lights -->
    <div v-if="platform === 'darwin' && !localStateStore.state.systemTitleBar" class="mac-traffic-light-spacer" />

    <!-- Connections button (icon only, leftmost) -->
    <button class="header-btn" @click="emit('toggle-sidebar')" :title="t('header.connections') + shortcutSuffix('toggleSidebar')">
      <el-icon><PanelLeft :size="14" /></el-icon>
    </button>


    <!-- Tabs list -->
    <div class="header-tabs">
      <TabsList
        @close-tab="(id: string) => emit('close-tab', id)"
        @close-tab-batch="(ids: string[]) => emit('close-tab-batch', ids)"
        @toggle-ai-lock="(panelId: string) => emit('toggle-ai-lock', panelId)"
        @tab-dragstart="(e: DragEvent, tabId: string) => emit('tab-dragstart', e, tabId)"
      />
    </div>

    <!-- AI button -->
    <button class="header-btn" @click="emit('toggle-ai')" :title="t('header.ai') + shortcutSuffix('focusAI')">
      <el-icon><Bot :size="14" /></el-icon>
    </button>

    <!-- Settings button opens a dropdown menu with common settings items -->
    <div class="settings-wrap">
      <button ref="settingsBtnRef" class="header-btn" @click.stop="toggleSettingsMenu" :title="t('header.settings') + shortcutSuffix('openSettings')">
        <el-icon><Settings :size="14" /></el-icon>
      </button>

      <!-- Settings dropdown (theme / language / ai / identities / proxies / settings / check update) -->
      <Teleport to="body">
        <div
          v-show="showSettingsMenu"
          class="header-settings-menu"
          :style="settingsMenuStyle"
          @mouseleave="activeSub = ''"
        >
          <!-- 主题 -->
          <div class="settings-menu-item submenu-wrap" @mouseenter="activeSub = 'theme'">
            <span class="settings-menu-label">{{ t('settings.theme') }}</span>
            <el-icon class="sub-arrow"><ChevronRight :size="13" /></el-icon>
            <div v-show="activeSub === 'theme'" class="settings-submenu" @mouseleave="activeSub = ''">
              <div
                v-for="opt in themeOptions"
                :key="opt.value"
                class="settings-submenu-item"
                :class="{ 'is-active': settingsStore.settings.theme === opt.value }"
                @click="applyTheme(opt.value)"
              >{{ opt.label }}</div>
            </div>
          </div>

          <!-- 语言 -->
          <div class="settings-menu-item submenu-wrap" @mouseenter="activeSub = 'language'">
            <span class="settings-menu-label">{{ t('settings.language') }}</span>
            <el-icon class="sub-arrow"><ChevronRight :size="13" /></el-icon>
            <div v-show="activeSub === 'language'" class="settings-submenu" @mouseleave="activeSub = ''">
              <div
                v-for="lang in LANGUAGE_OPTIONS"
                :key="lang.value"
                class="settings-submenu-item"
                :class="{ 'is-active': settingsStore.settings.language === lang.value }"
                @click="applyLanguage(lang.value)"
              >{{ lang.native }}</div>
              <div
                class="settings-submenu-item"
                :class="{ 'is-active': settingsStore.settings.language === 'system' }"
                @click="applyLanguage('system')"
              >{{ t('settings.langSystem') }}</div>
            </div>
          </div>

          <div class="settings-menu-sep"></div>

          <!-- AI模型 / 密钥库 / 代理 -->
          <div class="settings-menu-item" @click="openCategory('ai')">
            <span class="settings-menu-label">{{ t('settings.ai') }}</span>
          </div>
          <div class="settings-menu-item" @click="openCategory('identities')">
            <span class="settings-menu-label">{{ t('settings.identities') }}</span>
          </div>
          <div class="settings-menu-item" @click="openCategory('proxies')">
            <span class="settings-menu-label">{{ t('settings.proxies') }}</span>
          </div>

          <div class="settings-menu-sep"></div>

          <!-- 设置 / 关于 / 检查更新 -->
          <div class="settings-menu-item" @click="openCategory('basic')">
            <span class="settings-menu-label">{{ t('settings.title') }}</span>
          </div>
          <div class="settings-menu-item" @click="openCategory('about')">
            <span class="settings-menu-label">{{ t('settings.about') }}</span>
          </div>
          <div class="settings-menu-item" @click="checkUpdate">
            <span class="settings-menu-label">{{ t('settings.checkUpdate') }}</span>
          </div>
        </div>
      </Teleport>
    </div>

    <!-- Windows/Linux: window controls right (hidden when using system title bar) -->
    <WindowControls
      v-if="showWindowControls"
      :is-maximised="isMaximised"
      @minimise="onMinimise"
      @maximise="onMaximise"
      @close="onClose"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, h } from 'vue'
import { Settings, PanelLeft, Bot, ChevronRight } from '@lucide/vue'
import { ElMessageBox, ElCheckbox } from 'element-plus'
import { useI18n } from '../i18n'
import { useTabStore } from '../stores/tabStore'
import { usePanelStore } from '../stores/panelStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { formatKeyBinding } from '../composables/useKeyboardShortcuts'
import { useLocalStateStore } from '../stores/localStateStore'
import { useUpdateCheck } from '../composables/useUpdateCheck'
import { LANGUAGE_OPTIONS } from '../types/settings'
import type { AppSettings } from '../types/settings'
import WindowControls from './WindowControls.vue'
import TabsList from './TabsList.vue'
import {
  Environment,
  WindowMinimise,
  WindowToggleMaximise,
  WindowMaximise,
  WindowUnmaximise,
  WindowIsMaximised,
  WindowIsMinimised,
  WindowSetMaxSize,
  WindowGetPosition,
  WindowGetSize,
  Quit,
  ScreenGetAll,
} from '../../wailsjs/runtime'
import { SaveWindowState } from '../../wailsjs/go/main/App'

const { t } = useI18n()
const tabStore = useTabStore()
const panelStore = usePanelStore()
const sessionStore = useSessionStore()
const settingsStore = useSettingsStore()
const localStateStore = useLocalStateStore()

// ── Settings dropdown menu ──
const updateCheck = useUpdateCheck()
const showSettingsMenu = ref(false)
const activeSub = ref<'theme' | 'language' | ''>('')
const settingsBtnRef = ref<HTMLElement | null>(null)
const settingsMenuStyle = ref({ top: '-9999px', left: '-9999px' })

const themeOptions = computed(() => [
  { value: 'dark' as const, label: t('settings.themeDark') },
  { value: 'deep-blue' as const, label: t('settings.themeDeepBlue') },
  { value: 'light' as const, label: t('settings.themeLight') },
  { value: 'system' as const, label: t('settings.themeSystem') },
])

function positionSettingsMenu() {
  const el = settingsBtnRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  settingsMenuStyle.value = { top: `${r.bottom + 4}px`, left: `${r.right}px` }
}

function toggleSettingsMenu() {
  showSettingsMenu.value = !showSettingsMenu.value
  if (showSettingsMenu.value) positionSettingsMenu()
}

function closeSettingsMenu() {
  showSettingsMenu.value = false
  activeSub.value = ''
}

function applyTheme(value: AppSettings['theme']) {
  settingsStore.updateTheme(value)
  closeSettingsMenu()
}

function applyLanguage(value: AppSettings['language']) {
  settingsStore.updateLanguage(value)
  closeSettingsMenu()
}

function openCategory(category?: string) {
  emit('open-settings', category)
  closeSettingsMenu()
}

function onSettingsMenuDocClick() {
  showSettingsMenu.value = false
}

function checkUpdate() {
  updateCheck.checkForUpdate(true)
  closeSettingsMenu()
}

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)

// " (Ctrl+Shift+K)" suffix for a shortcut action's tooltip, '' when unset.
// Reactive via settingsStore, so tooltips update when the user rebinds keys.
function shortcutSuffix(action: 'focusAI' | 'toggleSidebar' | 'openSettings'): string {
  const b = settingsStore.settings.keyboard[action]
  if (!b) return ''
  const key = formatKeyBinding(b, isMac)
  return key ? ` (${key})` : ''
}

const hasActiveConnections = computed(() =>
  tabStore.tabs.some(t => {
    if (t.type === 'start' || t.type === 'settings') return false
    const panelIds = t.type === 'workspace' ? t.panelIds : 'panelId' in t ? [t.panelId] : []
    return panelIds.some(pid => {
      const p = panelStore.getPanel(pid)
      if (!p?.sessionId) return false
      return sessionStore.getStatus(p.sessionId) === 'connected'
    })
  })
)

const emit = defineEmits<{
  'toggle-ai': []
  'toggle-sidebar': []
  'open-settings': [category?: string]
  'close-tab': [id: string]
  'close-tab-batch': [ids: string[]]
  'toggle-ai-lock': [panelId: string]
  'tab-dragstart': [e: DragEvent, tabId: string]
}>()

const platform = ref<'windows' | 'darwin' | 'linux'>('windows')
const isMaximised = ref(false)

// On Windows/Linux the app draws its own window controls — but not when the
// user opted into the OS native title bar, which already provides them.
const showWindowControls = computed(
  () => platform.value !== 'darwin' && !localStateStore.state.systemTitleBar
)

async function updateMaximisedState() {
  try {
    isMaximised.value = await WindowIsMaximised()
  } catch {
    // ignore
  }
}

function onMinimise() {
  WindowMinimise()
}

async function onMaximise() {
  if (platform.value === 'linux') {
    await linuxMaximise()
  } else {
    WindowToggleMaximise()
  }
  setTimeout(() => {
    updateMaximisedState()
    saveWindowState()
  }, 100)
}

async function linuxMaximise() {
  const maximised = await WindowIsMaximised()
  if (maximised) {
    // Restore: use native unmaximise, then clear max size constraint
    WindowUnmaximise()
    WindowSetMaxSize(0, 0)
  } else {
    // Before native maximise, set max size to current screen dimensions
    // to prevent GTK from clamping to the wrong monitor's size.
    try {
      const screens = await ScreenGetAll()
      const current = screens.find((s: { isCurrent: boolean }) => s.isCurrent) || screens[0]
      if (current) {
        WindowSetMaxSize(current.width, current.height)
      }
    } catch {
      // Fallback: set large max size to disable any constraint
      WindowSetMaxSize(9999, 9999)
    }
    WindowMaximise()
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

async function saveWindowState() {
  try {
    // Do not save geometry when minimised — the position is off-screen
    // and the size is the tiny taskbar thumbnail.
    if (await WindowIsMinimised()) return
    const maxed = await WindowIsMaximised()
    const { x, y } = await WindowGetPosition()
    const { w, h } = await WindowGetSize()
    SaveWindowState(x, y, w, h, maxed)
  } catch {
    // ignore
  }
}

async function onClose() {
  if (hasActiveConnections.value) {
    if (!settingsStore.settings.closeAppPrompt) {
      // skip dialog, proceed to quit
    } else {
      const dontShowAgain = ref(false)
      // Hide the native RDP window so the dialog isn't covered by it (issue #346)
      window.dispatchEvent(new CustomEvent('rdp:overlay-push'))
      try {
        await ElMessageBox.confirm(
          h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, [
            h('span', t('app.closeConfirm')),
            h(ElCheckbox, {
              'onUpdate:modelValue': (v: boolean) => { dontShowAgain.value = v }
            }, () => t('app.dontShowAgain'))
          ]),
          t('app.closeTitle'),
          { confirmButtonText: t('tab.close'), cancelButtonText: t('conn.cancel'), type: 'warning' }
        )
      } catch {
        return // user cancelled
      } finally {
        window.dispatchEvent(new CustomEvent('rdp:overlay-pop'))
      }
      if (dontShowAgain.value) {
        settingsStore.settings.closeAppPrompt = false
        settingsStore.save()
      }
    }
  }
  await saveWindowState()
  Quit()
}

function onDblClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('button, input, textarea, select, a, [role="button"], .tab-item, .tab-more, .window-controls')) return
  onMaximise()
}

function onWindowResize() {
  updateMaximisedState()
  // Debounce save to avoid frequent writes during drag-resize
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveWindowState, 500)
}

onMounted(async () => {
  try {
    const env = await Environment()
    const p = env.platform.toLowerCase()
    if (p === 'darwin') platform.value = 'darwin'
    else if (p === 'linux') platform.value = 'linux'
    else platform.value = 'windows'
  } catch {
    platform.value = 'windows'
  }
  updateMaximisedState()
  window.addEventListener('resize', onWindowResize)
  document.addEventListener('click', onSettingsMenuDocClick)
})

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('click', onSettingsMenuDocClick)
})
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  height: 44px;
  padding: 0 8px;
  gap: 2px;
  background: var(--bg-elevated);
  flex-shrink: 0;
  position: relative;
  z-index: 10;
  --wails-draggable: drag;
}

.app-header.platform-darwin {
  height: 52px;
  padding: 0 10px;
  gap: 8px;
}

.app-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--accent-subtle) 20%,
    var(--accent-glow) 50%,
    var(--accent-subtle) 80%,
    transparent 100%
  );
}

.header-tabs {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  justify-content: flex-start;
  align-items: center;
}

.header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 5px 8px;
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
  --wails-draggable: no-drag;
}

.header-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.header-btn .el-icon {
  font-size: 14px;
}

[data-theme="light"] .app-header::after {
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--accent-subtle) 20%,
    var(--accent-glow) 50%,
    var(--accent-subtle) 80%,
    transparent 100%
  );
}

.mac-traffic-light-spacer {
  width: 72px;
  height: 1px;
  flex-shrink: 0;
}

.app-header :deep(.window-controls) {
  --wails-draggable: no-drag;
}

.app-header.platform-darwin :deep(.window-controls) {
  align-self: center;
}

/* ── Settings dropdown menu ── */
.settings-wrap {
  position: relative;
  flex-shrink: 0;
  --wails-draggable: no-drag;
}

.header-settings-menu {
  position: fixed;
  z-index: 3000;
  min-width: 160px;
  padding: 5px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  transform: translateX(-100%);
}

.settings-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  font-size: 12px;
  font-family: var(--font-ui);
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  border-radius: var(--radius-sm);
  position: relative;
  white-space: nowrap;
}

.settings-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-menu-label {
  color: inherit;
}

.sub-arrow {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-left: 10px;
}

.settings-submenu {
  position: absolute;
  right: calc(100% + 4px);
  top: -5px;
  min-width: 140px;
  padding: 5px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 3001;
}

.settings-submenu-item {
  padding: 7px 10px;
  font-size: 12px;
  font-family: var(--font-ui);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.settings-submenu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-submenu-item.is-active {
  color: var(--accent);
  font-weight: 500;
}

.settings-menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border-subtle);
}

</style>
