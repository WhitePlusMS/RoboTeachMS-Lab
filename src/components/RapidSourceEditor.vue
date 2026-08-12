<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RapidExecutableInstruction } from '../rapid/rapid-parser.ts'

interface Props {
  source: string
  readonly: boolean
  /** 程序指针（PP）所在源码行；无效为 null。 */
  ppLine: number | null
  /** 运动指针（MP）所在源码行；无效为 null。 */
  mpLine: number | null
  /** 当前活动/待执行指令（结构化），来自 executor 快照与 parser 结果。 */
  instruction: RapidExecutableInstruction | null
  /** parser 诊断所在源码行。 */
  diagnosticLines: readonly number[]
  /** 运行时规划错误所在源码行。 */
  runtimeErrorLine: number | null
}

const props = defineProps<Props>()

const emit = defineEmits<{ 'source-change': [source: string] }>()

const gutterOffset = ref(0)

const lineCount = computed(() => (props.source === '' ? 1 : props.source.split('\n').length))

function onScroll(event: Event): void {
  const textarea = event.target as HTMLTextAreaElement
  gutterOffset.value = textarea.scrollTop
}

function handleSourceInput(event: Event): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return
  emit('source-change', event.target.value)
}

const kindLabel = computed(() => {
  if (!props.instruction) return ''
  return props.instruction.kind === 'movej' ? 'MoveJ' : 'MoveL'
})
</script>

<template>
  <div class="source-editor-wrap">
    <div class="source-editor-scroll">
      <div class="source-gutter" aria-hidden="true">
        <div class="source-gutter-inner" :style="{ transform: `translateY(${-gutterOffset}px)` }">
          <div
            v-for="line in lineCount"
            :key="line"
            class="source-line"
            :class="{
              'pp-line': line === ppLine,
              'mp-line': line === mpLine,
              'both-line': line === ppLine && line === mpLine && ppLine !== null,
              'diagnostic-line': props.diagnosticLines.includes(line),
              'runtime-error-line': line === props.runtimeErrorLine,
            }"
          >
            {{ line }}
          </div>
        </div>
      </div>
      <textarea
        class="rapid-source-editor"
        aria-label="RAPID 源程序"
        :value="props.source"
        :disabled="props.readonly"
        rows="14"
        wrap="off"
        spellcheck="false"
        @scroll="onScroll"
        @input="handleSourceInput"
      />
    </div>

    <div class="instruction-summary" aria-label="当前结构化指令">
      <p v-if="!props.instruction" class="instruction-summary-empty">无活动指令。</p>
      <dl v-else class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>{{ kindLabel }}</dd>
        </div>
        <div>
          <dt>目标</dt>
          <dd>{{ props.instruction.operands.target }}</dd>
        </div>
        <div>
          <dt>速度</dt>
          <dd>{{ props.instruction.operands.speed }}</dd>
        </div>
        <div>
          <dt>zone</dt>
          <dd>{{ props.instruction.operands.zone }}</dd>
        </div>
        <div>
          <dt>tool</dt>
          <dd>{{ props.instruction.operands.tool }}</dd>
        </div>
        <div>
          <dt>wobj</dt>
          <dd>{{ props.instruction.operands.wobj }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>
