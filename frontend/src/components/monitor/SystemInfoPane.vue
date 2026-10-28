<template>
  <div class="tab-pane system-pane">
    <div v-if="systemInfo" class="system-content">
      <div v-for="group in systemGroups" :key="group.title" class="system-group">
        <div class="system-group-title">{{ group.title }}</div>
        <div class="system-group-items">
          <div v-for="item in group.items" :key="item.label" class="system-row">
            <span class="system-row-label">{{ item.label }}</span>
            <span class="system-row-value" @contextmenu.prevent="emit('contextmenu', $event)">{{ item.value }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="system-loading">{{ t('monitor.loading') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n'
import { formatUptime } from '../../composables/useMonitorData'
import type { SystemInfo } from './monitorTypes'

const props = defineProps<{
  systemInfo: SystemInfo | null
  hostClockText: string
  clockSkewText: string
}>()

const emit = defineEmits<{
  contextmenu: [event: MouseEvent]
}>()

defineOptions({ name: 'SystemInfoPane' })

const { t } = useI18n()

const systemGroups = computed(() => {
  if (!props.systemInfo) return []
  return [
    {
      title: t('monitor.system'),
      items: [
        { label: t('monitor.user'), value: props.systemInfo.user || '' },
        { label: t('companion.uptime'), value: formatUptime(props.systemInfo.uptimeSec) },
        { label: t('monitor.os'), value: props.systemInfo.os || '' },
        { label: t('monitor.version'), value: props.systemInfo.version || '' },
        { label: t('monitor.kernel'), value: props.systemInfo.kernel || '' },
        { label: t('monitor.hostname'), value: props.systemInfo.hostname || '' },
        { label: t('monitor.localIP'), value: props.systemInfo.localIP || '' }
      ].filter(i => i.value)
    },
    {
      title: t('monitor.cpu'),
      items: [
        { label: t('monitor.cpuModel'), value: props.systemInfo.cpuModel || '' },
        { label: t('monitor.cores'), value: String(props.systemInfo.cores || '') },
        { label: t('monitor.arch'), value: props.systemInfo.arch || '' },
        { label: t('monitor.cpuFreq'), value: props.systemInfo.cpuFreq ? props.systemInfo.cpuFreq + ' MHz' : '' },
        { label: t('monitor.memTotal'), value: props.systemInfo.memTotal ? props.systemInfo.memTotal + ' GB' : '' },
        { label: t('monitor.diskTotal'), value: props.systemInfo.diskTotal || '' }
      ].filter(i => i.value)
    },
    {
      title: t('monitor.clock'),
      items: [
        { label: t('monitor.timezone'), value: props.systemInfo.timezone || '' },
        { label: t('monitor.clock'), value: props.hostClockText },
        { label: t('monitor.skew'), value: props.clockSkewText }
      ].filter(i => i.value && i.value !== '-')
    },
    ].filter(g => g.items.length > 0)
})
</script>

<style scoped>
.tab-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
}
.system-pane {
  padding: 1.25rem;
  overflow-y: auto;
}
.system-content {
  max-width: 37.5rem;
}
.system-group {
  margin-bottom: 1.5rem;
}
.system-group-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-ui);
  margin-bottom: 0.5rem;
  padding-bottom: 0.375rem;
  border-bottom: 1px solid var(--border-subtle);
}
.system-group-items {
  display: flex;
  flex-direction: column;
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
.system-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>