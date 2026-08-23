<template>
  <div class="type-filter-menu" @click.stop>
    <div class="type-filter-menu-level">
      <div
        class="type-filter-menu-item all"
        :class="{ active: modelValue === 'all' }"
        @click="$emit('update:modelValue', 'all')"
      >
        <el-icon class="check"><span v-if="modelValue === 'all'"><Check :size="12" /></span></el-icon>
        <span class="label">{{ allLabel }}</span>
      </div>

      <!-- Level-1 categories — hovering a category opens its level-2 flyout -->
      <div
        v-for="grp in groups"
        :key="grp.key"
        class="type-filter-menu-grp"
        :class="{ current: isCurrentCat(grp) }"
      >
        <div class="type-filter-menu-item cat">
          <span class="check"></span>
          <span class="cat-label">{{ grp.label }}</span>
          <el-icon class="arrow"><ChevronRight :size="12" /></el-icon>
        </div>

        <!-- Level-2 flyout submenu (shown on hover of the parent category) -->
        <div class="type-filter-menu-sub">
          <div
            v-for="it in grp.items"
            :key="it.key"
            class="type-filter-menu-item sub"
            :class="{ active: modelValue === it.key }"
            @click="$emit('update:modelValue', it.key)"
          >
            <el-icon class="check"><span v-if="modelValue === it.key"><Check :size="12" /></span></el-icon>
            <span class="sub-label">{{ it.label }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Check, ChevronRight } from '@lucide/vue'

interface TypeFilterItem {
  key: string
  label: string
}
interface TypeFilterGroup {
  key: string
  label: string
  items: TypeFilterItem[]
}

const props = defineProps<{
  modelValue: string
  allLabel: string
  groups: TypeFilterGroup[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

// Highlight the category that holds the current selection.
function isCurrentCat(grp: TypeFilterGroup): boolean {
  return props.modelValue !== 'all' && grp.items.some(i => i.key === props.modelValue)
}
</script>

<style scoped>
.type-filter-menu {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 4px;
}
.type-filter-menu-level {
  position: relative;
  min-width: 148px;
}
.type-filter-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 8px;
  font-size: 12px;
  font-family: var(--font-ui);
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  transition: background 0.1s ease;
}
.type-filter-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.type-filter-menu-item.active {
  color: var(--accent);
}
.type-filter-menu-grp.current > .type-filter-menu-item.cat {
  color: var(--accent);
  font-weight: 600;
}
.check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--accent);
}
.label,
.cat-label,
.sub-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.cat-label {
  flex: 1;
  min-width: 0;
}
.arrow {
  color: var(--text-disabled);
  flex-shrink: 0;
}
/* Submenu container sits inside each level-1 row; hidden until hovered */
.type-filter-menu-grp {
  position: relative;
}
.type-filter-menu-sub {
  position: absolute;
  left: calc(100% - 4px);
  top: -4px;
  display: none;
  box-sizing: border-box;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 4px;
  min-width: 130px;
}
/* Standard nested-menu behavior: hovering the parent keeps the flyout open */
.type-filter-menu-grp:hover > .type-filter-menu-item.cat {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.type-filter-menu-grp:hover > .type-filter-menu-sub {
  display: block;
}
.type-filter-menu-item.sub {
  padding: 6px 12px 6px 10px;
}
</style>