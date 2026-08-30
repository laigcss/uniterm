<template>
  <el-dialog
    append-to-body
    :model-value="visible"
    :title="t('sftp.dialog.conflictTitle')"
    width="450px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <p>{{ t('sftp.dialog.conflictPrompt') }}</p>
    <ul class="conflict-list">
      <li v-for="f in files" :key="f">{{ f }}</li>
    </ul>
    <template #footer>
      <el-button @click="emit('resolve', 'cancel')">{{ t('sftp.dialog.cancel') }}</el-button>
      <el-button @click="emit('resolve', 'overwrite')">{{ t('sftp.dialog.conflictOverwrite') }}</el-button>
      <el-button type="primary" @click="emit('resolve', 'rename')">{{ t('sftp.dialog.conflictRename') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { useI18n } from '../i18n'

const { t } = useI18n()

defineProps<{
  visible?: boolean
  files?: string[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'resolve', action: 'overwrite' | 'rename' | 'cancel'): void
}>()
</script>

<style scoped>
.conflict-list {
  max-height: 180px;
  overflow-y: auto;
  margin: 8px 0 4px;
  padding-left: 20px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text-secondary);
}
</style>