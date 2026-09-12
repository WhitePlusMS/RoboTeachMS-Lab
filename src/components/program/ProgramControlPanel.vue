<script setup lang="ts">
import { computed } from 'vue'
import { Play, Rewind, Square, StepForward } from '@lucide/vue'
import RapidSourceEditor from './RapidSourceEditor.vue'
import type { ProgramSessionSnapshot } from '@/application/program/use-program-session.ts'
import {
  isRapidMotionInstruction,
  type RapidExecutableInstruction,
  type RapidSourceRange,
} from '@/rapid/language/index.ts'

interface Props {
  snapshot: ProgramSessionSnapshot
  source: string
  /** 已解析的可执行指令序列，用于把 PP/MP 索引映射到源码行并展示结构化指令。 */
  program: readonly RapidExecutableInstruction[]
  /** off-path 时正等待 Clear 确认的运行模式；null 表示当前没有待确认。 */
  pendingClear: 'run' | 'step' | null
  /** 工作区组合时只显示源码内容或固定控制栏；transport 供顶栏示教器式运行键组。 */
  display?: 'all' | 'content' | 'actions' | 'transport'
  /** 从 Program Data 查看引用时，请求源码编辑器定位到对应范围。 */
  focusRange?: RapidSourceRange | null
  /** 每次查看引用递增，即使范围对象相同也必须重新定位。 */
  focusRequestId?: number
  /** 编辑器光标所在源码行，用于 gutter 高亮（FlexPendant 式插入锚点反馈）。 */
  cursorLine?: number | null
}

const props = defineProps<Props>()
const display = computed(() => props.display ?? 'all')

const emit = defineEmits<{
  run: []
  step: []
  stop: []
  pp: []
  'source-change': [source: string]
  /** 透传源码编辑器光标行，供 ProgramEditorToolbar/MotionArgumentPanel 光标定位。 */
  'cursor-line-change': [line: number]
  /** 透传双击指令行（FlexPendant Change Selected），携带行号（1 起始）。 */
  'line-activate': [line: number]
  'confirm-clear': []
  'cancel-clear': []
}>()

const STATE_LABEL: Record<ProgramSessionSnapshot['state'], string> = {
  idle: '空闲',
  running: '运行中',
  stopped: '已停止',
  completed: '已完成',
  error: '错误',
}

const stateLabel = computed(() => STATE_LABEL[props.snapshot.state])
const sourceLocked = computed(() => props.snapshot.state === 'running')
const runnable = computed(
  () => props.snapshot.state === 'idle' || props.snapshot.state === 'stopped',
)
// PP 无法映射时禁用运行/单步，必须先 PP to Main。
const canRun = computed(
  () => runnable.value && !props.snapshot.needsPPtoMain && props.snapshot.diagnostics.length === 0,
)
const canStep = computed(
  () => runnable.value && !props.snapshot.needsPPtoMain && props.snapshot.diagnostics.length === 0,
)
const canStop = computed(() => props.snapshot.state === 'running')
const canPpToMain = computed(() => props.snapshot.state !== 'running')
const showOffPathConfirm = computed(() => props.pendingClear !== null)
const confirmLabel = computed(() =>
  props.pendingClear === 'step' ? '从当前位置单步到下一目标' : '从当前位置规划到下一目标',
)

// PP/MP 索引 → 源码行；用于 gutter 标记（PP 蓝、MP 橙）。
const ppLine = computed(
  () => props.program[props.snapshot.programPointer]?.sourceRange.start.line ?? null,
)
const mpLine = computed(() =>
  props.snapshot.motionPointer === null || props.snapshot.motionPointer === undefined
    ? null
    : (props.program[props.snapshot.motionPointer]?.sourceRange.start.line ?? null),
)
// 活动/下一条待执行指令（程序指针语义），仅供 fly-by 提示使用。
const activeIndex = computed(() => props.snapshot.motionPointer ?? props.snapshot.programPointer)
const currentInstruction = computed(() => props.program[activeIndex.value] ?? null)
// 光标所在行的结构化指令：摘要条跟随用户选择，而非程序指针。
const cursorInstruction = computed(() => {
  const line = props.cursorLine
  if (line === null || line === undefined) return null
  return (
    props.program.find(
      (instruction) =>
        instruction.sourceRange.start.line <= line && line <= instruction.sourceRange.end.line,
    ) ?? null
  )
})
/** 当前活动/下一条指令若使用非 fine（fly-by）zone，返回 zone 名（如 z50），否则 null；用于提示未模拟路径融合。 */
const flyByZone = computed(() => {
  const instruction = currentInstruction.value
  if (!instruction || !isRapidMotionInstruction(instruction) || instruction.zone.finep) return null
  return instruction.operands.zone
})
const diagnosticLines = computed(() =>
  props.snapshot.diagnostics.map((diagnostic) => diagnostic.range.start.line),
)
const runtimeErrorLine = computed(() => props.snapshot.error?.sourceRange?.start.line ?? null)

const errorText = computed(() => {
  const error = props.snapshot.error
  if (!error) return '—'
  const location = error.sourceRange
    ? ` · 行 ${error.sourceRange.start.line} 列 ${error.sourceRange.start.column}`
    : ''
  return `指令 ${error.index} · ${error.code}${location} — ${error.message}`
})
</script>

<template>
  <section
    class="program-panel"
    :class="`program-panel-${display}`"
    :aria-labelledby="display === 'all' ? 'program-panel-title' : undefined"
    :aria-label="
      display === 'transport' ? '程序运行控制' : display === 'content' ? 'RAPID 程序' : undefined
    "
  >
    <!-- 顶栏 transport：示教器式运行键组 + off-path 确认 -->
    <template v-if="display === 'transport'">
      <div class="tgroup">
        <button
          type="button"
          class="tkey tkey-run"
          :disabled="!canRun"
          title="运行程序（从 PP 位置开始执行）"
          @click="emit('run')"
        >
          <span class="tkey-icon" aria-hidden="true"><Play :size="13" /></span>运行
        </button>
        <button
          type="button"
          class="tkey"
          :disabled="!canStep"
          title="单步执行下一条指令"
          @click="emit('step')"
        >
          <span class="tkey-icon" aria-hidden="true"><StepForward :size="13" /></span>单步
        </button>
        <button
          type="button"
          class="tkey tkey-stop"
          :disabled="!canStop"
          title="停止当前程序"
          @click="emit('stop')"
        >
          <span class="tkey-icon" aria-hidden="true"><Square :size="12" /></span>停止
        </button>
        <button
          type="button"
          class="tkey"
          :disabled="!canPpToMain"
          title="PP 回到 Main，把程序指针重置到开头"
          @click="emit('pp')"
        >
          <span class="tkey-icon" aria-hidden="true"><Rewind :size="13" /></span>PP to Main
        </button>
        <span class="control-status" :class="`program-state-${props.snapshot.state}`">
          {{ stateLabel }}
        </span>
      </div>
      <!-- 需 PP to Main / 偏离路径等瞬态提示已由 toast+日志承载，此处不常驻占位。 -->
      <div v-if="showOffPathConfirm" class="program-clear-confirm" aria-label="偏离路径确认">
        <p>{{ confirmLabel }}（ABB Clear 语义）。</p>
        <div class="program-actions">
          <button
            type="button"
            class="primary-action"
            title="确认：从当前位置规划并执行到下一目标（Clear 语义）"
            @click="emit('confirm-clear')"
          >
            确认
          </button>
          <button
            type="button"
            class="secondary-action"
            title="取消本次操作"
            @click="emit('cancel-clear')"
          >
            取消
          </button>
        </div>
      </div>
    </template>

    <template v-if="display === 'all' || display === 'content'">
      <div v-if="display === 'all'" class="panel-title-row">
        <div>
          <h2 id="program-panel-title">RAPID 程序</h2>
        </div>
        <span class="control-status" :class="`program-state-${props.snapshot.state}`">
          {{ stateLabel }}
        </span>
      </div>

      <RapidSourceEditor
        :source="props.source"
        :readonly="sourceLocked"
        :pp-line="ppLine"
        :mp-line="mpLine"
        :cursor-line="props.cursorLine ?? null"
        :instruction="cursorInstruction"
        :diagnostic-lines="diagnosticLines"
        :runtime-error-line="runtimeErrorLine"
        :focus-range="props.focusRange"
        :focus-request-id="props.focusRequestId"
        @source-change="emit('source-change', $event)"
        @cursor-line-change="emit('cursor-line-change', $event)"
        @line-activate="emit('line-activate', $event)"
      />
      <!-- 源程序锁定 / 等待下一步等瞬态提示已由 toast+日志承载，此处不常驻占位。 -->
      <p v-if="flyByZone" class="program-hint program-hint-warn">
        当前指令使用 {{ flyByZone }}（非 fine，fly-by）：当前 MVP 未模拟 ABB
        路径融合，采用精确停点近似。
      </p>

      <div
        v-if="props.snapshot.diagnostics.length > 0"
        class="rapid-diagnostics"
        aria-label="RAPID 诊断"
        tabindex="0"
      >
        <ul>
          <li
            v-for="(diagnostic, index) in props.snapshot.diagnostics"
            :key="`${diagnostic.range.start.offset}-${index}`"
          >
            行 {{ diagnostic.range.start.line }} 列 {{ diagnostic.range.start.column }} ·
            {{ diagnostic.code }} — {{ diagnostic.message }}
          </li>
        </ul>
      </div>
      <p v-if="props.snapshot.error" class="program-error">运动规划错误：{{ errorText }}</p>
    </template>

    <template v-if="display === 'all' || display === 'actions'">
      <div class="program-control-footer" aria-label="程序控制栏">
        <div class="panel-title-row">
          <div>
            <h2>程序控制</h2>
          </div>
          <span class="control-status" :class="`program-state-${props.snapshot.state}`">
            {{ stateLabel }}
          </span>
        </div>

        <!-- 需 PP to Main / 偏离路径等瞬态提示已由 toast+日志承载，此处不常驻占位。 -->
        <div class="program-actions">
          <button
            type="button"
            class="primary-action"
            :disabled="!canRun"
            title="运行程序（从 PP 位置开始执行）"
            @click="emit('run')"
          >
            运行
          </button>
          <button
            type="button"
            class="secondary-action"
            :disabled="!canStep"
            title="单步执行下一条指令"
            @click="emit('step')"
          >
            单步
          </button>
          <button
            type="button"
            class="danger-action"
            :disabled="!canStop"
            title="停止当前程序"
            @click="emit('stop')"
          >
            停止
          </button>
          <button
            type="button"
            class="secondary-action"
            :disabled="!canPpToMain"
            title="PP 回到 Main，把程序指针重置到开头"
            @click="emit('pp')"
          >
            PP to Main
          </button>
        </div>

        <div v-if="showOffPathConfirm" class="program-clear-confirm" aria-label="偏离路径确认">
          <p>{{ confirmLabel }}（ABB Clear 语义）。</p>
          <div class="program-actions">
            <button
              type="button"
              class="primary-action"
              title="确认：从当前位置规划并执行到下一目标（Clear 语义）"
              @click="emit('confirm-clear')"
            >
              确认
            </button>
            <button
              type="button"
              class="secondary-action"
              title="取消本次操作"
              @click="emit('cancel-clear')"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.program-panel {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  background: var(--color-surface-deep);
}

/* dock 内的 content 模式：去掉面板外壳（边框/底色/圆角），避免与 dock 套娃。 */
.program-panel-content {
  padding: 14px 16px;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.program-panel h2 {
  color: var(--color-text-strong);
  font-size: var(--text-3xl);
  letter-spacing: -0.03em;
}

.program-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 面板内边距已由编辑器全出血布局接管（padding 0），辅助块自己保留左右边距。 */
.program-panel-content > .program-hint,
.program-panel-content > .rapid-diagnostics,
.program-panel-content > .program-error {
  margin-inline: 16px;
}

.program-panel-content > :last-child {
  margin-bottom: 12px;
}

.program-hint,
.rapid-diagnostics {
  margin: 0;
  color: var(--color-text-faint);
  font-size: var(--text-md);
  line-height: 1.5;
}

/* 诊断列表：去边框化，hairline 分隔，仅保留极淡底色。 */
.rapid-diagnostics {
  box-sizing: border-box;
  max-height: 180px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 10px 2px 0;
  border-top: 1px solid var(--color-border);
}

.rapid-diagnostics p,
.rapid-diagnostics ul {
  margin: 0;
}

.rapid-diagnostics ul {
  padding-left: 18px;
  color: var(--color-danger-soft);
}

.program-error {
  margin: 0;
  color: var(--color-text-faint);
  font-size: var(--text-md);
  line-height: 1.5;
}

/* 警告提示：去边框化，仅用警告色文字表达语义。 */
.program-hint-warn {
  color: var(--color-warning-soft);
}

/* Fixed control footer (run/step/stop/PP + clear confirm). */
.program-control-footer {
  display: grid;
  gap: 7px;
}

.program-control-footer h2 {
  color: var(--color-text-strong);
  font-size: var(--text-xl);
}

.program-control-footer .program-hint-warn {
  font-size: var(--text-sm);
}

.program-control-footer .program-actions {
  gap: 6px;
}

.program-control-footer .primary-action,
.program-control-footer .secondary-action,
.program-control-footer .danger-action {
  padding: 7px 12px;
  font-size: var(--text-md);
}

/* off-path 确认块：去边框化，hairline 分隔，警告语义仅由文字颜色表达。 */
.program-clear-confirm {
  display: grid;
  gap: 5px;
  padding: 7px 2px 0;
  border-top: 1px solid var(--color-border);
}

.program-clear-confirm p {
  margin: 0;
  color: var(--color-warning-soft);
  font-size: var(--text-sm);
  line-height: 1.5;
}

/* 顶栏 transport：去掉面板外壳，仅保留水平键组与状态丸；作为浮窗定位上下文。 */
.program-panel-transport {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

/* transport off-path 确认：浮窗卡片，脱离顶栏文档流向下展开，不挤压同行控件。 */
.program-panel-transport .program-clear-confirm {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: var(--z-popover);
  box-sizing: border-box;
  min-width: 280px;
  max-width: 340px;
  padding: 12px 14px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  box-shadow: var(--shadow-overlay);
}

.program-panel-transport .program-clear-confirm p {
  color: var(--color-warning-soft);
  font-size: var(--text-md);
}

.program-panel-transport .program-clear-confirm .program-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.program-panel-transport .program-clear-confirm .primary-action,
.program-panel-transport .program-clear-confirm .secondary-action {
  padding: 7px 14px;
  font-size: var(--text-md);
}
</style>
