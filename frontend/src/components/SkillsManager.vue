<template>
  <div class="skills-manager">
    <div class="skills-toolbar">
      <el-input
        v-model="searchQuery"
        size="small"
        :placeholder="t('settings.skillsSearch')"
        style="flex: 1"
        clearable
      >
        <template #prefix><el-icon :size="14"><Search /></el-icon></template>
      </el-input>
      <el-button size="small" @click="showCreate = true">
        <Plus :size="14" /> {{ t('settings.skillsCreate') }}
      </el-button>
    </div>

    <div v-if="filteredSkills.length === 0" class="skills-empty">
      {{ t('settings.skillsNoSkill') }}
    </div>

    <div
      v-for="skill in filteredSkills"
      :key="skill.name"
      class="skill-card"
      @click="openEdit(skill)"
    >
      <BookOpen :size="18" class="skill-card-icon" />
      <div class="skill-card-info">
        <div class="skill-card-title">
          <span class="skill-card-name">{{ skill.name }}</span>
        </div>
        <div class="skill-card-desc">{{ skill.description }}</div>
      </div>
      <div class="skill-card-actions" @click.stop>
        <el-switch
          :model-value="skill.enabled"
          size="small"
          @change="store.toggleEnabled(skill.name)"
        />
        <el-button
          link
          :title="skill.locked ? t('settings.skillsLocked') : t('settings.skillsUnlocked')"
          @click="store.toggleLocked(skill.name)"
        >
          <el-icon :size="15"><Lock v-if="skill.locked" /><LockOpen v-else /></el-icon>
        </el-button>
        <el-dropdown trigger="click" @command="(cmd: string) => handleCmd(cmd, skill)">
          <el-button link>
            <el-icon :size="15"><Settings2 /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="edit">{{ t('settings.skillsEdit') }}</el-dropdown-item>
              <el-dropdown-item command="delete" divided>
                <span style="color: var(--el-color-danger)">{{ t('settings.skillsDelete') }}</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <SkillCreateDialog
      v-if="showCreate"
      @close="showCreate = false"
      @created="onCreated"
    />

    <!-- 编辑弹窗（锁定则只读 + 提示解锁） -->
    <el-dialog
      v-model="showEdit"
      :title="editSkill?.name"
      width="600px"
    >
      <div v-if="editSkill" class="skill-edit">
        <el-alert
          v-if="editSkill.locked"
          :title="t('settings.skillsEditLocked')"
          type="info"
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
        />
        <el-form label-position="right" label-width="60px" size="small">
          <el-form-item :label="t('settings.skillsDescription')">
            <el-input
              v-model="editForm.description"
              type="textarea"
              :rows="2"
              :disabled="editSkill.locked"
            />
          </el-form-item>
          <el-form-item :label="t('settings.skillsBody')">
            <el-input
              v-model="editForm.body"
              type="textarea"
              :rows="12"
              :disabled="editSkill.locked"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="showEdit = false">{{ t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          :disabled="editSkill?.locked || !editForm.description.trim() || !editForm.body.trim()"
          @click="onSaveEdit"
        >
          {{ t('common.save') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Plus, Lock, LockOpen, Settings2, Search, BookOpen } from '@lucide/vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from '../i18n'
import { useSkillStore } from '../stores/skillStore'
import SkillCreateDialog from './SkillCreateDialog.vue'
import type { SkillMeta } from '../types/skill'

const { t } = useI18n()
const store = useSkillStore()

const showCreate = ref(false)
const searchQuery = ref('')

const showEdit = ref(false)
const editSkill = ref<SkillMeta | null>(null)
const editForm = ref({ description: '', body: '' })

const filteredSkills = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return store.skills
  return store.skills.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
})

async function openEdit(skill: SkillMeta) {
  editSkill.value = skill
  editForm.value = { description: skill.description, body: '' }
  showEdit.value = true
  try {
    editForm.value.body = await store.getBody(skill.name)
  } catch (e) {
    editForm.value.body = ''
  }
}

async function onSaveEdit() {
  if (!editSkill.value) return
  try {
    await store.save(editSkill.value.name, editForm.value.description.trim(), editForm.value.body.trim())
    showEdit.value = false
  } catch (e: any) {
    ElMessage.error(e?.message || 'Save failed')
  }
}

function handleCmd(cmd: string, skill: SkillMeta) {
  if (cmd === 'delete') onDelete(skill)
  else if (cmd === 'edit') openEdit(skill)
}

async function onDelete(skill: SkillMeta) {
  if (skill.locked) {
    ElMessage.warning(t('settings.skillsDeleteLocked', { name: skill.name }))
    return
  }
  try {
    await ElMessageBox.confirm(
      t('settings.skillsDeleteConfirm', { name: skill.name }),
      t('settings.skillsDelete')
    )
    await store.remove(skill.name)
  } catch {
    // cancelled
  }
}

function onCreated() {
  showCreate.value = false
  store.reload()
}

onMounted(() => {
  store.load()
})
</script>

<style scoped>
.skills-manager {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skills-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.skills-empty {
  color: var(--el-text-color-secondary);
  padding: 32px 0;
  text-align: center;
}
.skill-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.skill-card:hover {
  border-color: var(--el-color-primary);
}
.skill-card-icon {
  color: var(--el-color-primary);
  flex-shrink: 0;
}
.skill-card-info {
  flex: 1;
  min-width: 0;
}
.skill-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.skill-card-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--el-text-color-primary);
}
.skill-card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  margin-top: 2px;
}
.skill-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
</style>