<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { isRapidMotionInstruction, type RapidExecutableInstruction, type RapidSourceRange } from '../rapid/rapid-parser.ts'

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
  /** 从 Program Data 查看引用时，请求定位到该源码范围。 */
  focusRange?: RapidSourceRange | null
  /** 每次查看引用递增，即使范围对象相同也必须重新定位。 */
  focusRequestId?: number
}

const props = defineProps<Props>()

const emit = defineEmits<{ 'source-change': [source: string] }>()

const gutterOffset = ref(0)
const editor = ref<HTMLTextAreaElement | null>(null)

const lineCount = computed(() => (props.source === '' ? 1 : props.source.split('\n').length))

function onScroll(event: Event): void {
  const textarea = event.target as HTMLTextAreaElement
  gutterOffset.value = textarea.scrollTop
}

function handleSourceInput(event: Event): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return
  emit('source-change', event.target.value)
}

watch(
  () => [props.focusRange, props.focusRequestId] as const,
  ([range]) => {
    if (!range) return
    void nextTick(() => {
      const textarea = editor.value
      if (!textarea) return
      textarea.focus()
      textarea.selectionStart = range.start.offset
      textarea.selectionEnd = range.end.offset
      textarea.scrollTop = Math.max(0, (range.start.line - 1) * 20 - 60)
    })
  },
)

const motionInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && isRapidMotionInstruction(instruction) ? instruction : null
})
const assignmentInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'assign' ? instruction : null
})
const conditionalInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'if' ? instruction : null
})
const kindLabel = computed(() => {
  if (motionInstruction.value) return motionInstruction.value.kind === 'movej' ? 'MoveJ' : 'MoveL'
  return assignmentInstruction.value ? '赋值' : ''
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
        ref="editor"
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
      <dl v-else-if="motionInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>{{ kindLabel }}</dd>
        </div>
        <div>
          <dt>目标</dt>
          <dd>{{ motionInstruction.operands.target }}</dd>
        </div>
        <div>
          <dt>速度</dt>
          <dd>{{ motionInstruction.operands.speed }}</dd>
        </div>
        <div>
          <dt>zone</dt>
          <dd>{{ motionInstruction.operands.zone }}</dd>
        </div>
        <div>
          <dt>tool</dt>
          <dd>{{ motionInstruction.operands.tool }}</dd>
        </div>
        <div>
          <dt>wobj</dt>
          <dd>{{ motionInstruction.operands.wobj }}</dd>
        </div>
      </dl>
      <dl v-else-if="assignmentInstruction" class="instruction-summary-fields">
        <div><dt>指令</dt><dd>{{ kindLabel }}</dd></div>
        <div><dt>变量</dt><dd>{{ assignmentInstruction.target.name }}</dd></div>
        <div><dt>表达式</dt><dd>{{ assignmentInstruction.sourceText }}</dd></div>
      </dl>
      <dl v-else-if="conditionalInstruction" class="instruction-summary-fields">
        <div><dt>指令</dt><dd>{{ conditionalInstruction.conditionKind === 'if' ? 'IF' : 'ELSEIF' }}</dd></div>
        <div><dt>条件</dt><dd>{{ conditionalInstruction.sourceText }}</dd></div>
      </dl>
    </div>
  </div>
</template>
