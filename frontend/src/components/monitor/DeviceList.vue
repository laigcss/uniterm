<template>
  <div class="tab-pane devices-pane" @contextmenu.prevent="emit('contextmenu', $event)">
    <div class="od-toolbar">
      <el-input v-model="search" :placeholder="t('monitor.searchDevice')" clearable class="od-search" />
      <el-button :icon="RefreshRight" :loading="loading" @click="emit('refresh')">
        {{ t('monitor.refresh') }}
      </el-button>
    </div>
    <el-table :data="treeData" row-key="rowKey" :tree-props="{ children: 'children' }" size="small" border v-loading="loading" height="calc(100% - 2.25rem)" class="od-table">
      <el-table-column prop="id" :label="t('monitor.device.slot')" sortable :width="uiPx(150)" show-overflow-tooltip />
      <el-table-column prop="class" :label="t('monitor.device.class')" :min-width="uiPx(150)" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.isGroup">{{ t('monitor.device.cat.' + row.category) }} ({{ row.count }})</span>
          <span v-else>{{ row.class }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="vendor" :label="t('monitor.device.vendor')" sortable :min-width="uiPx(150)" show-overflow-tooltip />
      <el-table-column prop="product" :label="t('monitor.device.device')" :min-width="uiPx(220)" show-overflow-tooltip />
      <el-table-column prop="driver" :label="t('monitor.device.driver')" sortable :width="uiPx(120)" show-overflow-tooltip />
      <el-table-column prop="serial" :label="t('monitor.device.serial')" :width="uiPx(140)" show-overflow-tooltip />
      <el-table-column prop="capacity" :label="t('monitor.device.capacity')" sortable :width="uiPx(100)" />
      <el-table-column prop="rev" :label="t('monitor.device.rev')" :width="uiPx(90)" show-overflow-tooltip />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import { useI18n } from '../../i18n'
import { uiPx } from '../../utils/uiScale'
import type { DeviceInfo, DeviceTreeNode } from './monitorTypes'

const props = defineProps<{
  list: DeviceInfo[]
  loading: boolean
}>()

const emit = defineEmits<{
  refresh: []
  contextmenu: [event: MouseEvent]
}>()

defineOptions({ name: 'DeviceList' })

const { t } = useI18n()
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.list
  return props.list.filter((d: DeviceInfo) =>
    String(d.id).toLowerCase().includes(q) ||
    String(d.class).toLowerCase().includes(q) ||
    String(d.vendor).toLowerCase().includes(q) ||
    String(d.product).toLowerCase().includes(q) ||
    String(d.driver).toLowerCase().includes(q) ||
    String(d.serial).toLowerCase().includes(q)
  )
})

// Devices grouped by category for the tree table. Search filters the flat
// list first, so empty categories disappear while searching.
const deviceCatOrder = ['processor', 'memory', 'storage', 'network', 'display', 'bus', 'other']
const treeData = computed(() => {
  const groups = new Map<string, DeviceInfo[]>()
  for (const d of filtered.value) {
    const cat = d.category || 'other'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)!.push(d)
  }
  const rows: DeviceTreeNode[] = []
  for (const cat of deviceCatOrder) {
    const kids = groups.get(cat)
    if (!kids?.length) continue
    rows.push({
      rowKey: `cat:${cat}`,
      isGroup: true,
      category: cat,
      count: kids.length,
      children: kids.map((d, i) => ({ ...d, rowKey: `${cat}:${i}:${d.id}` }))
    })
  }
  return rows
})
</script>

<style scoped>
.tab-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.devices-pane {
  flex-direction: column;
  padding: 0;
}
.od-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  flex-shrink: 0;
  gap: 0.75rem;
}
.od-search {
  width: 15rem;
}
.od-table {
  flex: 1;
  min-height: 0;
}
.od-table :deep(.cell) {
  user-select: text;
}
</style>