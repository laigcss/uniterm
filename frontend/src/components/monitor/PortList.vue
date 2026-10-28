<template>
  <div class="tab-pane ports-pane" @contextmenu.prevent="emit('contextmenu', $event)">
    <div class="od-toolbar">
      <el-input v-model="search" :placeholder="t('monitor.searchPort')" clearable class="od-search" />
      <el-button :icon="RefreshRight" :loading="loading" @click="emit('refresh')">
        {{ t('monitor.refresh') }}
      </el-button>
    </div>
    <el-table :data="filtered" size="small" border v-loading="loading" height="calc(100% - 2.25rem)" class="od-table">
      <el-table-column prop="protocol" :label="t('monitor.port.protocol')" sortable :width="uiPx(90)" />
      <el-table-column prop="localAddr" :label="t('monitor.port.localAddr')" sortable :width="uiPx(160)" />
      <el-table-column prop="process" :label="t('monitor.port.process')" sortable />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import { useI18n } from '../../i18n'
import { uiPx } from '../../utils/uiScale'
import type { PortInfo } from './monitorTypes'

const props = defineProps<{
  list: PortInfo[]
  loading: boolean
}>()

const emit = defineEmits<{
  refresh: []
  contextmenu: [event: MouseEvent]
}>()

defineOptions({ name: 'PortList' })

const { t } = useI18n()
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.list
  return props.list.filter((p: PortInfo) =>
    String(p.localAddr).toLowerCase().includes(q) ||
    String(p.process).toLowerCase().includes(q)
  )
})
</script>

<style scoped>
.tab-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.ports-pane {
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