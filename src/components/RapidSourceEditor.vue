<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  isRapidMotionInstruction,
  type RapidExecutableInstruction,
  type RapidSourceRange,
} from '@/rapid/rapid-parser.ts'

interface Props {
  source: string
  readonly: boolean
  /** 程序指针（PP）所在源码行；无效为 null。 */
  ppLine: number | null
  /** 运动指针（MP）所在源码行；无效为 null。 */
  mpLine: number | null
  /** 编辑器光标所在源码行（FlexPendant 式插入锚点）；未知为 null。 */
  cursorLine?: number | null
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

const emit = defineEmits<{
  'source-change': [source: string]
  /** 编辑器光标（caret）所在源码行（1 起始），供 FlexPendant 式光标定位插入使用。 */
  'cursor-line-change': [line: number]
  /** 双击指令行（FlexPendant 双击 = Change Selected 打开参数编辑），携带该行行号（1 起始）。 */
  'line-activate': [line: number]
}>()

const gutterOffset = ref(0)
const editor = ref<HTMLTextAreaElement | null>(null)

const lineCount = computed(() => (props.source === '' ? 1 : props.source.split('\n').length))

function onScroll(event: Event): void {
  const textarea = event.target as HTMLTextAreaElement
  gutterOffset.value = textarea.scrollTop
}

function emitCursorLine(textarea: HTMLTextAreaElement): void {
  const offset = textarea.selectionStart ?? 0
  const value = textarea.value
  let line = 1
  for (let index = 0; index < offset && index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) line += 1
  }
  emit('cursor-line-change', line)
}

/** 光标活动统一入口：聚焦、鼠标点选、键盘移动、选区变化与输入都会改变 caret 位置。 */
function onCursorActivity(event: Event): void {
  if (event.target instanceof HTMLTextAreaElement) emitCursorLine(event.target)
}

/** 双击 = FlexPendant 双击指令打开参数编辑；上报双击时 caret 所在行。 */
function onLineActivate(event: MouseEvent): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return
  const offset = event.target.selectionStart ?? 0
  const value = event.target.value
  let line = 1
  for (let index = 0; index < offset && index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) line += 1
  }
  emit('line-activate', line)
}

function handleSourceInput(event: Event): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return
  emit('source-change', event.target.value)
  emitCursorLine(event.target)
}

watch(
  () => [props.focusRange, props.focusRequestId] as const,
  ([range]) => {
    if (!range) return
    void nextTick(() => {
      const textarea = editor.value
      if (!textarea) return
      // 先设置选区再聚焦：focus 会触发光标行上报，顺序反了会上报旧光标行。
      textarea.selectionStart = range.start.offset
      textarea.selectionEnd = range.end.offset
      textarea.focus()
      textarea.scrollTop = Math.max(0, (range.start.line - 1) * 20 - 60)
    })
  },
)

/** 计算源码中某一行（1 起始）的起始 offset；超出末尾时返回全文长度。 */
function lineStartOffset(source: string, line: number): number {
  let offset = 0
  for (let current = 1; current < line; current += 1) {
    const next = source.indexOf('\n', offset)
    if (next === -1) return source.length
    offset = next + 1
  }
  return offset
}

/** gutter 行号点击 = 把光标移到该行（FlexPendant 点选行语义），与点击正文等效。 */
function onGutterClick(event: MouseEvent): void {
  const textarea = editor.value
  if (!textarea || props.readonly) return
  const lineElement = (event.target as HTMLElement).closest('.source-line')
  if (!lineElement) return
  const line = Number(lineElement.textContent)
  if (!Number.isInteger(line) || line < 1) return
  textarea.selectionStart = textarea.selectionEnd = lineStartOffset(props.source, line)
  textarea.focus()
  emit('cursor-line-change', line)
}

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
const whileInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'while' ? instruction : null
})
const forInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'for' ? instruction : null
})
const exitInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'exitdo' ? instruction : null
})
const kindLabel = computed(() => {
  if (motionInstruction.value) return motionInstruction.value.kind === 'movej' ? 'MoveJ' : 'MoveL'
  return assignmentInstruction.value ? '赋值' : ''
})
</script>

<template>
  <div class="source-editor-wrap">
    <div class="source-editor-scroll">
      <div class="source-gutter" aria-hidden="true" @click="onGutterClick">
        <div class="source-gutter-inner" :style="{ transform: `translateY(${-gutterOffset}px)` }">
          <div
            v-for="line in lineCount"
            :key="line"
            class="source-line"
            :class="{
              'cursor-line': line === props.cursorLine,
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
        @focus="onCursorActivity"
        @click="onCursorActivity"
        @dblclick="onLineActivate"
        @keyup="onCursorActivity"
        @select="onCursorActivity"
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
          <dt>转弯区</dt>
          <dd>{{ motionInstruction.operands.zone }}</dd>
        </div>
        <div>
          <dt>工具</dt>
          <dd>{{ motionInstruction.operands.tool }}</dd>
        </div>
        <div>
          <dt>工件</dt>
          <dd>{{ motionInstruction.operands.wobj }}</dd>
        </div>
      </dl>
      <dl v-else-if="assignmentInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>{{ kindLabel }}</dd>
        </div>
        <div>
          <dt>变量</dt>
          <dd>{{ assignmentInstruction.target.name }}</dd>
        </div>
        <div>
          <dt>表达式</dt>
          <dd>{{ assignmentInstruction.sourceText }}</dd>
        </div>
      </dl>
      <dl v-else-if="conditionalInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>{{ conditionalInstruction.conditionKind === 'if' ? 'IF' : 'ELSEIF' }}</dd>
        </div>
        <div>
          <dt>条件</dt>
          <dd>{{ conditionalInstruction.sourceText }}</dd>
        </div>
      </dl>
      <dl v-else-if="whileInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>WHILE</dd>
        </div>
        <div>
          <dt>条件</dt>
          <dd>{{ whileInstruction.sourceText }}</dd>
        </div>
      </dl>
      <dl v-else-if="forInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>FOR</dd>
        </div>
        <div>
          <dt>循环头</dt>
          <dd>{{ forInstruction.sourceText }}</dd>
        </div>
        <div>
          <dt>循环变量</dt>
          <dd>{{ forInstruction.loopVar.name }}</dd>
        </div>
      </dl>
      <dl v-else-if="exitInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>EXITDO</dd>
        </div>
        <div>
          <dt>说明</dt>
          <dd>提前退出当前循环</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.rapid-source-editor {
  width: 100%;
  min-height: 220px;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-editor);
  font: 13px/20px var(--font-mono);
  white-space: pre;
  overflow-x: auto;
  resize: vertical;
}

.rapid-source-editor:focus {
  outline: 2px solid rgba(255, 106, 26, 0.55);
  outline-offset: 1px;
}

.rapid-source-editor:disabled {
  color: var(--color-text-faint);
  background: var(--color-surface);
}

.source-editor-wrap {
  display: grid;
  gap: 10px;
}

.source-editor-scroll {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  background: var(--color-editor);
  overflow: hidden;
}

.source-editor-scroll .source-gutter {
  flex: 0 0 44px;
  overflow: hidden;
  border-right: 1px solid var(--color-border-strong);
  background: var(--color-surface-deep);
  user-select: none;
  cursor: pointer;
}

.source-gutter-inner {
  padding: 12px 0;
  font: 13px/20px var(--font-mono);
}

.source-line {
  height: 20px;
  line-height: 20px;
  padding-right: 8px;
  text-align: right;
  color: var(--color-text-dim-deep);
}

/* 光标行标记放在 PP/MP 之前定义：同行冲突时 PP/MP 的整行填充优先。 */
.source-line.cursor-line {
  color: var(--color-text);
  background: var(--color-surface-raised);
  box-shadow: inset 3px 0 var(--color-pp);
}

.source-line.pp-line {
  color: var(--color-on-brand);
  background: var(--color-pp);
  font-weight: 700;
}

.source-line.mp-line {
  color: var(--color-on-brand);
  background: var(--color-orange);
  font-weight: 700;
}

.source-line.both-line {
  background: linear-gradient(90deg, var(--color-orange) 0 50%, var(--color-pp) 50% 100%);
}

.source-line.diagnostic-line {
  box-shadow: inset 4px 0 var(--color-danger-strong);
}

.source-line.runtime-error-line {
  color: #fff;
  background: var(--color-error-bg);
  box-shadow: inset 4px 0 var(--color-error-edge);
}

.source-editor-scroll .rapid-source-editor {
  flex: 1;
  min-width: 0;
  border: 0;
  border-radius: 0;
}

.instruction-summary {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-deep);
}

.instruction-summary-empty {
  margin: 0;
  color: var(--color-text-faint);
  font-size: 12px;
}

.instruction-summary-fields {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px 12px;
  margin: 0;
}

.instruction-summary-fields div {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.instruction-summary-fields dt {
  flex: 0 0 auto;
  color: var(--color-text-faint);
  font-size: 11px;
  white-space: nowrap;
}

.instruction-summary-fields dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
