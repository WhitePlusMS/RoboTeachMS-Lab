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
  /** 工作区组合时只显示源码内容或固定控制栏；默认保留独立面板的完整视图。 */
  display?: 'all' | 'content' | 'actions'
  /** 从 Program Data 查看引用时，请求源码编辑器定位到对应范围。 */
  focusRange?: RapidSourceRange | null
  /** 每次查看引用递增，即使范围对象相同也必须重新定位。 */
  focusRequestId?: number
}

const props = defineProps<Props>()
const display = computed(() => props.display ?? 'all')

const emit = defineEmits<{
  run: []
  step: []
  stop: []
  pp: []
  'source-change': [source: string]
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
    aria-labelledby="program-panel-title"
  >
    <template v-if="display !== 'actions'">
      <div class="panel-title-row">
        <div>
          <p class="panel-kicker">RAPID SOURCE &amp; RUN</p>
          <h2 id="program-panel-title">RAPID 程序</h2>
        </div>
        <span
          v-if="display === 'all'"
          class="control-status"
          :class="`program-state-${props.snapshot.state}`"
        >
          {{ stateLabel }}
        </span>
      </div>

      <RapidSourceEditor
        :source="props.source"
        :readonly="sourceLocked"
        :pp-line="ppLine"
        :mp-line="mpLine"
        :instruction="currentInstruction"
        :diagnostic-lines="diagnosticLines"
        :runtime-error-line="runtimeErrorLine"
        :focus-range="props.focusRange"
        :focus-request-id="props.focusRequestId"
        @source-change="emit('source-change', $event)"
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

      <div class="rapid-diagnostics" aria-label="RAPID 诊断">
        <p v-if="props.snapshot.diagnostics.length === 0">诊断：无</p>
        <ul v-else>
          <li
            v-for="(diagnostic, index) in props.snapshot.diagnostics"
            :key="`${diagnostic.range.start.offset}-${index}`"
          >
            行 {{ diagnostic.range.start.line }} 列 {{ diagnostic.range.start.column }} ·
            {{ diagnostic.code }} — {{ diagnostic.message }}
          </li>
        </ul>
      </div>
      <p class="program-error">运动规划错误：{{ errorText }}</p>
    </template>

    <template v-if="display !== 'content'">
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
  margin: -6px 0 0;
  color: var(--color-text-faint);
  font-size: 12px;
  line-height: 1.5;
}

.rapid-diagnostics {
  padding: 10px 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  background: var(--color-surface-raised);
}

.rapid-diagnostics p,
.rapid-diagnostics ul {
  margin: 0;
}

.rapid-diagnostics ul {
  padding-left: 18px;
  color: var(--color-danger-soft);
}

.program-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 0;
}

.program-stats div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 8px 10px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background: var(--color-surface-raised);
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

.program-hint-warn {
  margin: -6px 0 0;
  padding: 8px 10px;
  border: 1px solid rgba(250, 204, 21, 0.35);
  border-radius: var(--radius-sm);
  color: var(--color-warning-soft);
  background: rgba(113, 63, 18, 0.18);
  font-size: 12px;
  line-height: 1.5;
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

.program-control-footer .panel-kicker {
  margin-bottom: 2px;
  font-size: 9px;
}

.program-control-footer .program-hint-warn {
  margin: 0;
  padding: 6px 8px;
  font-size: 10px;
}

.program-control-footer .program-actions {
  gap: 5px;
}

.program-control-footer .primary-action,
.program-control-footer .secondary-action,
.program-control-footer .danger-action {
  padding: 6px 9px;
  font-size: 11px;
}

.program-clear-confirm {
  display: grid;
  gap: 5px;
  padding: 7px 9px;
  border: 1px solid rgba(250, 204, 21, 0.4);
  border-radius: var(--radius-sm);
  background: rgba(113, 63, 18, 0.18);
}

.program-clear-confirm p {
  margin: 0;
  color: var(--color-warning-soft);
  font-size: 10px;
  line-height: 1.5;
}
</style>
