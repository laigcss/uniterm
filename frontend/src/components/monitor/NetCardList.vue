<template>
  <div class="tab-pane network-pane" @contextmenu.prevent="emit('contextmenu', $event)">
    <div class="od-toolbar">
      <el-input v-model="search" :placeholder="t('monitor.searchNetwork')" clearable class="od-search" />
      <el-button :icon="RefreshRight" :loading="loading" @click="emit('refresh')">
        {{ t('monitor.refresh') }}
      </el-button>
    </div>
    <el-table :data="filtered" size="small" border v-loading="loading" height="calc(100% - 2.25rem)" class="od-table">
      <el-table-column prop="name" :label="t('monitor.net.name')" sortable :width="uiPx(120)" />
      <el-table-column prop="state" :label="t('monitor.net.state')" sortable :width="uiPx(90)" />
      <el-table-column prop="mac" :label="t('monitor.net.mac')" sortable :width="uiPx(160)" />
      <el-table-column prop="speed" :label="t('monitor.net.speed')" sortable :width="uiPx(120)" />
      <el-table-column prop="type" :label="t('monitor.net.type')" sortable :width="uiPx(100)" />
      <el-table-column prop="bondMaster" :label="t('monitor.net.bond')" sortable :width="uiPx(120)" />
      <el-table-column prop="ipAddrs" :label="t('monitor.net.ipAddrs')" sortable>
        <template #default="{ row }">{{ row.ipAddrs?.join(', ') || '-' }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import { useI18n } from '../../i18n'
import { uiPx } from '../../utils/uiScale'
import type { NetCardInfo } from './monitorTypes'

const props = defineProps<{
  list: NetCardInfo[]
  loading: boolean
}>()

const emit = defineEmits<{
  refresh: []
  contextmenu: [event: MouseEvent]
}>()

defineOptions({ name: 'NetCardList' })

const { t } = useI18n()
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.list
  return props.list.filter((n: NetCardInfo) =>
    String(n.name).toLowerCase().includes(q) ||
    String(n.mac).toLowerCase().includes(q) ||
    (n.ipAddrs || []).some((ip: string) => ip.toLowerCase().includes(q)) ||
    String(n.bondMaster).toLowerCase().includes(q) ||
    (n.bondSlaves || []).some((s: string) => s.toLowerCase().includes(q))
  )
})
</script>

<style scoped>
.tab-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.network-pane {
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