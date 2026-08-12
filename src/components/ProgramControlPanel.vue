<script setup lang="ts">
import { computed } from 'vue'
import RapidSourceEditor from './RapidSourceEditor.vue'
import type { ProgramControllerSnapshot } from '../application/program-control.ts'
import type { RapidExecutableInstruction } from '../rapid/rapid-parser.ts'

interface Props {
  snapshot: ProgramControllerSnapshot
  source: string
  /** 已解析的可执行指令序列，用于把 PP/MP 索引映射到源码行并展示结构化指令。 */
  program: readonly RapidExecutableInstruction[]
  /** off-path 时正等待 Clear 确认的运行模式；null 表示当前没有待确认。 */
  pendingClear: 'run' | 'step' | null
}

const props = defineProps<Props>()

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
const runnable = computed(() => props.snapshot.state === 'idle' || props.snapshot.state === 'stopped')
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
const confirmLabel = computed(() => (props.pendingClear === 'step' ? '从当前位置单步到下一目标' : '从当前位置规划到下一目标'))

// PP/MP 索引 → 源码行；用于 gutter 标记（PP 蓝、MP 橙）。
const ppLine = computed(() => props.program[props.snapshot.programPointer]?.sourceRange.start.line ?? null)
const mpLine = computed(() =>
  props.snapshot.motionPointer === null || props.snapshot.motionPointer === undefined
    ? null
    : (props.program[props.snapshot.motionPointer]?.sourceRange.start.line ?? null),
)
// 当前结构化指令：活动运动优先，否则是下一条待执行指令。
const activeIndex = computed(() => props.snapshot.motionPointer ?? props.snapshot.programPointer)
const currentInstruction = computed(() => props.program[activeIndex.value] ?? null)
const diagnosticLines = computed(() => props.snapshot.diagnostics.map((diagnostic) => diagnostic.range.start.line))
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
  <section class="program-panel" aria-labelledby="program-panel-title">
    <div class="panel-title-row">
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
      :instruction="currentInstruction"
      :diagnostic-lines="diagnosticLines"
      :runtime-error-line="runtimeErrorLine"
      @source-change="emit('source-change', $event)"
    />
    <p v-if="sourceLocked" class="program-hint">程序运行期间，源程序已锁定。</p>
    <p v-else-if="awaitingNext" class="program-hint">单步已完成，等待下一步；可继续单步或运行。</p>

    <p v-if="props.snapshot.needsPPtoMain" class="program-hint program-hint-warn">
      停止后源码无法稳定映射当前程序指针：请先执行 PP to Main 以从 main 重新建立执行位置。
    </p>
    <p v-if="props.snapshot.offPath && !showOffPathConfirm" class="program-hint program-hint-warn">
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
      <button type="button" class="secondary-action" :disabled="!canPpToMain" @click="emit('pp')">
        PP to Main
      </button>
    </div>

    <div v-if="showOffPathConfirm" class="program-clear-confirm" aria-label="偏离路径确认">
      <p>{{ confirmLabel }}（ABB Clear 语义）。</p>
      <div class="program-actions">
        <button type="button" class="primary-action" @click="emit('confirm-clear')">确认</button>
        <button type="button" class="secondary-action" @click="emit('cancel-clear')">取消</button>
      </div>
    </div>

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
        <li v-for="(diagnostic, index) in props.snapshot.diagnostics" :key="`${diagnostic.range.start.offset}-${index}`">
          行 {{ diagnostic.range.start.line }} 列 {{ diagnostic.range.start.column }} ·
          {{ diagnostic.code }} — {{ diagnostic.message }}
        </li>
      </ul>
    </div>
    <p class="program-error">运动规划错误：{{ errorText }}</p>
  </section>
</template>
