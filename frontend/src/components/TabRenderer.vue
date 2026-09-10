<!--
  TabRenderer.vue (A1 重构)
  接管 App.vue 中 16 个 v-else-if 的 Tab 内容分发，改为注册表驱动：
    <component :is="def.component" v-bind="props" v-on="listeners" />

  App.vue 只需：
    <KeepAlive>
      <TabRenderer :tab="activeTab" @close="..." @connect="..." ... />
    </KeepAlive>

  各 Tab 的 props 形态不同，由 tabProps computed 按 type 分支计算。
  start tab 的 6 个 emit 透传给父组件。
-->
<template>
  <KeepAlive>
    <component
      :is="tabComponent"
      :key="tab.id"
      v-bind="tabProps"
      v-on="tabListeners"
    />
  </KeepAlive>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePanelStore } from '../stores/panelStore'
import { useConnectionStore } from '../stores/connectionStore'
import { getTabDefinition, type TabType } from '../services/tabRegistry'
import type { ConnectionConfig } from '../types/session'
import type { Tab } from '../types/workspace'

const props = defineProps<{
  tab: Tab
}>()

// start tab 的事件透传给 App.vue
const emit = defineEmits<{
  (e: 'close', tabId: string): void
  (e: 'connect', config: ConnectionConfig): void
  (e: 'new-connection', payload?: { host?: string; groupId?: string; type?: string }): void
  (e: 'local-terminal', shellPath: string): void
  (e: 'close-self', tabId: string): void
  (e: 'edit-connection', config: ConnectionConfig): void
  (e: 'change-group', config: ConnectionConfig): void
  (e: 'change-group-ids', ids: string[]): void
  (e: 'change-group-parent', groupId: string): void
}>()

const panelStore = usePanelStore()
const connectionStore = useConnectionStore()

const tabType = computed(() => props.tab.type as TabType)
const tabDef = computed(() => getTabDefinition(tabType.value))
const tabComponent = computed(() => tabDef.value?.component)

function getPanelConfig(panelId: string): ConnectionConfig | null {
  return panelStore.getPanel(panelId)?.config || null
}

function getPanelSessionId(panelId: string): string | null {
  return panelStore.getPanel(panelId)?.sessionId || null
}

function k8sConnectionForTab(tab: any): ConnectionConfig {
  const conn = connectionStore.connections.find((c: ConnectionConfig) => c.id === tab.connectionId)
  return conn || ({
    id: tab.connectionId,
    name: tab.name,
    type: 'k8s',
    host: '',
    port: 0,
    user: '',
    authType: 'password',
    k8sConfigPath: '',
    k8sConfigInline: '',
    k8sContext: '',
    k8sNamespace: '',
  } as ConnectionConfig)
}

/** 按 tab.type 计算传给内容组件的 props */
const tabProps = computed<Record<string, any>>(() => {
  const tab = props.tab
  switch (tab.type) {
    case 'terminal':
    case 'workspace':
    case 'container':
      return { tab }
    case 'settings':
      return {}
    case 'sftp':
      return { panelId: tab.panelId }
    case 'rdp':
    case 'vnc':
    case 'spice':
    case 'x11-desktop':
      return {
        panelId: tab.panelId,
        config: getPanelConfig(tab.panelId),
        sessionId: getPanelSessionId(tab.panelId) ?? '',
      }
    case 'database':
      return {
        sessionId: getPanelSessionId(tab.panelId) ?? '',
        hostName: getPanelConfig(tab.panelId)?.host || '',
        defaultDbName: getPanelConfig(tab.panelId)?.dbName,
        dbType: getPanelConfig(tab.panelId)?.dbType || '',
      }
    case 'redis':
      return {
        sessionId: getPanelSessionId(tab.panelId) || '',
        keySeparator: getPanelConfig(tab.panelId)?.redisKeySeparator ?? '',
      }
    case 'mongodb':
    case 'elasticsearch':
    case 'monitor':
      return { sessionId: getPanelSessionId(tab.panelId) || '' }
    case 'k8s':
      return { tab, connection: k8sConnectionForTab(tab) }
    case 'start':
      return { tab }
    default:
      return {}
  }
})

/** 按 tab.type 计算事件监听器 */
const tabListeners = computed<Record<string, any>>(() => {
  const tab = props.tab
  if (tab.type === 'terminal') {
    return { close: (id: string) => emit('close', id) }
  }
  if (tab.type === 'start') {
    return {
      connect: (c: ConnectionConfig) => emit('connect', c),
      'new-connection': (p?: any) => emit('new-connection', p),
      'local-terminal': (s: string) => emit('local-terminal', s),
      'close-self': (id: string) => emit('close-self', id),
      'edit-connection': (c: ConnectionConfig) => emit('edit-connection', c),
      'change-group': (c: ConnectionConfig) => emit('change-group', c),
      'change-group-ids': (ids: string[]) => emit('change-group-ids', ids),
      'change-group-parent': (g: string) => emit('change-group-parent', g),
    }
  }
  return {}
})
</script>