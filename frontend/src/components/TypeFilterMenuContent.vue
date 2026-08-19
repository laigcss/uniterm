<template>
  <div class="ttfm" @click.stop>
    <div class="ttfm-level">
      <div
        class="ttfm-item all"
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
        class="ttfm-grp"
        :class="{ current: isCurrentCat(grp) }"
      >
        <div class="ttfm-item cat">
          <span class="check"></span>
          <span class="cat-label">{{ grp.label }}</span>
          <el-icon class="arrow"><ChevronRight :size="12" /></el-icon>
        </div>

        <!-- Level-2 flyout submenu (shown on hover of the parent category) -->
        <div class="ttfm-sub">
          <div
            v-for="it in grp.items"
            :key="it.key"
            class="ttfm-item sub"
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
.ttfm {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 4px;
}
.ttfm-level {
  position: relative;
  min-width: 148px;
}
.ttfm-item {
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
.ttfm-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.ttfm-item.active {
  color: var(--accent);
}
.ttfm-grp.current > .ttfm-item.cat {
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
.ttfm-grp {
  position: relative;
}
.ttfm-sub {
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
.ttfm-grp:hover > .ttfm-item.cat {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.ttfm-grp:hover > .ttfm-sub {
  display: block;
}
.ttfm-item.sub {
  padding: 6px 12px 6px 10px;
}
</style>