<template>
  <el-dialog append-to-body
    :model-value="visible"
    @update:model-value="(v: boolean) => !v && onCancel()"
    :title="t('importExport.exportTitle')"
    width="440px"
  >
    <el-form label-width="100px">
      <el-form-item :label="t('importExport.includePassword')">
        <el-radio-group v-model="includePassword">
          <el-radio :value="false">{{ t('importExport.no') }}</el-radio>
          <el-radio :value="true">{{ t('importExport.yes') }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <template v-if="includePassword">
        <el-form-item :label="t('importExport.configPassword')">
          <el-input v-model="password" type="password" show-password />
        </el-form-item>
        <el-form-item :label="t('importExport.confirmPassword')">
          <el-input v-model="confirmPassword" type="password" show-password />
        </el-form-item>
      </template>
    </el-form>
    <template #footer>
      <el-button @click="onCancel">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="exporting" @click="onExport">{{ t('importExport.export') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '../i18n'
import { msg } from '../services/message'
import { ExportConnections, SaveFileDialogFiltered } from '../../wailsjs/go/main/App'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void; (e: 'done'): void }>()

const { t } = useI18n()
const includePassword = ref(false)
const password = ref('')
const confirmPassword = ref('')
const exporting = ref(false)

watch(() => props.visible, (v) => {
  if (v) { includePassword.value = false; password.value = ''; confirmPassword.value = '' }
})

function onCancel() { emit('update:visible', false) }

async function onExport() {
  if (includePassword.value) {
    if (!password.value) { msg.error(t('importExport.configPassword')); return }
    if (password.value !== confirmPassword.value) { msg.error(t('importExport.passwordMismatch')); return }
  }
  const dest = await SaveFileDialogFiltered(t('importExport.exportTitle'), 'uniterm-connections.utm', 'uniTerm (*.utm)', '*.utm')
  if (!dest) return
  exporting.value = true
  try {
    await ExportConnections(dest, includePassword.value ? password.value : '')
    msg.success(t('importExport.exported'))
    emit('done')
    emit('update:visible', false)
  } catch (e: any) {
    msg.error(e?.message || String(e))
  } finally {
    exporting.value = false
  }
}
</script>
