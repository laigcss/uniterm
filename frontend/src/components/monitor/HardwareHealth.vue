<template>
  <div class="tab-pane health-pane" @contextmenu.prevent="emit('contextmenu', $event)">
    <!-- Top: device identity (FRU + IPMI LAN), each card loads and refreshes independently -->
    <div class="health-top">
      <div class="health-cards">
        <div class="health-card">
          <div class="health-card-header">
            <span class="health-card-title">{{ t('monitor.health.fru') }}</span>
            <el-button link :icon="RefreshRight" :loading="loadingFru" @click="emit('refresh-fru')" />
          </div>
          <div class="health-card-body" v-loading="loadingFru">
            <template v-if="fru">
              <div class="info-grid">
                <div class="system-row">
                  <span class="system-row-label">{{ t('monitor.health.product') }}</span>
                  <span class="system-row-value">{{ fru.product || '-' }}</span>
                </div>
                <div class="system-row">
                  <span class="system-row-label">{{ t('monitor.health.manufacturer') }}</span>
                  <span class="system-row-value">{{ fru.manufacturer || '-' }}</span>
                </div>
                <div class="system-row">
                  <span class="system-row-label">{{ t('monitor.health.serial') }}</span>
                  <span class="system-row-value">{{ fru.serial || '-' }}</span>
                </div>
                <div class="system-row">
                  <span class="system-row-label">{{ t('monitor.health.partNumber') }}</span>
                  <span class="system-row-value">{{ fru.partNumber || '-' }}</span>
                </div>
              </div>
            </template>
            <div v-else-if="!loadingFru" class="health-hint">{{ t('monitor.health.noIpmi') }}</div>
          </div>
        </div>
        <div class="health-card">
          <div class="health-card-header">
            <span class="health-card-title">{{ t('monitor.health.lan') }}</span>
            <el-button link :icon="RefreshRight" :loading="loadingLan" @click="emit('refresh-lan')" />
          </div>
          <div class="health-card-body" v-loading="loadingLan">
            <div v-if="lan.length" class="info-grid">
              <div v-for="f in lan" :key="f.key" class="system-row">
                <span class="system-row-label">{{ f.key }}</span>
                <span class="system-row-value">{{ f.value }}</span>
              </div>
            </div>
            <div v-else-if="!loadingLan" class="health-hint">{{ t('monitor.health.noIpmi') }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom: sensors, loads and refreshes independently -->
    <div class="health-bottom">
      <div class="health-card-header">
        <span class="health-card-title">{{ t('monitor.health.sensors') }}</span>
        <div class="health-card-actions">
          <el-input v-model="sensorSearch" :placeholder="t('monitor.searchSensor')" clearable class="health-search" />
          <el-button link :icon="RefreshRight" :loading="loadingSensors" @click="emit('refresh-sensors')" />
        </div>
      </div>
      <div v-if="sensors && !sensors.hasIpmi" class="health-hint health-bottom-hint">
        {{ t('monitor.health.noIpmi') }}
      </div>
      <el-table v-if="sensors && sensors.sensors.length" :data="filteredSensors" size="small" border v-loading="loadingSensors" height="calc(100% - 2.25rem)" class="od-table health-table">
        <el-table-column prop="name" :label="t('monitor.health.name')" sortable :min-width="uiPx(160)" />
        <el-table-column prop="value" :label="t('monitor.health.value')" :min-width="uiPx(140)" />
        <el-table-column prop="unit" :label="t('monitor.health.unit')" :width="uiPx(110)">
          <template #default="{ row }">{{ row.unit || '-' }}</template>
        </el-table-column>
        <el-table-column prop="status" :label="t('monitor.health.status')" :width="uiPx(110)">
          <template #default="{ row }">
            <span class="svc-state" :class="sensorStatusClass(row.status)">{{ row.status }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="source" :label="t('monitor.health.source')" :width="uiPx(110)" />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import { useI18n } from '../../i18n'
import { uiPx } from '../../utils/uiScale'
import type { FruInfo, LanInfo, HardwareSensors, SensorInfo } from './monitorTypes'

const props = defineProps<{
  fru: FruInfo | null
  lan: LanInfo[]
  sensors: HardwareSensors | null
  loadingFru: boolean
  loadingLan: boolean
  loadingSensors: boolean
}>()

const emit = defineEmits<{
  'refresh-fru': []
  'refresh-lan': []
  'refresh-sensors': []
  contextmenu: [event: MouseEvent]
}>()

defineOptions({ name: 'HardwareHealth' })

const { t } = useI18n()
const sensorSearch = ref('')

const filteredSensors = computed(() => {
  const list = props.sensors?.sensors || []
  const q = sensorSearch.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((s: SensorInfo) =>
    String(s.name).toLowerCase().includes(q) ||
    String(s.value).toLowerCase().includes(q) ||
    String(s.source).toLowerCase().includes(q)
  )
})

function sensorStatusClass(status: string) {
  const s = String(status || '').toLowerCase()
  if (s === 'ok') return 'state-ok'
  if (s === 'nc' || s === 'cr' || s === 'nr' || s.includes('alarm')) return 'state-bad'
  return 'state-idle'
}
</script>

<style scoped>
.tab-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.health-pane {
  flex-direction: column;
  padding: 0;
}
.svc-state {
  font-variant-numeric: tabular-nums;
}
.svc-state.state-ok {
  color: var(--success);
}
.svc-state.state-bad {
  color: var(--error);
}
.svc-state.state-idle {
  color: var(--text-muted);
}
.health-top {
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.health-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  padding: 0 0.75rem;
}
.health-card {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.health-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  flex-shrink: 0;
}
.health-card-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}
.health-card-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.health-search {
  width: 11.25rem;
}
.health-card-body {
  padding: 0 0.75rem 0.625rem;
  min-height: 1.5rem;
}
.health-bottom {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.health-bottom-hint {
  padding: 0 0.75rem 0.75rem;
}
/* Single-column label/value grid for FRU and IPMI LAN blocks */
.info-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}
.system-row {
  display: flex;
  align-items: baseline;
  padding: 0.5rem 0;
  gap: 2.5rem;
  border-bottom: 1px solid var(--border-subtle);
}
.system-row:last-child {
  border-bottom: none;
}
.system-row-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: var(--font-ui);
  flex-shrink: 0;
  width: 7.5rem;
  min-width: 7.5rem;
}
.system-row-value {
  font-size: 0.8125rem;
  color: var(--text-primary);
  font-family: var(--font-mono);
  word-break: break-all;
  text-align: left;
  flex: 1;
  user-select: text;
}
.health-table {
  flex: 1;
}
.health-hint {
  flex: 1;
  color: var(--text-muted);
  font-size: 0.75rem;
}
.od-table {
  flex: 1;
  min-height: 0;
}
.od-table :deep(.cell) {
  user-select: text;
}
</style>