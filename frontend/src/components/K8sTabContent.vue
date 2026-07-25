<template>
  <div class="db-tab-content">
    <div v-if="error" class="k8s-fatal">{{ error }}</div>
    <div v-else-if="!connId" class="k8s-connecting">Connecting…</div>
    <div v-else class="db-main">
      <div class="db-left" :style="{ width: leftWidth + 'px' }">
        <K8sTree :model-value="rootResourceKey" @update:model-value="selectResource" />
      </div>
      <div class="db-resizer" @mousedown="onResizeStart" />
      <div class="db-right">
        <K8sBreadcrumb
          :stack="navStack"
          :namespace="currentNamespace"
          :namespace-options="namespaceOptions"
          @pop="popTo"
          @update:namespace="setNamespace"
        />
        <K8sResourceList
          :conn-id="connId"
          :frame="topFrame"
          :namespace-options="namespaceOptions"
          @open-detail="openDetail"
          @open-logs="openLogs"
          @view-pods="viewPods"
          @open-crd="openCrd"
          @open-terminal="openTerminal"
          @changed="() => {}"
        />
      </div>
    </div>

    <K8sDetailDrawer
      :conn-id="connId"
      :mode="drawerMode"
      :target="drawerTarget"
      :resource-key="drawerResourceKey"
      :self-path-override="drawerSelfPathOverride"
      @close="closeDrawer"
      @saved="() => {}"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as k8sClient from '../services/k8sClient'
import { useTunnelCredentials } from '../composables/useTunnelCredentials'
import K8sTree from './K8sTree.vue'
import K8sResourceList from './K8sResourceList.vue'
import K8sBreadcrumb from './K8sBreadcrumb.vue'
import K8sDetailDrawer from './K8sDetailDrawer.vue'
import { parseCRD, crdListPath } from '../services/k8sCrd'
import type { K8sTab, NavFrame } from '../types/k8s'
import type { ConnectionConfig } from '../types/session'

const props = defineProps<{ tab: K8sTab; connection: ConnectionConfig }>()

const { resolveTunnelCredentials } = useTunnelCredentials()

const connId = ref<string>('')
const error = ref('')
const initialNamespace = ref<string>(props.tab.namespace || '')

// 静态候选 + 打开时选中的 ns，后续 PR 再动态拉 /api/v1/namespaces。
const namespaceOptions = computed(() => {
  const set = new Set<string>(['default', 'kube-system', 'kube-public'])
  if (initialNamespace.value) set.add(initialNamespace.value)
  return Array.from(set)
})

// ── nav stack ──────────────────────────────────────────────────
const navStack = ref<NavFrame[]>([{ kind: 'list', resourceKey: 'pods', namespace: props.tab.namespace || '' }])
const topFrame = computed(() => navStack.value[navStack.value.length - 1])
const rootResourceKey = computed(() => {
  const base = navStack.value[0]
  return base.kind === 'list' ? base.resourceKey : ''
})
const currentNamespace = computed(() => {
  const f = topFrame.value
  return f.kind === 'custom' ? f.namespace : (f as any).namespace || ''
})

function selectResource(key: string) {
  navStack.value = [{ kind: 'list', resourceKey: key, namespace: currentNamespace.value }]
}
function popTo(index: number) {
  navStack.value = navStack.value.slice(0, index + 1)
}
function setNamespace(ns: string) {
  const f = topFrame.value
  if (f.kind === 'list') navStack.value = [{ kind: 'list', resourceKey: f.resourceKey, namespace: ns }]
  else navStack.value = navStack.value.map((fr, i) => i === navStack.value.length - 1 ? { ...fr, namespace: ns } as NavFrame : fr)
}
function viewPods(owner: { kind: string; name: string; uid: string; namespace: string }) {
  navStack.value = [...navStack.value, {
    kind: 'owned', resourceKey: 'pods',
    ownerKind: owner.kind, ownerName: owner.name, ownerUid: owner.uid, namespace: owner.namespace,
  }]
}
function openCrd(crdObj: any) {
  const crd = parseCRD(crdObj)
  navStack.value = [...navStack.value, { kind: 'custom', crd, namespace: '' }]
}

// ── drawer ─────────────────────────────────────────────────────
const drawerMode = ref<'detail' | 'logs' | null>(null)
const drawerTarget = ref<any | null>(null)
const drawerResourceKey = ref<string>('pods')
const drawerSelfPathOverride = ref<((obj: any) => string) | undefined>(undefined)
function openDetail(obj: any) {
  drawerTarget.value = obj
  drawerResourceKey.value = resourceKeyOf()
  drawerSelfPathOverride.value = crSelfPathOverride()
  drawerMode.value = 'detail'
}
function openLogs(pod: any) { drawerTarget.value = pod; drawerResourceKey.value = 'pods'; drawerSelfPathOverride.value = undefined; drawerMode.value = 'logs' }
function closeDrawer() { drawerMode.value = null; drawerTarget.value = null }
function resourceKeyOf(): string {
  const f = topFrame.value
  if (f.kind === 'list') return f.resourceKey
  if (f.kind === 'owned') return f.resourceKey
  return 'customresourcedefinitions'
}
// CR 实例（custom frame）的 self-path 由 ParsedCRD 派生，避免落到 CRD 集合路径
function crSelfPathOverride(): ((obj: any) => string) | undefined {
  const f = topFrame.value
  if (f.kind !== 'custom') return undefined
  const crd = f.crd
  return (obj: any) => {
    const ns = obj.metadata?.namespace || f.namespace
    return crdListPath(crd, ns).split('?')[0] + '/' + encodeURIComponent(obj.metadata?.name)
  }
}
// openTerminal wired in Phase 3
function openTerminal(_pod: any) { /* Phase 3 */ }

// 左侧宽度 + resizer（抄 DBTabContent）
const leftWidth = ref(220)
let resizeStartX = 0
let resizeStartWidth = 0
let resizing = false
function onResizeStart(e: MouseEvent) {
  resizeStartX = e.clientX
  resizeStartWidth = leftWidth.value
  resizing = true
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}
function onResizeMove(e: MouseEvent) {
  const dx = e.clientX - resizeStartX
  leftWidth.value = Math.max(150, Math.min(500, resizeStartWidth + dx))
}
function onResizeEnd() {
  resizing = false
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}

async function connect() {
  try {
    const cfg = props.connection
    const source = cfg.k8sConfigInline ? cfg.k8sConfigInline : (cfg.k8sConfigPath || '~/.kube/config')
    const isPath = !cfg.k8sConfigInline
    let tunnelUser = ''
    let tunnelPassword = ''
    if (cfg.tunnelSSHConnId) {
      const creds = await resolveTunnelCredentials(cfg.tunnelSSHConnId)
      if (!creds) {
        error.value = 'Tunnel credentials cancelled'
        return
      }
      tunnelUser = creds.user
      tunnelPassword = creds.password
    }
    connId.value = await k8sClient.connect(
      source,
      isPath,
      cfg.k8sContext || '',
      cfg.tunnelSSHConnId || '',
      tunnelUser,
      tunnelPassword
    )
  } catch (e: any) {
    error.value = String(e?.message || e)
  }
}

onMounted(connect)
onBeforeUnmount(() => {
  if (resizing) {
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
  }
  if (connId.value) {
    // K8sResourceList 内部 onBeforeUnmount 已经 unsubscribe 当前订阅。
    k8sClient.disconnect(connId.value)
  }
})
</script>

<style scoped>
/* 直接抄 DBTabContent 的骨架 CSS，class 同名 */
.db-tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.db-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}
.db-left {
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle, #333);
  overflow: hidden;
}
.db-resizer {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex-shrink: 0;
  transition: background 0.15s ease;
}
.db-resizer:hover {
  background: var(--border-subtle, #333);
}
.db-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.k8s-fatal {
  color: var(--el-color-danger, #f56);
  padding: 12px;
}
.k8s-connecting {
  padding: 12px;
  opacity: 0.7;
}
</style>
