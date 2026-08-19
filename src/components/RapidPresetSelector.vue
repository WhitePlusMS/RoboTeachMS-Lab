<script setup lang="ts">
import { computed, ref } from 'vue'
import PresetLibraryDialog from './PresetLibraryDialog.vue'
import type { RapidPresetProgram } from '@/application/preset-programs.ts'

interface Props {
  /** 当前 RAPID 源程序；用于判断加载预设是否会覆盖当前内容。 */
  source: string
  /** 程序运行中时禁止打开预设库。 */
  running: boolean
  /** 页面启动时的默认源码；作为「未修改」基线的提示参考。 */
  initialSource: string
}

const props = defineProps<Props>()

const emit = defineEmits<{ load: [preset: RapidPresetProgram] }>()

/** 上传加载成功后把基线记为已载源码；用于判断当前内容相对基线是否有改动。 */
const confirmedBaseline = ref(props.initialSource)
const libraryOpen = ref(false)

/** 当前源码是否已经被用户改动（相对最近一次自动加载的基线）。 */
const sourceEdited = computed(() => props.source !== confirmedBaseline.value)
const canOpen = computed(() => !props.running)

function openLibrary(): void {
  if (!canOpen.value) return
  libraryOpen.value = true
}

function handleLoad(preset: RapidPresetProgram): void {
  emit('load', preset)
  confirmedBaseline.value = preset.source
}
</script>

<template>
  <section class="rapid-preset-launcher" aria-label="预设程序">
    <button
      type="button"
      class="secondary-action rapid-preset-open"
      :disabled="!canOpen"
      title="打开预设程序库，选择可运行示例模板"
      @click="openLibrary"
    >
      <span class="rapid-preset-open-icon" aria-hidden="true">▦</span>
      预设程序
    </button>
    <p v-if="running" class="rapid-preset-hint rapid-preset-hint-warn">
      程序运行期间不能切换预设模板。
    </p>

    <PresetLibraryDialog
      :open="libraryOpen"
      :source-edited="sourceEdited"
      @update:open="libraryOpen = $event"
      @load="handleLoad"
    />
  </section>
</template>

<style scoped>
.rapid-preset-launcher {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
}

.rapid-preset-open {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.rapid-preset-open-icon {
  font-size: 13px;
  line-height: 1;
}

.rapid-preset-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
}

.rapid-preset-hint-warn {
  color: var(--color-warning-soft);
}
</style>
