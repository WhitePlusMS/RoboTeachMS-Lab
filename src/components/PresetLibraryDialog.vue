<script setup lang="ts">
import { computed, ref } from 'vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { RAPID_PRESET_PROGRAMS, type RapidPresetProgram } from '@/application/preset-programs.ts'

interface Props {
  /** 是否显示全屏预设库。 */
  open: boolean
  /** 当前源码相对加载基线是否已被修改；影响确认文案与提示。 */
  sourceEdited: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  load: [preset: RapidPresetProgram]
}>()

/** 等待确认替换的预设；null 表示未选择。 */
const pendingPreset = ref<RapidPresetProgram | null>(null)

const confirmTitle = computed(() => '加载预设程序')
const confirmMessage = computed(() => {
  const preset = pendingPreset.value
  if (!preset) return ''
  if (props.sourceEdited) {
    return `当前源码已修改。确定用「${preset.name}」替换并覆盖现有内容吗？`
  }
  return `确定用「${preset.name}」作为 RAPID 示例模板载入吗？`
})

function close(): void {
  emit('update:open', false)
}

function onBackdrop(event: Event): void {
  if (event.target === event.currentTarget) close()
}

function requestLoad(preset: RapidPresetProgram): void {
  pendingPreset.value = preset
}

function confirmLoad(): void {
  const preset = pendingPreset.value
  if (!preset) return
  emit('load', preset)
  pendingPreset.value = null
  close()
}

function cancelLoad(): void {
  pendingPreset.value = null
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="lib-overlay" @click.self="onBackdrop">
      <div class="lib-panel" role="dialog" aria-modal="true" aria-label="预设程序库">
        <header class="lib-head">
          <div>
            <div class="lib-kicker">RAPID TEMPLATES</div>
            <h3 class="lib-title">预设程序库</h3>
          </div>
          <button type="button" class="lib-close" aria-label="关闭" @click="close">✕</button>
        </header>

        <p class="lib-intro">从测试用例集中选择一个可运行示例模板载入源码编辑器。</p>

        <ul class="lib-list">
          <li v-for="preset in RAPID_PRESET_PROGRAMS" :key="preset.id" class="lib-item">
            <div class="lib-item-main">
              <div class="lib-item-name">{{ preset.name }}</div>
              <div class="lib-item-desc">{{ preset.description }}</div>
            </div>
            <button type="button" class="preset-btn" @click="requestLoad(preset)">使用</button>
          </li>
        </ul>

        <ConfirmDialog
          :open="pendingPreset !== null"
          :title="confirmTitle"
          :message="confirmMessage"
          confirm-text="替换"
          cancel-text="取消"
          :danger="false"
          @confirm="confirmLoad"
          @cancel="cancelLoad"
          @update:open="pendingPreset = null"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lib-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: grid;
  place-items: center;
  padding: 28px;
  background: rgba(5, 6, 8, 0.66);
  backdrop-filter: blur(2px);
}

.lib-panel {
  display: flex;
  flex-direction: column;
  width: min(680px, 94vw);
  max-height: 86vh;
  overflow: hidden;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  background: var(--color-surface-deep);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.lib-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
}

.lib-kicker {
  color: var(--color-text-dim);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.lib-title {
  margin: 2px 0 0;
  color: var(--color-text-strong);
  font-size: 17px;
  font-weight: 700;
}

.lib-close {
  padding: 2px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-faint);
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1.4;
}

.lib-close:hover {
  color: var(--color-text);
  background: var(--color-surface-hover);
}

.lib-intro {
  margin: 0;
  padding: 10px 18px 2px;
  color: var(--color-text-faint);
  font-size: 12px;
  line-height: 1.5;
}

.lib-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 8px 18px 16px;
  list-style: none;
}

.lib-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 12px 12px 14px;
  border-bottom: 1px solid var(--color-border);
}

.lib-item:last-child {
  border-bottom: 0;
}

.lib-item:hover {
  background: var(--color-surface-hover);
  border-radius: var(--radius-sm);
}

.lib-item-main {
  flex: 1 1 auto;
  min-width: 0;
}

.lib-item-name {
  color: var(--color-text-strong);
  font-size: 13.5px;
  font-weight: 600;
}

.lib-item-desc {
  margin-top: 2px;
  color: var(--color-text-faint);
  font-size: 12px;
  line-height: 1.4;
}

.preset-btn {
  padding: 7px 16px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 13px;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.preset-btn:hover {
  border-color: var(--color-brand);
  color: var(--color-brand-soft);
  background: var(--color-brand-dim);
}
</style>
