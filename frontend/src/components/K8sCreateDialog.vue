<template>
  <el-dialog
    append-to-body
    v-model="visible"
    :title="title"
    width="80%"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div class="editor-container">
      <div ref="lineNumbers" class="editor-line-numbers">{{ lineNumbersText }}</div>
      <textarea
        ref="textarea"
        v-model="content"
        class="editor-textarea"
        spellcheck="false"
        wrap="off"
        @scroll="onScroll"
      ></textarea>
    </div>
    <div v-if="error" class="yaml-error">{{ error }}</div>
    <template #footer>
      <el-button @click="visible = false">{{ t('common.cancel') || '取消' }}</el-button>
      <el-button type="primary" :loading="saving" @click="onConfirm">{{ t('common.save') || '保存' }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElDialog, ElButton } from 'element-plus'
import { useI18n } from '../i18n'

const props = defineProps<{ modelValue: boolean; title: string; template: string; saving?: boolean; error?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'confirm', yaml: string): void
}>()

const { t } = useI18n()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})
const content = ref(props.template)
const textarea = ref<HTMLTextAreaElement | null>(null)
const lineNumbers = ref<HTMLDivElement | null>(null)

watch(() => props.modelValue, (v) => { if (v) content.value = props.template })

const lineNumbersText = computed(() => {
  const count = (content.value.match(/\n/g) || []).length + 1
  const lines: string[] = []
  for (let i = 1; i <= count; i++) lines.push(String(i))
  return lines.join('\n')
})

function onScroll() {
  if (lineNumbers.value && textarea.value) lineNumbers.value.scrollTop = textarea.value.scrollTop
}

function onConfirm() {
  emit('confirm', content.value)
}
</script>

<style scoped>
/* Line-numbered editor — copied from SFTPTabContent.vue (editor-container/line-numbers/textarea) */
.editor-container {
  display: flex;
  height: 55vh;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  overflow: hidden;
}
.editor-container:focus-within {
  border-color: var(--el-color-primary);
}
.editor-line-numbers {
  flex-shrink: 0;
  min-width: 36px;
  padding: 12px 8px 12px 12px;
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  font-size: 14px;
  line-height: 24px;
  color: var(--text-disabled);
  background: var(--el-fill-color-light);
  text-align: right;
  overflow: hidden;
  user-select: none;
  white-space: pre;
}
.editor-textarea {
  flex: 1;
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace;
  font-size: 14px;
  line-height: 24px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
  border: none;
  padding: 12px;
  white-space: pre;
  overflow-x: auto;
  resize: none;
  outline: none;
  overflow-y: auto;
  tab-size: 2;
}
.yaml-error { color: var(--el-color-danger, #f56); padding: 8px 2px 0; font-size: 12px; }
</style>
