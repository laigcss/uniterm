<template>
  <div class="tab-pane disks-pane" @contextmenu.prevent="emit('contextmenu', $event)">
    <div class="od-toolbar">
      <el-input v-model="search" :placeholder="t('monitor.searchDisk')" clearable class="od-search" />
      <el-button :icon="RefreshRight" :loading="loading" @click="emit('refresh')">
        {{ t('monitor.refresh') }}
      </el-button>
    </div>
    <el-table :data="filtered" size="small" border v-loading="loading" height="calc(100% - 2.25rem)" class="od-table">
      <el-table-column prop="name" :label="t('monitor.disk.name')" sortable>
        <template #default="{ row }">
          <span :style="{ paddingLeft: (row.name.match(/^ +/)?.[0].length || 0) * 6 + 'px' }">{{ row.name.trim() }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="type" :label="t('monitor.disk.type')" sortable :width="uiPx(90)" />
      <el-table-column prop="mountPoint" :label="t('monitor.disk.mountPoint')" sortable />
      <el-table-column prop="size" :label="t('monitor.disk.size')" sortable :width="uiPx(100)" />
      <el-table-column prop="used" :label="t('monitor.disk.used')" sortable :width="uiPx(90)" />
      <el-table-column prop="usage" :label="t('monitor.disk.usage')" sortable :width="uiPx(100)">
        <template #default="{ row }">{{ row.usage ? row.usage + '%' : '-' }}</template>
      </el-table-column>
      <el-table-column prop="media" :label="t('monitor.disk.media')" sortable :width="uiPx(80)" />
      <el-table-column prop="fsType" :label="t('monitor.disk.fstype')" sortable :width="uiPx(100)" />
      <el-table-column prop="uuid" :label="t('monitor.disk.uuid')" sortable :width="uiPx(180)" />
      <el-table-column prop="vendor" :label="t('monitor.disk.vendor')" sortable :width="uiPx(120)" />
      <el-table-column prop="model" :label="t('monitor.disk.model')" sortable />
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import { useI18n } from '../../i18n'
import { uiPx } from '../../utils/uiScale'
import type { DiskInfo } from './monitorTypes'

const props = defineProps<{
  list: DiskInfo[]
  loading: boolean
}>()

const emit = defineEmits<{
  refresh: []
  contextmenu: [event: MouseEvent]
}>()

defineOptions({ name: 'DiskList' })

const { t } = useI18n()
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.list
  return props.list.filter((d: DiskInfo) =>
    String(d.name).toLowerCase().includes(q)
  )
})
</script>

<style scoped>
.tab-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.disks-pane {
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