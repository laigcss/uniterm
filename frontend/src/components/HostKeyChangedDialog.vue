<template>
  <el-dialog append-to-body
    :model-value="visible"
    @update:model-value="(v: boolean) => !v && onReject()"
    :title="t('hostKey.title')"
    width="560px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="hk-body">
      <el-alert type="warning" :closable="false" show-icon class="hk-alert">
        <template #title>{{ t('hostKey.warning') }}</template>
        <div class="hk-alert-desc">{{ t('hostKey.warningDesc') }}</div>
      </el-alert>

      <div class="hk-row">
        <span class="hk-label">{{ t('hostKey.host') }}</span>
        <span class="hk-value">{{ hostLabel }}</span>
      </div>
      <div class="hk-row">
        <span class="hk-label">{{ t('hostKey.keyType') }}</span>
        <span class="hk-value">{{ payload?.keyType || '—' }}</span>
      </div>
      <div class="hk-row">
        <span class="hk-label">{{ t('hostKey.oldFp') }}</span>
        <code class="hk-fp">{{ payload?.oldFp || '—' }}</code>
      </div>
      <div class="hk-row">
        <span class="hk-label">{{ t('hostKey.newFp') }}</span>
        <code class="hk-fp">{{ payload?.newFp || '—' }}</code>
      </div>

      <p class="hk-hint">{{ t('hostKey.hint') }}</p>
    </div>

    <template #footer>
      <el-button @click="onReject">{{ t('hostKey.reject') }}</el-button>
      <el-button type="danger" @click="onAccept">{{ t('hostKey.accept') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../i18n'
import { AcceptHostKeyChange } from '../../bindings/github.com/ys-ll/uniterm/app'
import { msg } from '../services/message'

// Payload emitted by the backend on `session:hostkey-changed`. Mirrors the
// Go session.HostKeyChangedError JSON tags (S1).
export interface HostKeyChangedPayload {
  host: string
  port: string
  keyType: string
  oldFp: string
  newFp: string
  oldKeyB64: string
  newKeyB64: string
}

const props = defineProps<{
  visible: boolean
  payload: HostKeyChangedPayload | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'accepted', payload: HostKeyChangedPayload): void
  (e: 'rejected', payload: HostKeyChangedPayload): void
}>()

const { t } = useI18n()

const hostLabel = computed(() => {
  const p = props.payload
  if (!p) return '—'
  return p.port && p.port !== '22' ? `${p.host}:${p.port}` : p.host
})

function close() {
  emit('update:visible', false)
}

async function onAccept() {
  const p = props.payload
  if (!p) {
    close()
    return
  }
  try {
    await AcceptHostKeyChange(p.host, p.port, p.keyType, p.newKeyB64)
    msg.success(t('hostKey.accepted'))
    emit('accepted', p)
  } catch (err) {
    msg.error(t('hostKey.acceptFailed') + ': ' + String(err))
    // Keep the dialog open so the user can retry or reject.
    return
  }
  close()
}

function onReject() {
  const p = props.payload
  close()
  if (p) emit('rejected', p)
}
</script>

<style scoped>
.hk-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hk-alert {
  margin-bottom: 4px;
}
.hk-alert-desc {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
}
.hk-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 13px;
}
.hk-label {
  flex: 0 0 96px;
  color: var(--el-text-color-secondary);
}
.hk-value {
  color: var(--el-text-color-primary);
  word-break: break-all;
}
.hk-fp {
  flex: 1;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  padding: 4px 8px;
  border-radius: 4px;
  word-break: break-all;
}
.hk-hint {
  margin: 4px 0 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
</style>