<template>
  <div class="k8s-list-wrap">
    <div class="k8s-list-toolbar">
      <el-input
        v-model="filter"
        size="small"
        placeholder="filter"
        clearable
        class="k8s-filter"
      />

      <el-button size="small" :icon="Refresh" @click="onRefresh" />

      <el-button v-if="isNamespaceList" size="small" type="primary" @click="onNewNamespace">新建 Namespace</el-button>
      <el-button v-else-if="desc?.canCreate" size="small" type="primary" :icon="Plus" @click="onCreate" />

      <span class="k8s-list-title">
        {{ titleLabel }} ({{ displayCount }})
      </span>
    </div>

    <div v-if="listError" class="k8s-list-err">{{ listError }}</div>

    <!-- CRD 实例列表：动态列 -->
    <el-table
      v-if="frame.kind === 'custom'"
      :data="crdFiltered"
      size="small"
      height="calc(100% - 40px)"
      class="k8s-list-table"
      @row-click="r => emit('open-detail', r)"
    >
      <el-table-column label="Name"><template #default="{ row }">{{ row.metadata?.name }}</template></el-table-column>
      <el-table-column v-for="pc in frame.crd.printerColumns" :key="pc.name" :label="pc.name">
        <template #default="{ row }">{{ evalJsonPath(row, pc.jsonPath) }}</template>
      </el-table-column>
      <el-table-column label="Age"><template #default="{ row }">{{ age(row.metadata?.creationTimestamp) }}</template></el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link @click.stop="emit('open-detail', row)">详情</el-button>
          <el-button size="small" link @click.stop="onDeleteCr(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 常规资源列表 -->
    <el-table
      v-else
      :data="filtered"
      size="small"
      height="calc(100% - 40px)"
      class="k8s-list-table"
      @row-click="onRowClick"
    >
      <el-table-column
        v-for="col in desc?.columns || []"
        :key="col.header"
        :label="col.header"
        :width="col.width"
        sortable
        :filters="col.filterable ? enumFilters(col) : undefined"
        :filter-method="col.filterable ? (val, row) => cellText(col.value(row)) === val : undefined"
      >
        <template #default="{ row }">{{ cellText(col.value(row)) }}</template>
      </el-table-column>

      <template v-if="desc?.metrics === 'pod'">
        <el-table-column label="CPU" width="90">
          <template #default="{ row }">{{ podCpu(row) }}</template>
        </el-table-column>
        <el-table-column label="MEM" width="90">
          <template #default="{ row }">{{ podMem(row) }}</template>
        </el-table-column>
      </template>
      <template v-else-if="desc?.metrics === 'node'">
        <el-table-column label="CPU" width="80"><template #default="{ row }">{{ nodeCpu(row) }}</template></el-table-column>
        <el-table-column label="CPU%" width="70"><template #default="{ row }">{{ nodeCpuPct(row) }}</template></el-table-column>
        <el-table-column label="MEM" width="90"><template #default="{ row }">{{ nodeMem(row) }}</template></el-table-column>
        <el-table-column label="MEM%" width="70"><template #default="{ row }">{{ nodeMemPct(row) }}</template></el-table-column>
      </template>

      <el-table-column v-if="actionColWidth" label="操作" :width="actionColWidth" fixed="right">
        <template #default="{ row }">
          <el-button v-if="has('detail')" size="small" link @click.stop="emit('open-detail', row)">详情</el-button>
          <el-button v-if="has('logs')" size="small" link @click.stop="emit('open-logs', row)">日志</el-button>
          <el-button v-if="has('terminal')" size="small" link @click.stop="emit('open-terminal', row)">终端</el-button>
          <el-button v-if="has('viewPods')" size="small" link @click.stop="onViewPods(row)">查看Pods</el-button>
          <el-dropdown v-if="dropdownActions.length" trigger="click" @command="cmd => onCommand(cmd, row)">
            <el-button size="small" link>⋯</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-if="has('restart')" command="restart">重启</el-dropdown-item>
                <el-dropdown-item v-if="has('scale')" command="scale">伸缩</el-dropdown-item>
                <el-dropdown-item v-if="has('cordon')" command="cordon">{{ row.spec?.unschedulable ? 'Uncordon' : 'Cordon' }}</el-dropdown-item>
                <el-dropdown-item v-if="has('drain')" command="drain">Drain</el-dropdown-item>
                <el-dropdown-item v-if="has('delete')" command="delete" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="frame.kind !== 'custom' && !items.length && !listError" class="k8s-list-empty">
      No {{ titleLabel }}<template v-if="desc?.namespaced"> in namespace <code>{{ localNs || '(all)' }}</code></template>.
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import {
  ElTable, ElTableColumn, ElInput, ElButton,
  ElDropdown, ElDropdownMenu, ElDropdownItem, ElMessageBox, ElMessage,
} from 'element-plus'
import { Refresh, Plus } from '@element-plus/icons-vue'
import { useK8sStore } from '../stores/k8sStore'
import { getResource, age, type ColoredCell } from '../services/k8sResources'
import { fetchPodMetrics, fetchNodeMetrics, type Usage } from '../services/k8sMetrics'
import { formatCpu, formatMemory, percent, parseCpu, parseMemory } from '../services/k8sQuantity'
import { requestJSON } from '../services/k8sClient'
import { crdListPath, evalJsonPath } from '../services/k8sCrd'
import {
  podsOfOwner, podsOnNode, deleteResource, restartWorkload, scaleWorkload,
  cordonNode, drainNode, createResource, createNamespace,
} from '../services/k8sActions'
import type { NavFrame } from '../types/k8s'

const props = defineProps<{ connId: string; frame: NavFrame; namespaceOptions: string[] }>()
const emit = defineEmits<{
  (e: 'open-detail', obj: any): void
  (e: 'open-logs', pod: any): void
  (e: 'view-pods', owner: { kind: string; name: string; uid: string; namespace: string }): void
  (e: 'open-crd', crdObj: any): void
  (e: 'open-terminal', pod: any): void
  (e: 'changed'): void
}>()

const store = useK8sStore()

const resourceKey = computed(() => props.frame.kind === 'custom' ? '__crd__' : props.frame.resourceKey)
const desc = computed(() => props.frame.kind === 'custom' ? undefined : getResource(props.frame.resourceKey))
const localNs = computed(() => props.frame.namespace || '')
const filter = ref('')

const isNamespaceList = computed(() => props.frame.kind === 'list' && props.frame.resourceKey === 'namespaces')
const isCrdList = computed(() => props.frame.kind === 'list' && props.frame.resourceKey === 'customresourcedefinitions')

// ── items（三种 frame 各自来源）─────────────────────────────────
const crdItems = ref<any[]>([])
const crdError = ref('')

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

const filtered = computed(() => {
  const f = filter.value.trim().toLowerCase()
  if (!f) return items.value
  return items.value.filter(o => (o.metadata?.name || '').toLowerCase().includes(f))
})
const crdFiltered = computed(() => {
  const f = filter.value.trim().toLowerCase()
  if (!f) return crdItems.value
  return crdItems.value.filter(o => (o.metadata?.name || '').toLowerCase().includes(f))
})

const titleLabel = computed(() =>
  props.frame.kind === 'custom' ? props.frame.crd.kind : (desc.value?.label || resourceKey.value))
const displayCount = computed(() =>
  props.frame.kind === 'custom' ? crdFiltered.value.length : filtered.value.length)

function cellText(v: string | number | ColoredCell): string {
  if (v == null) return ''
  if (typeof v === 'object' && 'text' in v) return v.text
  return String(v)
}

function enumFilters(col: any) {
  const set = new Set<string>()
  for (const row of items.value) set.add(cellText(col.value(row)))
  return Array.from(set).filter(Boolean).sort().map(v => ({ text: v, value: v }))
}

function onRowClick(row: any) {
  if (isCrdList.value) emit('open-crd', row)
  else emit('open-detail', row)
}

// ── action column ──────────────────────────────────────────────
function has(a: string) { return (desc.value?.actions || []).includes(a as any) }
const dropdownActions = computed(() =>
  (desc.value?.actions || []).filter(a => ['restart', 'scale', 'cordon', 'drain', 'delete'].includes(a)))
const actionColWidth = computed(() => {
  if (!desc.value?.actions?.length) return 0
  return 90 + (has('detail') ? 44 : 0) + (has('logs') ? 44 : 0) + (has('terminal') ? 44 : 0) + (has('viewPods') ? 72 : 0)
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

async function onCommand(cmd: string, row: any) {
  try {
    if (cmd === 'delete') {
      await ElMessageBox.confirm(`Delete ${desc.value!.kind} ${row.metadata?.name}?`, 'Confirm', { type: 'warning' })
      await deleteResource(props.connId, selfPathOf(row)); ElMessage.success('Deleted'); emit('changed')
    } else if (cmd === 'restart') {
      await ElMessageBox.confirm(`Restart ${row.metadata?.name}?`, 'Confirm')
      await restartWorkload(props.connId, desc.value!.kind, row.metadata?.namespace, row.metadata?.name, isoNow()); ElMessage.success('Restarted')
    } else if (cmd === 'scale') {
      const { value } = await ElMessageBox.prompt('Replicas', 'Scale', { inputPattern: /^\d+$/, inputValue: String(row.spec?.replicas ?? 1) })
      await scaleWorkload(props.connId, scaleApiBase(row), row.metadata?.namespace, row.metadata?.name, Number(value)); ElMessage.success('Scaled')
    } else if (cmd === 'cordon') {
      await cordonNode(props.connId, row.metadata?.name, !row.spec?.unschedulable); ElMessage.success('Done'); emit('changed')
    } else if (cmd === 'drain') {
      await ElMessageBox.confirm(`Drain node ${row.metadata?.name}? Pods will be evicted.`, 'Confirm', { type: 'warning' })
      const r = await drainNode(props.connId, row.metadata?.name); ElMessage.success(`Evicted ${r.evicted}, skipped ${r.skipped}${r.errors.length ? ', errors: ' + r.errors.length : ''}`)
    }
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e?.message || e))
  }
}

// ── create ─────────────────────────────────────────────────────
async function onNewNamespace() {
  try {
    const { value } = await ElMessageBox.prompt('Namespace name', '新建 Namespace', { inputPattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/ })
    await createNamespace(props.connId, value); ElMessage.success('Created'); emit('changed')
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e?.message || e)) }
}
async function onCreate() {
  const d = desc.value!
  const tmpl = d.createTemplate || `apiVersion: ${d.apiVersion}\nkind: ${d.kind}\nmetadata:\n  name: \n  namespace: ${localNs.value || 'default'}\n`
  try {
    const { value } = await ElMessageBox.prompt('YAML', `新建 ${d.kind}`, { inputType: 'textarea', inputValue: tmpl } as any)
    const path = (d.createPath ? d.createPath(localNs.value) : d.listPath(localNs.value).split('?')[0])
    await createResource(props.connId, path, value); ElMessage.success('Created'); emit('changed')
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.error(String(e?.message || e)) }
}

async function onDeleteCr(row: any) {
  if (props.frame.kind !== 'custom') return
  try {
    await ElMessageBox.confirm(`Delete ${props.frame.crd.kind} ${row.metadata?.name}?`, 'Confirm', { type: 'warning' })
    const base = crdListPath(props.frame.crd, row.metadata?.namespace || props.frame.namespace).split('?')[0]
    await deleteResource(props.connId, `${base}/${encodeURIComponent(row.metadata?.name)}`)
    ElMessage.success('Deleted'); await loadCrd()
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

function podKey(row: any) { return `${row.metadata?.namespace || ''}/${row.metadata?.name || ''}` }
function podCpu(row: any) { const u = metricsMap.value?.get(podKey(row)); return u ? formatCpu(u.cpu) : '—' }
function podMem(row: any) { const u = metricsMap.value?.get(podKey(row)); return u ? formatMemory(u.mem) : '—' }
function nodeCpu(row: any) { const u = metricsMap.value?.get(row.metadata?.name); return u ? formatCpu(u.cpu) : '—' }
function nodeMem(row: any) { const u = metricsMap.value?.get(row.metadata?.name); return u ? formatMemory(u.mem) : '—' }
function parseCpuAlloc(row: any) { return parseCpu(row.status?.allocatable?.cpu) }
function parseMemAlloc(row: any) { return parseMemory(row.status?.allocatable?.memory) }
function nodeCpuPct(row: any) {
  const u = metricsMap.value?.get(row.metadata?.name); if (!u) return '—'
  const cap = parseCpuAlloc(row); return percent(u.cpu, cap)
}
function nodeMemPct(row: any) {
  const u = metricsMap.value?.get(row.metadata?.name); if (!u) return '—'
  const cap = parseMemAlloc(row); return percent(u.mem, cap)
}

// ── subscription lifecycle（frame 驱动）─────────────────────────
let subs: { res: string; ns: string }[] = []

function subsFor(f: NavFrame): { res: string; ns: string }[] {
  if (f.kind === 'custom') return []
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
  try {
    const { status, data, raw } = await requestJSON<any>(props.connId, 'GET', crdListPath(props.frame.crd, props.frame.namespace))
    if (status < 200 || status >= 300) { crdError.value = `HTTP ${status}: ${raw?.slice(0, 300) || ''}`; crdItems.value = []; return }
    crdItems.value = data?.items || []
  } catch (e: any) { crdError.value = String(e?.message || e); crdItems.value = [] }
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
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter, #333);
  flex-shrink: 0;
}
.k8s-filter {
  width: 220px;
}
.k8s-list-title {
  margin-left: auto;
  color: var(--text-secondary, #888);
  font-size: 12px;
}
.k8s-list-table {
  flex: 1;
}
.k8s-list-err {
  color: var(--el-color-danger, #f56);
  padding: 8px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter, #333);
}
.k8s-list-empty {
  padding: 24px;
  text-align: center;
  opacity: 0.55;
  font-size: 13px;
}
.k8s-list-empty code {
  padding: 1px 6px;
  background: rgba(255,255,255,0.06);
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
}
</style>
