/**
 * useAppDialogs — 设置/对话框/分组管理函数 (App.vue 拆分)
 *
 * 从 App.vue 下沉：
 *   - openSettings / openNetscan / openLocalServices
 *   - onChangeGroupFromStart / onChangeGroupFromStartIds / onChangeGroupParentFromStart
 *   - onToggleAiLock
 *   - netscanVisible / localServicesVisible（响应式状态，模板绑定）
 *
 * App.vue 用法：
 *   const dialogs = useAppDialogs({ sidebarRef })
 *   // 模板绑定 dialogs.netscanVisible / dialogs.localServicesVisible
 *   // 事件绑定 dialogs.openSettings / dialogs.openNetscan / ...
 */
import { ref, type Ref } from 'vue'
import { useTabStore } from '../stores/tabStore'
import { usePanelStore } from '../stores/panelStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useI18n } from '../i18n'

export interface AppDialogsDeps {
  sidebarRef: Ref<any>
}

export function useAppDialogs(deps: AppDialogsDeps) {
  const tabStore = useTabStore()
  const panelStore = usePanelStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()
  const { sidebarRef } = deps

  const netscanVisible = ref(false)
  const localServicesVisible = ref(false)

  function openSettings(category?: string) {
    // Check if settings tab already exists
    const existingTab = tabStore.tabs.find(t => t.type === 'settings')
    if (existingTab) {
      tabStore.setActiveTab(existingTab.id)
    } else {
      const panel = panelStore.createPanel(null, 'settings')
      panelStore.updateTitle(panel.id, t('settings.title'))
      const tab = tabStore.createTab('settings', t('settings.title'), panel.id)
      panelStore.movePanelToTab(panel.id, tab.id)
    }
    // Jump to the requested category (e.g. ai / identities / proxies)
    if (category) {
      settingsStore.activeCategory = category
    }
  }

  function openNetscan() {
    netscanVisible.value = true
  }

  function openLocalServices() {
    localServicesVisible.value = true
  }

  function onChangeGroupFromStart(config: { id: string }) {
    sidebarRef.value?.openChangeGroupFor([config.id])
  }

  function onChangeGroupFromStartIds(ids: string[]) {
    sidebarRef.value?.openChangeGroupFor(ids)
  }

  function onChangeGroupParentFromStart(groupId: string) {
    sidebarRef.value?.openChangeGroupForGroup(groupId)
  }

  function onToggleAiLock(panelId: string) {
    if (tabStore.isPanelAILocked(panelId)) {
      tabStore.removeAILockedPanel(panelId)
    } else {
      tabStore.addAILockedPanel(panelId)
    }
  }

  return {
    netscanVisible,
    localServicesVisible,
    openSettings,
    openNetscan,
    openLocalServices,
    onChangeGroupFromStart,
    onChangeGroupFromStartIds,
    onChangeGroupParentFromStart,
    onToggleAiLock,
  }
}