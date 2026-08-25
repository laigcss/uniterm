<template>
  <el-dialog
    append-to-body
    :model-value="visible"
    :title="identity ? t('settings.editIdentity') : t('settings.addIdentity')"
    width="480px"
    @update:model-value="v => emit('update:visible', v)"
  >
    <el-form label-width="90px">
      <el-form-item :label="t('conn.name')">
        <el-input v-model="form.name" :placeholder="t('conn.namePlaceholder')" />
      </el-form-item>
      <el-form-item :label="t('conn.authType')">
        <el-radio-group v-model="form.authType">
          <el-radio-button label="password">{{ t('conn.password') }}</el-radio-button>
          <el-radio-button label="key">{{ t('conn.keyPath') }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="t('conn.user')">
        <el-input v-model="form.username" />
      </el-form-item>
      <el-form-item v-if="form.authType === 'password'" :label="t('conn.password')">
        <el-input v-model="passwordInput" type="password" show-password />
      </el-form-item>
      <template v-else>
        <el-form-item :label="t('conn.keyPath')">
          <el-input v-model="form.keyPath" :placeholder="t('conn.keyPathPlaceholder')">
            <template #append>
              <el-tooltip :content="t('conn.selectKeyFile')" placement="top">
                <el-button :aria-label="t('conn.selectKeyFile')" @click="selectKeyFile">
                  <el-icon><FolderOpen :size="16" /></el-icon>
                </el-button>
              </el-tooltip>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item :label="t('conn.keyPassphrase')">
          <el-input v-model="passphraseInput" type="password" show-password :placeholder="t('conn.keyPassphrasePlaceholder')" />
        </el-form-item>
      </template>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" @click="save">{{ t('common.save') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { useI18n } from '../i18n'
import { ElMessage } from 'element-plus'
import { OpenFileDialog } from '../../bindings/github.com/ys-ll/uniterm/app'
import { FolderOpen } from '@lucide/vue'
import { useIdentityStore } from '../stores/identityStore'
import type { Identity } from '../types/identity'

const props = defineProps<{ visible: boolean; identity: Identity | null }>()
// `saved` carries the persisted entity so callers (e.g. the connection form's
// "+" button) can select the just-created item. Settings' handler ignores it.
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void; (e: 'saved', entity: Identity): void }>()
const { t } = useI18n()
const store = useIdentityStore()

function newId(): string {
  // crypto.randomUUID() may be unavailable in the Wails/webview runtime, so
  // fall back to the same timestamp+random scheme used for connection IDs.
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const form = reactive<Identity>({ id: '', name: '', username: '', authType: 'password', password: '', keyPath: '' })

// The persisted Identity carries a single `password` field that doubles as the
// login password (authType "password") and the private-key passphrase
// (authType "key"). Binding both inputs to it made them move together, so each
// mode gets its own local state and only the active one is written on save.
const passwordInput = ref('')
const passphraseInput = ref('')

watch(() => props.visible, (v) => {
  if (v) {
    Object.assign(form, props.identity ?? { id: newId(), name: '', username: '', authType: 'password', password: '', keyPath: '' })
    // Hydrate only the field matching the stored authType; the other mode
    // starts empty rather than echoing an unrelated secret.
    passwordInput.value = form.authType === 'password' ? (form.password ?? '') : ''
    passphraseInput.value = form.authType === 'key' ? (form.password ?? '') : ''
  }
})

async function selectKeyFile() {
  try {
    const p = await OpenFileDialog()
    if (p) form.keyPath = p
  } catch (e) { console.error('select key file:', e) }
}

async function save() {
  if (!form.name.trim()) { ElMessage.warning(t('settings.identityNameRequired')); return }
  const entity: Identity = {
    ...form,
    password: form.authType === 'key' ? passphraseInput.value : passwordInput.value,
  }
  if (props.identity) await store.update(entity)
  else await store.add(entity)
  ElMessage.success(t('settings.saved'))
  emit('saved', entity)
  emit('update:visible', false)
}
</script>
