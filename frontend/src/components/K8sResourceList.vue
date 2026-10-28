<template>
  <div class="k8s-list-wrap">
    <div class="k8s-list-toolbar">
      <el-input
        v-model="filter"
        size="small"
        :placeholder="t('k8s.filter')"
        clearable
        class="k8s-filter"
      />

      <el-button size="small" :icon="Refresh" @click="onRefresh" />

      <el-button v-if="isNamespaceList" size="small" type="primary" @click="onNewNamespace">{{ t('k8s.newNamespace') }}</el-button>
      <el-button v-else-if="frame.kind === 'custom' || desc?.canCreate" size="small" type="primary" :icon="Plus" @click="onCreate" />

      <span class="k8s-list-title">
        {{ titleLabel }} ({{ displayCount }})
      </span>
    </div>

    <div v-if="listError" class="k8s-list-err">{{ listErrorText }}</div>

    <!-- 虚拟化资源列表拆分为 K8sVTable 子组件：排序/列筛选/虚拟滚动由子组件管理，
         列定义和数据由本容器计算后传入，操作列通过 #actions slot 注入。 -->
    <K8sVTable
      :columns="vtableColumns"
      :rows="vtableRows"
      :loading="isLoading"
      :empty-text="t('db.noData')"
      :actions-label="t('k8s.actions')"
      :action-width="vactionWidth"
      :row-class-fn="vrowClass"
      :reset-text="t('shortcut.reset')"
      @row-click="vrowClick"
    >
      <template #actions="{ row }">
        <template v-if="frame.kind === 'custom'">
          <button class="btn btn-ghost btn-icon btn-sm" :title="t('k8s.actionEdit')" @click.stop="emit('open-yaml', row)"><Pencil :size="'0.875rem'" /></button>
          <button class="btn btn-ghost btn-icon btn-sm danger" :title="t('k8s.actionDelete')" @click.stop="onDeleteCr(row)"><Trash2 :size="'0.875rem'" /></button>
        </template>
        <template v-else>
          <button
            v-for="a in rowActions(row)"
            :key="a"
            class="btn btn-ghost btn-icon btn-sm"
            :class="{ danger: actionMeta[a].danger }"
            :title="actionMeta[a].title(row)"
            @click.stop="actionMeta[a].run(row, $event)"
          >
            <component :is="actionMeta[a].icon(row)" :size="'0.875rem'" />
          </button>
        </template>
      </template>
    </K8sVTable>

    <K8sCreateDialog
      v-model="createVisible"
      :title="createTitle"
      :template="createTemplate"
      :saving="createSaving"
      :error="createError"
      @confirm="onCreateConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, h } from 'vue'
import { uiPx } from '../utils/uiScale'
import {
  ElInput, ElButton,
  ElMessageBox, ElMessage, ElCheckbox,
} from 'element-plus'
import { Refresh, Plus } from '@element-plus/icons-vue'
import {
  Pencil, ScrollText, SquareTerminal, Box, Repeat, ArrowUpDown, Ban, CircleCheck, CirclePower, Trash2, FolderOpen } from '@lucide/vue'
import { useK8sStore } from '../stores/k8sStore'
import { useI18n } from '../i18n'
import K8sCreateDialog from './K8sCreateDialog.vue'
import K8sVTable from './K8sVTable.vue'
import { type VCol, cellText } from './k8sVTableShared'
import { getResource, age } from '../services/k8sResources'
import { fetchPodMetrics, fetchNodeMetrics, type Usage } from '../services/k8sMetrics'
import { requestJSON } from '../services/k8sClient'
import { crdListPath, evalJsonPath } from '../services/k8sCrd'
import {
  podsOfOwner, podsOnNode, deleteResource, restartWorkload, scaleWorkload,
  cordonNode, drainNode, createResource, createNamespace,
} from '../services/k8sActions'
import type { NavFrame } from '../types/k8s'
const props = defineProps<{ connId: string; frame: Exclude<NavFrame, { kind: 'overview' }>; namespaceOptions: string[] }>()
const emit = defineEmits<{
  (e: 'open-detail', obj: any): void
  (e: 'open-yaml', obj: any): void
  (e: 'open-logs', pod: any): void
  (e: 'view-pods', owner: { kind: string; name: string; uid: string; namespace: string }): void
  (e: 'open-crd', crdObj: any): void
  (e: 'open-terminal', pod: any, ev?: MouseEvent): void
  (e: 'open-files', pod: any, ev?: MouseEvent): void
  (e: 'changed'): void
}>()

const store = useK8sStore()
const { t } = useI18n()

const isLoading = computed(() => {
  const f = props.frame
  if (f.kind === 'custom') return crdLoading.value
  if (f.kind === 'owned') return store.isLoading(props.connId, 'pods', f.namespace)
  return store.isLoading(props.connId, f.resourceKey, f.namespace)
})

const resourceKey = computed(() => props.frame.kind === 'custom' ? '__crd__' : props.frame.resourceKey)
const desc = computed(() => props.frame.kind === 'custom' ? undefined : getResource(props.frame.resourceKey))
const localNs = computed(() => props.frame.namespace || '')
const filter = ref(props.frame.kind === 'list' ? (props.frame.nameFilter || '') : '')

const isNamespaceList = computed(() => props.frame.kind === 'list' && props.frame.resourceKey === 'namespaces')
const isCrdList = computed(() => props.frame.kind === 'list' && props.frame.resourceKey === 'customresourcedefinitions')

// ── items（三种 frame 各自来源）─────────────────────────────────
const crdItems = ref<any[]>([])
const crdError = ref('')
const crdLoading = ref(false)

const items = computed<any[]>(() => {
  const f = props.frame
  if (f.kind === 'custom') return crdItems.value
  if (f.kind === 'owned') {
    const pods = store.getItems(props.connId, 'pods', f.namespace)
    if (f.ownerKind === 'Node') return podsOnNode(pods, f.ownerName)
    const rs = f.ownerKind === 'Deployment' ? store.getItems(props.connId, 'replicasets', f.namespace) : []
    return podsOfOwner(pods, { uid: f.ownerUid, kind: f.ownerKind }, rs)
  }
  return store.getItems(props.connId, f.resourceKey, f.namespace)
})

const listError = computed(() => {
  const f = props.frame
  if (f.kind === 'custom') return crdError.value
  if (f.kind === 'owned') return store.getError(props.connId, 'pods', f.namespace)
  return store.getError(props.connId, f.resourceKey, f.namespace)
})

// CRD 类资源（如 Gateway API）在未安装的集群上列表 404，翻译成人话
const listErrorText = computed(() =>
  listError.value && /404|not found/i.test(listError.value) ? t('k8s.crdMissing') : listError.value)

const filtered = computed(() => {
  const f = filter.value.trim().toLowerCase()
  const cols = desc.value?.columns || []
  // 参与筛选的列：标记 searchable 的列；若资源没标记任何列，退回仅按 name。
  const searchCols = cols.filter(c => c.searchable)
  const matches = (o: any) => {
    if ((o.metadata?.name || '').toLowerCase().includes(f)) return true
    return searchCols.some(c => cellText(c.value(o, usageOf(o))).toLowerCase().includes(f))
  }
  const list = f ? items.value.filter(matches) : items.value.slice()
  // 默认按名称升序（对齐 k9s）；否则 watch 增删的项会追加到 Map 末尾，
  // 删除后重建的资源就跑到列表最下面找不到了。点表头排序仍可覆盖。
  return list.sort((a, b) => (a.metadata?.name || '').localeCompare(b.metadata?.name || ''))
})
const crdFiltered = computed(() => {
  const f = filter.value.trim().toLowerCase()
  const cols = props.frame.kind === 'custom' ? props.frame.crd.printerColumns : []
  const matches = (o: any) => {
    if ((o.metadata?.name || '').toLowerCase().includes(f)) return true
    return cols.some(pc => String(evalJsonPath(o, pc.jsonPath) ?? '').toLowerCase().includes(f))
  }
  const list = f ? crdItems.value.filter(matches) : crdItems.value.slice()
  return list.sort((a, b) => (a.metadata?.name || '').localeCompare(b.metadata?.name || ''))
})

const titleLabel = computed(() =>
  props.frame.kind === 'custom' ? props.frame.crd.kind : (desc.value?.label || resourceKey.value))
const displayCount = computed(() =>
  props.frame.kind === 'custom' ? crdFiltered.value.length : filtered.value.length)

function onRowClick(row: any) {
  // CRD list rows drill into the CRD; everything else opens its detail.
  if (isCrdList.value) emit('open-crd', row)
  else emit('open-detail', row)
}


// ── action column ──────────────────────────────────────────────
function has(a: string) { return (desc.value?.actions || []).includes(a as any) }

// 每行的 action 列表：与资源定义一致（files 的 Running 校验在点击时做）。
function rowActions(_row: any): string[] {
  return (desc.value?.actions || []) as string[]
}

const actionMeta: Record<string, { icon: (row: any) => any; title: (row: any) => string; danger?: boolean; run: (row: any, ev?: MouseEvent) => void }> = {
  detail:   { icon: () => Pencil,          title: () => t('k8s.actionEdit'),     run: (row) => emit('open-yaml', row) },
  logs:     { icon: () => ScrollText,      title: () => t('k8s.actionLogs'),     run: (row) => emit('open-logs', row) },
  terminal: { icon: () => SquareTerminal,  title: () => t('k8s.actionTerminal'), run: (row, ev?) => emit('open-terminal', row, ev) },
  files:    {
    icon: () => FolderOpen,
    title: () => t('container.openFiles'),
    run: (row, ev?) => {
      if (row.status?.phase !== 'Running') {
        ElMessage.warning(t('container.filesRequireRunning'))
        return
      }
      emit('open-files', row, ev)
    },
  },
  viewPods: { icon: () => Box,             title: () => t('k8s.actionViewPods'), run: (row) => onViewPods(row) },
  restart:  { icon: () => Repeat,          title: () => t('k8s.actionRestart'),  run: (row) => onCommand('restart', row) },
  scale:    { icon: () => ArrowUpDown,     title: () => t('k8s.actionScale'),    run: (row) => onCommand('scale', row) },
  cordon:   {
    icon: (row) => (row.spec?.unschedulable ? CircleCheck : Ban),
    title: (row) => (row.spec?.unschedulable ? t('k8s.actionUncordon') : t('k8s.actionCordon')),
    run: (row) => onCommand('cordon', row),
  },
  drain:    { icon: () => CirclePower,     title: () => t('k8s.actionDrain'),    run: (row) => onCommand('drain', row) },
  delete:   { icon: () => Trash2,          title: () => t('k8s.actionDelete'), danger: true, run: (row) => onCommand('delete', row) },
}

const actionColWidth = computed(() => {
  const iconCount =
    (has('detail') ? 1 : 0) + (has('logs') ? 1 : 0) + (has('terminal') ? 1 : 0) +
    (has('viewPods') ? 1 : 0) + (has('restart') ? 1 : 0) + (has('scale') ? 1 : 0) +
    (has('files') ? 1 : 0) +
    (has('cordon') ? 1 : 0) + (has('drain') ? 1 : 0) + (has('delete') ? 1 : 0)
  if (!iconCount) return 0
  return 20 + iconCount * 30
})

const vtableColumns = computed<VCol[]>(() => {
  if (props.frame.kind === 'custom') {
    const pcs = props.frame.crd.printerColumns
    return [
      { header: 'Name', getText: (r: any) => r.metadata?.name || '' },
      ...pcs.map(pc => ({ header: pc.name, getText: (r: any) => String(evalJsonPath(r, pc.jsonPath) ?? '') })),
      { header: 'Age', getText: (r: any) => age(r.metadata?.creationTimestamp) },
    ]
  }
  return (desc.value?.columns || []).map(col => ({
    header: col.header,
    width: col.width,
    getText: (row: any) => cellText(col.value(row, usageOf(row))),
    sortable: true,
    filterable: !!col.filterable,
    sortNum: col.sortValue ? (row: any) => col.sortValue!(row, usageOf(row)) : undefined,
  }))
})

const vtableRows = computed<any[]>(() => props.frame.kind === 'custom' ? crdFiltered.value : filtered.value)

function vrowClass(row: any): string {
  if (props.frame.kind === 'custom') return ''
  const tone = desc.value?.rowTone?.(row)
  return tone ? `k8s-row-${tone}` : ''
}

function vrowClick(row: any) {
  if (props.frame.kind === 'custom') emit('open-detail', row)
  else onRowClick(row)
}

const vactionWidth = computed(() => {
  if (props.frame.kind === 'custom') return uiPx(66)
  return actionColWidth.value ? uiPx(actionColWidth.value) : 0
})

function onViewPods(row: any) {
  if (props.frame.kind === 'custom') return
  emit('view-pods', {
    kind: desc.value!.kind, name: row.metadata?.name,
    uid: row.metadata?.uid, namespace: row.metadata?.namespace || '',
  })
}
function selfPathOf(row: any): string {
  const d = desc.value!
  const base = d.listPath(row.metadata?.namespace || '').split('?')[0]
  return `${base}/${encodeURIComponent(row.metadata?.name)}`
}
function scaleApiBase(row: any): string {
  return desc.value!.listPath(row.metadata?.namespace || '').split('?')[0]
}
function isoNow(): string { return new Date().toISOString() }

// 删除确认弹窗，内嵌 force 复选框；返回是否勾选 force。取消会 reject（'cancel'）。
async function confirmDelete(kind: string, name: string): Promise<boolean> {
  const force = ref(false)
  await ElMessageBox({
    title: t('k8s.confirmTitle'),
    type: 'warning',
    showCancelButton: true,
    confirmButtonText: t('common.confirm'),
    cancelButtonText: t('common.cancel'),
    message: () => h('div', [
      h('p', { style: 'margin: 0 0 0.5rem' }, t('k8s.deleteConfirm', { kind, name })),
      h(ElCheckbox, {
        modelValue: force.value,
        'onUpdate:modelValue': (v: any) => { force.value = !!v },
      }, () => t('k8s.deleteForce')),
    ]),
  })
  return force.value
}

async function onCommand(cmd: string, row: any) {
  try {
    if (cmd === 'delete') {
      const force = await confirmDelete(desc.value!.kind, row.metadata?.name)
      await deleteResource(props.connId, selfPathOf(row), force); ElMessage.success(t('k8s.deleted')); emit('changed')
    } else if (cmd === 'restart') {
      await ElMessageBox.confirm(t('k8s.restartConfirm', { name: row.metadata?.name }), t('k8s.confirmTitle'), { confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') })
      await restartWorkload(props.connId, desc.value!.kind, row.metadata?.namespace, row.metadata?.name, isoNow()); ElMessage.success(t('k8s.restarted'))
    } else if (cmd === 'scale') {
      const { value } = await ElMessageBox.prompt(t('k8s.scaleReplicas'), t('k8s.scaleTitle'), { inputPattern: /^\d+$/, inputValue: String(row.spec?.replicas ?? 1), confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') })
      await scaleWorkload(props.connId, scaleApiBase(row), row.metadata?.namespace, row.metadata?.name, Number(value)); ElMessage.success(t('k8s.scaled'))
    } else if (cmd === 'cordon') {
      const unschedulable = !row.spec?.unschedulable
      await ElMessageBox.confirm(t(unschedulable ? 'k8s.cordonConfirm' : 'k8s.uncordonConfirm', { name: row.metadata?.name }), t('k8s.confirmTitle'), { type: 'warning', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') })
      await cordonNode(props.connId, row.metadata?.name, unschedulable); ElMessage.success(t('k8s.done')); emit('changed')
    } else if (cmd === 'drain') {
      await ElMessageBox.confirm(t('k8s.drainConfirm', { name: row.metadata?.name }), t('k8s.confirmTitle'), { type: 'warning', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') })
      const r = await drainNode(props.connId, row.metadata?.name); ElMessage.success(t('k8s.drained', { evicted: r.evicted, skipped: r.skipped }) + (r.errors.length ? t('k8s.drainErrors', { count: r.errors.length }) : ''))
    }
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e?.message || e))
  }
}

// ── create ─────────────────────────────────────────────────────
async function onNewNamespace() {
  try {
    const { value } = await ElMessageBox.prompt(t('k8s.namespaceName'), t('k8s.newNamespace'), { inputPattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') })
    await createNamespace(props.connId, value); ElMessage.success(t('k8s.created')); emit('changed')
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e?.message || e)) }
}
// ── create (SFTP-style line-numbered YAML dialog) ───────────────
const createVisible = ref(false)
const createTitle = ref('')
const createTemplate = ref('')
const createSaving = ref(false)
const createError = ref('')

function onCreate() {
  const f = props.frame
  createError.value = ''
  if (f.kind === 'custom') {
    const crd = f.crd
    const apiVersion = `${crd.group}/${crd.version}`
    const nsLine = crd.scope === 'Namespaced' ? `\n  namespace: ${f.namespace || 'default'}` : ''
    createTemplate.value = `apiVersion: ${apiVersion}\nkind: ${crd.kind}\nmetadata:\n  name: ${nsLine}\n`
    createTitle.value = t('k8s.createTitle', { kind: crd.kind })
  } else {
    const d = desc.value!
    const ns = localNs.value || 'default'
    createTemplate.value = d.createTemplate ? d.createTemplate(ns) : `apiVersion: ${d.apiVersion}\nkind: ${d.kind}\nmetadata:\n  name: \n  namespace: ${ns}\n`
    createTitle.value = t('k8s.createTitle', { kind: d.kind })
  }
  createVisible.value = true
}

async function onCreateConfirm(yaml: string) {
  const f = props.frame
  createSaving.value = true
  createError.value = ''
  try {
    let path: string
    if (f.kind === 'custom') {
      path = crdListPath(f.crd, f.namespace).split('?')[0]
    } else {
      const d = desc.value!
      path = d.createPath ? d.createPath(localNs.value) : d.listPath(localNs.value).split('?')[0]
    }
    await createResource(props.connId, path, yaml)
    createVisible.value = false
    ElMessage.success(t('k8s.created'))
    if (f.kind === 'custom') await loadCrd()
    else emit('changed')
  } catch (e: any) {
    createError.value = String(e?.message || e)
  } finally {
    createSaving.value = false
  }
}

async function onDeleteCr(row: any) {
  if (props.frame.kind !== 'custom') return
  try {
    const force = await confirmDelete(props.frame.crd.kind, row.metadata?.name)
    const base = crdListPath(props.frame.crd, row.metadata?.namespace || props.frame.namespace).split('?')[0]
    await deleteResource(props.connId, `${base}/${encodeURIComponent(row.metadata?.name)}`, force)
    ElMessage.success(t('k8s.deleted')); await loadCrd()
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e?.message || e)) }
}

// ── metrics poller ─────────────────────────────────────────────
const metricsMap = ref<Map<string, Usage> | null>(null)
let metricsTimer: number | null = null

async function pollMetrics() {
  if (!props.connId || !desc.value?.metrics) return
  try {
    metricsMap.value = desc.value.metrics === 'pod'
      ? await fetchPodMetrics(props.connId, localNs.value)
      : await fetchNodeMetrics(props.connId)
  } catch { metricsMap.value = null }
}
function startMetrics() {
  stopMetrics()
  if (!desc.value?.metrics) return
  pollMetrics()
  metricsTimer = window.setInterval(pollMetrics, 15000)
}
function stopMetrics() {
  if (metricsTimer != null) { clearInterval(metricsTimer); metricsTimer = null }
}

// 该行对应的实时用量，注入给列定义的 value(row, usage)。pod 按 ns/name、
// node 按 name 索引；无 metrics 资源返回 null。
function usageOf(row: any): Usage | null {
  if (!metricsMap.value || !desc.value?.metrics) return null
  const key = desc.value.metrics === 'pod'
    ? `${row.metadata?.namespace || ''}/${row.metadata?.name || ''}`
    : row.metadata?.name
  return metricsMap.value.get(key) || null
}

// ── subscription lifecycle（frame 驱动）─────────────────────────
let subs: { res: string; ns: string }[] = []

function subsFor(f: NavFrame): { res: string; ns: string }[] {
  if (f.kind === 'overview' || f.kind === 'custom') return []
  if (f.kind === 'owned') {
    const arr = [{ res: 'pods', ns: f.namespace }]
    if (f.ownerKind === 'Deployment') arr.push({ res: 'replicasets', ns: f.namespace })
    return arr
  }
  return [{ res: f.resourceKey, ns: f.namespace }]
}

async function loadCrd() {
  if (props.frame.kind !== 'custom') return
  crdError.value = ''
  crdLoading.value = true
  try {
    const { status, data, raw } = await requestJSON<any>(props.connId, 'GET', crdListPath(props.frame.crd, props.frame.namespace))
    if (status < 200 || status >= 300) { crdError.value = `HTTP ${status}: ${raw?.slice(0, 300) || ''}`; crdItems.value = []; return }
    crdItems.value = data?.items || []
  } catch (e: any) { crdError.value = String(e?.message || e); crdItems.value = [] }
  finally { crdLoading.value = false }
}

async function applySubs() {
  if (!props.connId) return
  const old = subs
  const next = subsFor(props.frame)
  subs = next
  for (const s of old) store.unsubscribe(props.connId, s.res, s.ns)
  for (const s of next) await store.subscribe(props.connId, s.res, s.ns)
  startMetrics()
  if (props.frame.kind === 'custom') { crdItems.value = []; await loadCrd() }
}

watch(() => props.frame, async () => {
  // frame 变化即视为打开新列表：按 nameFilter 预填过滤词（无则清空）
  filter.value = props.frame.kind === 'list' ? (props.frame.nameFilter || '') : ''
  if (props.connId) await applySubs()
})

watch(() => props.connId, async (v) => {
  if (v) await applySubs()
}, { immediate: true })

async function onRefresh() {
  if (!props.connId) return
  await applySubs()
}

onBeforeUnmount(() => {
  stopMetrics()
  for (const s of subs) store.unsubscribe(props.connId, s.res, s.ns)
})
</script>

<style scoped>
.k8s-list-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}
.k8s-list-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.625rem;
  border-bottom: 1px solid var(--el-border-color-lighter, #333);
  flex-shrink: 0;
}
.k8s-filter {
  width: 13.75rem;
}
.k8s-list-title {
  margin-left: auto;
  color: var(--text-secondary, #888);
  font-size: 0.75rem;
}
.k8s-list-err {
  color: var(--el-color-danger, #f56);
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  border-bottom: 1px solid var(--el-border-color-lighter, #333);
}
</style>
