<script setup lang="ts">
import { computed } from 'vue'
import type { ProgramControllerSnapshot } from '../application/program-control.ts'

interface Props {
  snapshot: ProgramControllerSnapshot
  source: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  run: []
  pause: []
  resume: []
  stop: []
  reset: []
  'source-change': [source: string]
}>()

const STATE_LABEL: Record<ProgramControllerSnapshot['state'], string> = {
  idle: '空闲',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  stopped: '已停止',
  error: '错误',
}

const stateLabel = computed(() => STATE_LABEL[props.snapshot.state])
const sourceLocked = computed(
  () => props.snapshot.state === 'running' || props.snapshot.state === 'paused',
)
const canRun = computed(() => props.snapshot.state === 'idle')
const canPause = computed(() => props.snapshot.state === 'running')
const canResume = computed(() => props.snapshot.state === 'paused')
const canStop = computed(
  () => props.snapshot.state === 'running' || props.snapshot.state === 'paused',
)
const canReset = computed(
  () =>
    props.snapshot.state === 'completed' ||
    props.snapshot.state === 'stopped' ||
    props.snapshot.state === 'error',
)

const motionPointerText = computed(() => props.snapshot.motionPointer?.toString() ?? '—')
const errorText = computed(() => {
  const error = props.snapshot.error
  if (!error) return '—'
  const location = error.sourceRange
    ? ` · 行 ${error.sourceRange.start.line} 列 ${error.sourceRange.start.column}`
    : ''
  return `指令 ${error.index} · ${error.code}${location} — ${error.message}`
})

function handleSourceInput(event: Event): void {
  if (!(event.target instanceof HTMLTextAreaElement)) return
  emit('source-change', event.target.value)
}
</script>

<template>
  <section class="program-panel" aria-labelledby="program-panel-title">
    <div class="panel-title-row">
      <div>
        <p class="panel-kicker">RAPID SOURCE</p>
        <h2 id="program-panel-title">RAPID 程序</h2>
      </div>
      <span class="control-status" :class="`program-state-${props.snapshot.state}`">
        {{ stateLabel }}
      </span>
    </div>

    <textarea
      class="rapid-source-editor"
      aria-label="RAPID 源程序"
      :value="props.source"
      :disabled="sourceLocked"
      rows="12"
      spellcheck="false"
      @input="handleSourceInput"
    />
    <p v-if="sourceLocked" class="program-hint">程序运行或暂停期间，源程序已锁定。</p>

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

    <div class="program-actions">
      <button type="button" class="primary-action" :disabled="!canRun" @click="emit('run')">
        运行
      </button>
      <button type="button" class="secondary-action" :disabled="!canPause" @click="emit('pause')">
        暂停
      </button>
      <button type="button" class="secondary-action" :disabled="!canResume" @click="emit('resume')">
        继续
      </button>
      <button type="button" class="danger-action" :disabled="!canStop" @click="emit('stop')">
        停止
      </button>
      <button type="button" class="secondary-action" :disabled="!canReset" @click="emit('reset')">
        复位
      </button>
    </div>

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
