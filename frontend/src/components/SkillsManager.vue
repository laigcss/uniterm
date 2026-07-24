<template>
  <div class="settings-group">
    <div class="skills-toolbar">
      <el-select v-model="filterOrigin" size="small" style="width: 120px">
        <el-option :label="t('settings.skillsFilterAll')" value="all" />
        <el-option :label="t('settings.skillsFilterCreated')" value="created" />
        <el-option :label="t('settings.skillsFilterImported')" value="imported" />
      </el-select>
      <el-input
        v-model="searchQuery"
        size="small"
        :placeholder="t('settings.search')"
        style="width: 200px"
        clearable
      />
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
      class="model-card"
    >
      <div class="model-main">
        <el-switch
          :model-value="skill.enabled"
          size="small"
          @change="store.toggleEnabled(skill.name)"
        />
        <span class="model-name">{{ skill.name }}</span>
        <el-tag size="small" :type="skill.origin === 'created' ? '' : 'info'">
          {{ skill.origin === 'created' ? t('settings.skillsOriginCreated') : t('settings.skillsOriginImported') }}
        </el-tag>
        <span class="skill-detail">/{{ skill.name }} · {{ skill.description }}</span>
      </div>
      <div class="model-actions">
        <el-button
          link
          :title="skill.locked ? t('settings.skillsLocked') : t('settings.skillsUnlocked')"
          @click="store.toggleLocked(skill.name)"
        >
          <el-icon :size="14"><Lock v-if="skill.locked" /><LockOpen v-else /></el-icon>
        </el-button>
        <el-dropdown trigger="click" @command="(cmd: string) => handleCmd(cmd, skill)">
          <el-button link>
            <el-icon :size="14"><Settings2 /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="delete">
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Plus, Lock, LockOpen, Settings2 } from '@lucide/vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from '../i18n'
import { useSkillStore } from '../stores/skillStore'
import SkillCreateDialog from './SkillCreateDialog.vue'
import type { SkillMeta } from '../types/skill'

const { t } = useI18n()
const store = useSkillStore()

const showCreate = ref(false)
const filterOrigin = ref('all')
const searchQuery = ref('')

const filteredSkills = computed(() => {
  let list = store.skills
  if (filterOrigin.value !== 'all') {
    list = list.filter(s => s.origin === filterOrigin.value)
  }
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  }
  return list
})

function handleCmd(cmd: string, skill: SkillMeta) {
  if (cmd === 'delete') {
    onDelete(skill)
  }
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
.skills-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.skills-empty {
  color: var(--el-text-color-secondary);
  padding: 24px 0;
  text-align: center;
}
.skill-detail {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>