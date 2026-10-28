/**
 * useAppWatchers — App.vue watch 逻辑 (App.vue 拆分)
 *
 * 从 App.vue 下沉 6 个 watch：
 *   1. activeTab 变化 → RDP tab 切换 + 终端自动聚焦
 *   2. showConnectionForm → RDP overlay 遮挡管理
 *   3. sidebarVisible → RDP tracking 重置 + 本地状态持久化
 *   4. aiStore.visible → RDP tracking 重置
 *   5. settings.keyboard → 重新加载快捷键
 *   6. localState 背景设置6设置 → 重新加载背景图
 *
 * App.vue 用法：
 *   useAppWatchers(deps)  // 在 setup 中直接调用，内部注册 watch
 */
import { watch, nextTick, type Ref, type ComputedRef } from 'vue'
import { useTabStore } from '../stores/tabStore'
import { useAIStore } from '../stores/aiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useLocalStateStore } from '../stores/localStateStore'
import { focusPanelTerminal } from './useFocusTerminal'

export interface AppWatchersDeps {
  activeTab: ComputedRef<any>
  showConnectionForm: Ref<boolean>
  sidebarVisible: Ref<boolean>
  rdpEmbedding: {
    onTabSwitch: (newTab: any, oldTab: any) => void
    RDPHideForOverlay: () => void
    RDPShowForOverlay: () => void
    rdpResetTracking: () => void
  }
  applyKeybindings: () => void
  loadBackgroundImage: () => Promise<void>
}

export function useAppWatchers(deps: AppWatchersDeps) {
  const tabStore = useTabStore()
  const aiStore = useAIStore()
  const settingsStore = useSettingsStore()
  const localStateStore = useLocalStateStore()

  const { activeTab, showConnectionForm, sidebarVisible, rdpEmbedding, applyKeybindings, loadBackgroundImage } = deps

  // Show/hide native RDP window on tab switch.
  // Position updates are only sent to the active RDP session (see rdpSyncPosition),
  // so background sessions are tucked under the webview and don't respond to drag.
  watch(() => activeTab.value, (newTab, oldTab) => {
    rdpEmbedding.onTabSwitch(newTab as any, oldTab as any)
    // Auto-focus terminal on tab switch (including new connections)
    if (newTab) {
      const pid = tabStore.getActivePanelId()
      if (pid) nextTick(() => focusPanelTerminal(pid))
    }
  })

  // Hide RDP when new-connection dialog opens (App.vue's ConnectionForm)
  watch(showConnectionForm, (val) => {
    if (val) rdpEmbedding.RDPHideForOverlay()
    else rdpEmbedding.RDPShowForOverlay()
  })

  watch(sidebarVisible, async () => {
    rdpEmbedding.rdpResetTracking()
    localStateStore.update({ sidebarVisible: sidebarVisible.value })
  })

  watch(() => aiStore.visible, () => {
    rdpEmbedding.rdpResetTracking()
  })

  watch(() => settingsStore.settings.keyboard, () => {
    applyKeybindings()
  }, { deep: true })

  watch(
    () => [localStateStore.state.backgroundEnabled, localStateStore.state.backgroundImage],
    () => loadBackgroundImage()
  )
}