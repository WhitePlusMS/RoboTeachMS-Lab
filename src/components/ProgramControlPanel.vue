<script setup lang="ts">
import { computed } from 'vue'
import RapidSourceEditor from './RapidSourceEditor.vue'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'
import {
  isRapidMotionInstruction,
  type RapidExecutableInstruction,
  type RapidSourceRange,
} from '@/rapid/rapid-parser.ts'

interface Props {
  snapshot: ProgramControllerSnapshot
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
  /** 透传源码编辑器光标行，供 MotionInstructionToolbar 光标定位插入。 */
  'cursor-line-change': [line: number]
  'confirm-clear': []
  'cancel-clear': []
}>()

const STATE_LABEL: Record<ProgramControllerSnapshot['state'], string> = {
  idle: '空闲',
  running: '运行中',
  stopped: '已停止',
  completed: '已完成',
  error: '错误',
}

const stateLabel = computed(() => STATE_LABEL[props.snapshot.state])
/** 等待下一步提示：程序已停止且下一执行位置仍在程序内（执行器在末条单步后置为 completed）。 */
const awaitingNext = computed(
  () => props.snapshot.state === 'stopped' && props.snapshot.stopReason === 'step-completed',
)
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
// 当前结构化指令：活动运动优先，否则是下一条待执行指令。
const activeIndex = computed(() => props.snapshot.motionPointer ?? props.snapshot.programPointer)
const currentInstruction = computed(() => props.program[activeIndex.value] ?? null)
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

const motionPointerText = computed(() => props.snapshot.motionPointer?.toString() ?? '—')
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
    <!-- 顶栏 transport：示教器式运行键组 + 程序状态丸 + off-path 确认 -->
    <template v-if="display === 'transport'">
      <div class="tgroup">
        <button type="button" class="tkey tkey-run" :disabled="!canRun" @click="emit('run')">
          <span class="tkey-icon" aria-hidden="true">▶</span>运行
        </button>
        <button type="button" class="tkey" :disabled="!canStep" @click="emit('step')">
          <span class="tkey-icon" aria-hidden="true">⏭</span>单步
        </button>
        <button type="button" class="tkey tkey-stop" :disabled="!canStop" @click="emit('stop')">
          <span class="tkey-icon" aria-hidden="true">■</span>停止
        </button>
        <button type="button" class="tkey" :disabled="!canPpToMain" @click="emit('pp')">
          <span class="tkey-icon" aria-hidden="true">↺</span>PP to Main
        </button>
      </div>
      <span class="control-status" :class="`program-state-${props.snapshot.state}`">
        {{ stateLabel }}
      </span>
      <p v-if="props.snapshot.needsPPtoMain" class="program-hint program-hint-warn transport-hint">
        停止后源码无法稳定映射当前程序指针：请先执行 PP to Main 以从 main 重新建立执行位置。
      </p>
      <p
        v-else-if="props.snapshot.offPath && !showOffPathConfirm"
        class="program-hint program-hint-warn transport-hint"
      >
        机器人已被手动 Jog，偏离原程序路径：再次运行/单步将从当前位置规划到下一目标。
      </p>
      <div v-if="showOffPathConfirm" class="program-clear-confirm" aria-label="偏离路径确认">
        <p>{{ confirmLabel }}（ABB Clear 语义）。</p>
        <div class="program-actions">
          <button type="button" class="primary-action" @click="emit('confirm-clear')">确认</button>
          <button type="button" class="secondary-action" @click="emit('cancel-clear')">取消</button>
        </div>
      </div>
    </template>

    <template v-if="display === 'all' || display === 'content'">
      <div v-if="display === 'all'" class="panel-title-row">
        <div>
          <p class="panel-kicker">RAPID SOURCE &amp; RUN</p>
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
        :instruction="currentInstruction"
        :diagnostic-lines="diagnosticLines"
        :runtime-error-line="runtimeErrorLine"
        :focus-range="props.focusRange"
        :focus-request-id="props.focusRequestId"
        @source-change="emit('source-change', $event)"
        @cursor-line-change="emit('cursor-line-change', $event)"
      />
      <p v-if="sourceLocked" class="program-hint">程序运行期间，源程序已锁定。</p>
      <p v-else-if="awaitingNext" class="program-hint">
        单步已完成，等待下一步；可继续单步或运行。
      </p>
      <p v-if="flyByZone" class="program-hint program-hint-warn">
        当前指令使用 {{ flyByZone }}（非 fine，fly-by）：当前 MVP 未模拟 ABB
        路径融合，采用精确停点近似。
      </p>

      <dl class="program-stats" aria-label="程序快照">
        <div>
          <dt>程序指针</dt>
          <dd>{{ props.snapshot.programPointer }}</dd>
        </div>
        <div>
          <dt>运动指针</dt>
          <dd>{{ motionPointerText }}</dd>
        </div>
      </dl>

      <div
        v-if="props.snapshot.diagnostics.length > 0"
        class="rapid-diagnostics"
        aria-label="RAPID 诊断"
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
            <p class="panel-kicker">PROGRAM CONTROL</p>
            <h2>程序控制</h2>
          </div>
          <span class="control-status" :class="`program-state-${props.snapshot.state}`">
            {{ stateLabel }}
          </span>
        </div>

        <p v-if="props.snapshot.needsPPtoMain" class="program-hint program-hint-warn">
          停止后源码无法稳定映射当前程序指针：请先执行 PP to Main 以从 main 重新建立执行位置。
        </p>
        <p
          v-if="props.snapshot.offPath && !showOffPathConfirm"
          class="program-hint program-hint-warn"
        >
          机器人已被手动 Jog，偏离原程序路径：再次运行/单步将从当前位置规划到下一目标。
        </p>

        <div class="program-actions">
          <button type="button" class="primary-action" :disabled="!canRun" @click="emit('run')">
            运行
          </button>
          <button type="button" class="secondary-action" :disabled="!canStep" @click="emit('step')">
            单步
          </button>
          <button type="button" class="danger-action" :disabled="!canStop" @click="emit('stop')">
            停止
          </button>
          <button
            type="button"
            class="secondary-action"
            :disabled="!canPpToMain"
            @click="emit('pp')"
          >
            PP to Main
          </button>
        </div>

        <div v-if="showOffPathConfirm" class="program-clear-confirm" aria-label="偏离路径确认">
          <p>{{ confirmLabel }}（ABB Clear 语义）。</p>
          <div class="program-actions">
            <button type="button" class="primary-action" @click="emit('confirm-clear')">
              确认
            </button>
            <button type="button" class="secondary-action" @click="emit('cancel-clear')">
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
  font-size: 19px;
  letter-spacing: -0.03em;
}

.program-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.program-hint,
.rapid-diagnostics {
  margin: 0;
  color: var(--color-text-faint);
  font-size: 12px;
  line-height: 1.5;
}

/* 诊断列表：去边框化，hairline 分隔，仅保留极淡底色。 */
.rapid-diagnostics {
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

/* 指针读数：无边框 hairline 条带，不再每格一个盒子。 */
.program-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  margin: 0;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.program-stats div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 8px 2px;
}

.program-stats div + div {
  padding-left: 14px;
  border-left: 1px solid var(--color-border);
}

.program-stats dt {
  color: var(--color-text-faint);
  font-size: 12px;
}

.program-stats dd {
  margin: 0;
  color: var(--color-text-strong);
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 700;
}

.program-error {
  margin: 0;
  color: var(--color-text-faint);
  font-size: 12px;
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
  font-size: 14px;
}

.program-control-footer .program-hint-warn {
  font-size: 11px;
}

.program-control-footer .program-actions {
  gap: 6px;
}

.program-control-footer .primary-action,
.program-control-footer .secondary-action,
.program-control-footer .danger-action {
  padding: 7px 12px;
  font-size: 12px;
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
  font-size: 11px;
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

/* 顶栏 transport 内的程序状态丸与 .tkey/.pill 同高对齐。 */
.program-panel-transport .control-status {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 30px;
  padding: 0 10px;
}

.program-panel-transport .transport-hint {
  max-width: 360px;
  margin: 0;
}

/* transport off-path 确认：浮窗卡片，脱离顶栏文档流向下展开，不挤压同行控件。 */
.program-panel-transport .program-clear-confirm {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 40;
  box-sizing: border-box;
  min-width: 280px;
  max-width: 340px;
  padding: 12px 14px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
}

.program-panel-transport .program-clear-confirm p {
  color: var(--color-warning-soft);
  font-size: 12px;
}

.program-panel-transport .program-clear-confirm .program-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.program-panel-transport .program-clear-confirm .primary-action,
.program-panel-transport .program-clear-confirm .secondary-action {
  padding: 7px 14px;
  font-size: 12px;
}
</style>
