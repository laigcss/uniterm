<template>
  <div>
    <!-- Process Detail Panel (inside monitor-tab) -->
    <div class="detail-drawer-backdrop" :class="{ open: visible }" @click="emit('update:visible', false)"></div>
    <div class="detail-drawer" :class="{ open: visible }">
      <div class="detail-drawer-header">
        <span class="detail-drawer-title">{{ t('monitor.processDetail') }}</span>
        <el-button link @click="emit('update:visible', false)">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
      <div v-if="processDetail" class="process-detail">
        <div class="detail-section" @contextmenu="onSectionContextMenu">
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.pid') }}</span>
            <span class="detail-value">{{ processDetail.pid }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.ppid') }}</span>
            <span class="detail-value">{{ processDetail.ppid ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.processName') }}</span>
            <span class="detail-value">{{ processDetail.name ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.state') }}</span>
            <span class="detail-value">{{ processDetail.state ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.threads') }}</span>
            <span class="detail-value">{{ processDetail.threads ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.exe') }}</span>
            <span class="detail-value">{{ processDetail.exe ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.cwd') }}</span>
            <span class="detail-value">{{ processDetail.cwd ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.cmdline') }}</span>
            <span class="detail-value cmdline">{{ processDetail.cmdline ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.startTime') }}</span>
            <span class="detail-value">{{ processDetail.startTime ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.fd') }}</span>
            <div class="detail-value io-stats" v-if="processDetail.fd">
              <div>{{ t('monitor.detail.fdTotal') }}: {{ processDetail.fd.total ?? 0 }}</div>
              <div>{{ t('monitor.detail.fdFiles') }}: {{ processDetail.fd.files ?? 0 }}</div>
              <div>{{ t('monitor.detail.fdSockets') }}: {{ processDetail.fd.sockets ?? 0 }}</div>
              <div>{{ t('monitor.detail.fdPipes') }}: {{ processDetail.fd.pipes ?? 0 }}</div>
              <div>{{ t('monitor.detail.fdAnons') }}: {{ processDetail.fd.anons ?? 0 }}</div>
              <div>{{ t('monitor.detail.fdDevs') }}: {{ processDetail.fd.devs ?? 0 }}</div>
              <div>{{ t('monitor.detail.fdOthers') }}: {{ processDetail.fd.others ?? 0 }}</div>
            </div>
            <span class="detail-value" v-else>-</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.vmRss') }}</span>
            <span class="detail-value">{{ processDetail.vmRss ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.vmSize') }}</span>
            <span class="detail-value">{{ processDetail.vmSize ?? '-' }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.cpuTicks') }}</span>
            <span class="detail-value">{{ processDetail.cpuTicks ?? '-' }}</span>
          </div>
          <div v-if="processDetail.voluntaryCtxSwitches != null || processDetail.nonvoluntaryCtxSwitches != null" class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.ctxSwitches') }}</span>
            <span class="detail-value">
              vol: {{ processDetail.voluntaryCtxSwitches ?? 0 }} / nonvol: {{ processDetail.nonvoluntaryCtxSwitches ?? 0 }}
            </span>
          </div>
          <div v-if="processDetail.io" class="detail-row">
            <span class="detail-label">{{ t('monitor.detail.io') }}</span>
            <div class="detail-value io-stats">
              <div>rchar: {{ formatIo(processDetail.io.rchar) }}</div>
              <div>wchar: {{ formatIo(processDetail.io.wchar) }}</div>
              <div>read_bytes: {{ formatIo(processDetail.io.read_bytes) }}</div>
              <div>write_bytes: {{ formatIo(processDetail.io.write_bytes) }}</div>
            </div>
          </div>
        </div>
        <div class="detail-actions">
          <el-button @click="emit('update:visible', false)">{{ t('common.cancel') }}</el-button>
        </div>
      </div>
      <div v-else class="process-detail-empty">{{ t('monitor.noProcessSelected') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Close } from '@element-plus/icons-vue'
import { useI18n } from '../../i18n'
import { formatBytes } from '../../utils/format'
import type { ProcessDetail } from './monitorTypes'

defineProps<{
  visible: boolean
  processDetail: ProcessDetail | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  contextmenu: [event: MouseEvent]
}>()

defineOptions({ name: 'ProcessDetailDrawer' })

const { t } = useI18n()

function formatIo(val: number | undefined): string {
  if (val == null) return '-'
  return formatBytes(val)
}

function onSectionContextMenu(e: MouseEvent) {
  const target = e.target as HTMLElement
  const detailValue = target.closest('.detail-value') as HTMLElement | null
  if (detailValue) {
    emit('contextmenu', e)
  }
}
</script>

<style scoped>
/* Process detail drawer */
.process-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.process-detail .detail-section {
  flex: 1;
  overflow-y: auto;
  padding: 0 1rem;
}
.process-detail .detail-row {
  display: flex;
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--border-subtle);
  gap: 0.75rem;
}
.process-detail .detail-row:last-child {
  border-bottom: none;
}
.process-detail .detail-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: var(--font-ui);
  flex-shrink: 0;
  width: 6.25rem;
  min-width: 6.25rem;
}
.process-detail .detail-value {
  font-size: 0.8125rem;
  color: var(--text-primary);
  font-family: var(--font-mono);
  word-break: break-all;
  flex: 1;
  user-select: text;
}
.process-detail .detail-value.cmdline {
  white-space: pre-wrap;
  line-height: 1.5;
}
.process-detail .io-stats {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.process-detail .detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border-subtle);
  margin-top: 0.75rem;
}
.process-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 0.875rem;
}
/* Detail drawer (inside monitor-tab) */
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
  width: 26.25rem;
  max-width: 100%;
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
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.detail-drawer-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-ui);
}
</style>