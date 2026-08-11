<script setup lang="ts">
import { computed } from 'vue'
import type { ProgramSnapshot } from '../core/rapid/program-executor'

interface Props {
  snapshot: ProgramSnapshot
}

const props = defineProps<Props>()

const emit = defineEmits<{
  run: []
  pause: []
  resume: []
  stop: []
  reset: []
}>()

const STATE_LABEL: Record<ProgramSnapshot['state'], string> = {
  idle: '空闲',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  stopped: '已停止',
  error: '错误',
}

const stateLabel = computed(() => STATE_LABEL[props.snapshot.state])

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
  return `指令 ${error.index} · ${error.code} — ${error.message}`
})
</script>

<template>
  <section class="program-panel" aria-labelledby="program-panel-title">
    <div class="panel-title-row">
      <div>
        <p class="panel-kicker">STRUCTURED PROGRAM</p>
        <h2 id="program-panel-title">内置演示程序</h2>
      </div>
      <span class="control-status" :class="`program-state-${props.snapshot.state}`">
        {{ stateLabel }}
      </span>
    </div>

    <p class="program-sequence">MoveJ → MoveL → MoveJ</p>

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

    <p class="program-error">规划错误：{{ errorText }}</p>
  </section>
</template>
