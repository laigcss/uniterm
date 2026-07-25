<template>
  <div class="detail-drawer-backdrop" :class="{ open: !!mode }" @click="$emit('close')"></div>
  <div class="detail-drawer" :class="{ open: !!mode }">
    <div class="detail-drawer-header">
      <span class="detail-drawer-title">{{ headerTitle }}</span>
      <el-button link @click="$emit('close')"><el-icon><Close :size="16" /></el-icon></el-button>
    </div>

    <template v-if="mode === 'detail'">
      <div class="db-tabs">
        <button class="db-tab" :class="{ active: tab === 'struct' }" @click="tab = 'struct'">结构</button>
        <button class="db-tab" :class="{ active: tab === 'yaml' }" @click="tab = 'yaml'">YAML</button>
      </div>

      <div v-show="tab === 'struct'" class="detail-body">
        <div v-for="sec in sections" :key="sec.label" class="detail-section">
          <div class="detail-section-title">{{ sec.label }}</div>
          <div v-for="f in sec.fields" :key="f.label" class="detail-row">
            <span class="detail-label">{{ f.label }}</span>
            <span class="detail-value">{{ fieldText(f) }}</span>
          </div>
        </div>
      </div>

      <div v-show="tab === 'yaml'" class="yaml-pane">
        <div class="yaml-actions">
          <template v-if="!editing">
            <el-button size="small" @click="startEdit">编辑</el-button>
            <el-button size="small" @click="copyYaml">复制</el-button>
          </template>
          <template v-else>
            <el-button size="small" type="primary" :loading="saving" @click="save">保存</el-button>
            <el-button size="small" @click="cancelEdit">取消</el-button>
          </template>
        </div>
        <pre v-if="!editing" class="k8s-yaml-drawer-body">{{ yamlText }}</pre>
        <textarea v-else v-model="draft" class="k8s-yaml-drawer-body yaml-edit" spellcheck="false"></textarea>
        <div v-if="saveError" class="yaml-error">{{ saveError }}</div>
      </div>
    </template>

    <div v-else-if="mode === 'logs'" class="logs-placeholder"><!-- filled in Phase 3 --></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElIcon, ElMessage } from 'element-plus'
import { Close } from '@element-plus/icons-vue'
import { dump, load } from 'js-yaml'
import { getResource, type DetailSection } from '../services/k8sResources'
import { requestJSON } from '../services/k8sClient'

const props = defineProps<{ connId: string; mode: 'detail' | 'logs' | null; target: any | null; resourceKey: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const tab = ref<'struct' | 'yaml'>('struct')
const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const saveError = ref('')

watch(() => props.target, () => { tab.value = 'struct'; editing.value = false; saveError.value = '' })

const headerTitle = computed(() => {
  const o = props.target
  if (!o) return ''
  return `${o.kind || getResource(props.resourceKey)?.kind || '?'} / ${o.metadata?.namespace || 'cluster'} / ${o.metadata?.name || ''}`
})

const sections = computed<DetailSection[]>(() => {
  const desc = getResource(props.resourceKey)
  if (desc?.detailSections?.length) return desc.detailSections
  // generic fallback
  return [{ label: 'Metadata', fields: [
    { label: 'Name', value: (o: any) => o.metadata?.name || '' },
    { label: 'Namespace', value: (o: any) => o.metadata?.namespace || 'cluster' },
    { label: 'Created', value: (o: any) => o.metadata?.creationTimestamp || '' },
  ] }]
})

function fieldText(f: any): string {
  if (!props.target) return ''
  const v = f.value(props.target)
  return typeof v === 'object' && v ? v.text : String(v ?? '')
}

const yamlText = computed(() => {
  if (!props.target) return ''
  try { return dump(props.target, { sortKeys: false, lineWidth: 120 }) }
  catch (e: any) { return `# dump failed: ${e?.message || e}` }
})

function startEdit() { draft.value = yamlText.value; editing.value = true; saveError.value = '' }
function cancelEdit() { editing.value = false; saveError.value = '' }
async function copyYaml() {
  try { await navigator.clipboard.writeText(yamlText.value); ElMessage.success('Copied') }
  catch (e: any) { ElMessage.error(`Copy failed: ${e?.message || e}`) }
}

function selfPath(o: any): string {
  const desc = getResource(props.resourceKey)!
  const ns = o.metadata?.namespace
  const base = desc.listPath(ns || '').split('?')[0]
  return `${base}/${encodeURIComponent(o.metadata?.name)}`
}

async function save() {
  saving.value = true; saveError.value = ''
  try {
    const parsed = load(draft.value) as any
    if (!parsed || typeof parsed !== 'object') throw new Error('YAML is not an object')
    const { status, raw } = await requestJSON(props.connId, 'PUT', selfPath(props.target), JSON.stringify(parsed), 'application/json')
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}: ${raw?.slice(0, 200) || ''}`)
    editing.value = false
    emit('saved')
    emit('close')
    ElMessage.success('Saved')
  } catch (e: any) {
    saveError.value = String(e?.message || e)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
/* Copied verbatim from MonitorTabContent.vue */
.detail-drawer-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
  z-index: 99;
}

.detail-drawer-backdrop.open {
  opacity: 1;
  pointer-events: auto;
}

.detail-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  background: var(--bg-elevated);
  border-left: 1px solid var(--border-subtle);
  transform: translateX(100%);
  transition: transform 0.3s ease;
  z-index: 100;
  display: flex;
  flex-direction: column;
}

.detail-drawer.open {
  transform: translateX(0);
}

.detail-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.detail-drawer-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-ui);
}

/* Detail rows copied verbatim from MonitorTabContent.vue (.process-detail rows) */
.detail-section {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px;
}

.detail-row {
  display: flex;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
  gap: 12px;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-ui);
  flex-shrink: 0;
  width: 100px;
  min-width: 100px;
}

.detail-value {
  font-size: 13px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  word-break: break-all;
  flex: 1;
  user-select: text;
}

/* Copied verbatim from DBTabContent.vue */
.db-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-subtle);
  padding: 0 8px;
  flex-shrink: 0;
}
.db-tab {
  padding: 6px 16px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: 13px;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}
.db-tab:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.db-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent);
}

/* Copied verbatim from K8sYamlDrawer.vue */
.k8s-yaml-drawer-body {
  margin: 0;
  padding: 12px;
  overflow: auto;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  height: 100%;
  box-sizing: border-box;
}

.detail-body { flex: 1; overflow: auto; padding: 12px 16px; }
.detail-section-title { font-weight: 600; color: var(--text-secondary); margin: 8px 0 4px; }
.yaml-pane { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.yaml-actions { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); }
.yaml-edit { width: 100%; box-sizing: border-box; resize: none; background: transparent; color: var(--text-primary); border: none; outline: none; }
.yaml-error { color: var(--el-color-danger, #f56); padding: 8px 12px; font-size: 12px; }
</style>
