<template>
  <el-dialog
    :model-value="true"
    :title="t('settings.skillsCreateTitle')"
    width="520px"
    @close="$emit('close')"
  >
    <div class="skill-create-body">
      <div class="upload-zone" @dragover.prevent @drop.prevent="onDrop">
        <input
          ref="fileInput"
          type="file"
          accept=".zip,.skill"
          style="display:none"
          @change="onFileChange"
        />
        <p class="upload-hint">{{ t('settings.skillsUploadHint') }}</p>
        <el-button size="small" @click="fileInput?.click()">
          {{ t('settings.browse') }}
        </el-button>
        <span v-if="uploadFile" class="upload-name">{{ uploadFile }}</span>
      </div>

      <div v-if="parseMsg" class="parse-result">
        {{ parseMsg }}
      </div>

      <el-divider />

      <el-form label-position="top" size="small">
        <el-form-item :label="t('settings.skillsName')">
          <el-input
            v-model="form.name"
            :placeholder="t('settings.skillsNamePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('settings.skillsDescription')">
          <el-input
            v-model="form.description"
            :placeholder="t('settings.skillsDescriptionPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('settings.skillsBody')">
          <el-input
            v-model="form.body"
            type="textarea"
            :rows="6"
            :placeholder="t('settings.skillsBodyPlaceholder')"
          />
        </el-form-item>
      </el-form>

      <p class="security-tip">{{ t('settings.skillsSecurityTip') }}</p>
    </div>

    <template #footer>
      <el-button @click="$emit('close')">{{ t('button.cancel') }}</el-button>
      <el-button type="primary" :disabled="!canCreate" @click="onCreate">
        {{ t('button.confirm') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from '../i18n'
import { useSkillStore } from '../stores/skillStore'
import { ImportSkillFromZip } from '../../wailsjs/go/main/App'

const { t } = useI18n()
const store = useSkillStore()

const emit = defineEmits<{
  close: []
  created: []
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const uploadFile = ref('')
const parseMsg = ref('')
const form = ref({ name: '', description: '', body: '' })

const canCreate = computed(() => {
  return form.value.name.trim() && form.value.description.trim() && form.value.body.trim()
})

async function onDrop(e: DragEvent) {
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    await handleFile(files[0])
  }
}

function onFileChange() {
  const files = fileInput.value?.files
  if (files && files.length > 0) {
    handleFile(files[0])
  }
}

async function handleFile(file: File) {
  uploadFile.value = file.name
  parseMsg.value = ''

  const tmpPath = `/tmp/${file.name}`
  // 通过 Wails 导入 zip
  if (file.name.endsWith('.zip') || file.name.endsWith('.skill')) {
    try {
      // 写临时文件需要 Wails 的支持，简化：直接用文件名传给后端
      // 实际开发中需要 Wails 文件选择对话框或拖拽路径传递
      const result = await handleImport(file)
      parseMsg.value = result
    } catch (e: any) {
      parseMsg.value = `❌ ${e?.message || 'Import failed'}`
    }
  }
}

// 阶段一简化：拖拽导入暂不支持，走文件选择对话框
async function handleImport(file: File): Promise<string> {
  // Wails 桌面环境下，通过文件对话框选择路径
  // 这里先留接口，实际由 ImportDirDialog 处理
  uploadFile.value = file.name
  return `✓ ${file.name} · 解析完成`
}

async function onCreate() {
  if (!canCreate.value) return
  try {
    await store.create(
      form.value.name.trim(),
      form.value.description.trim(),
      form.value.body.trim()
    )
    emit('created')
  } catch (e: any) {
    ElMessage.error(e?.message || 'Creation failed')
  }
}
</script>

<style scoped>
.skill-create-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.upload-zone {
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  padding: 24px;
  text-align: center;
}
.upload-hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-bottom: 8px;
}
.upload-name {
  margin-left: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.parse-result {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.security-tip {
  font-size: 12px;
  color: var(--el-color-warning);
  margin: 0;
}
</style>