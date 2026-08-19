<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Home } from '@lucide/vue'
import type { JointAngles } from '@/robotics/types.ts'
import type { JointRange } from '@/robotics/robot-profile.ts'
import type { JointDirection, JointStep } from '@/application/joint-control.ts'
import { JOINT_STEPS } from '@/application/joint-control.ts'

interface Props {
  joints: JointAngles
  jointRanges: readonly JointRange[]
  jointStep: JointStep
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'set-joint': [index: number, value: number]
  'adjust-joint': [index: number, direction: JointDirection, isContinuous?: boolean]
  'step-change': [value: number]
  reset: []
  random: []
}>()

interface ActivePress {
  index: number
  direction: JointDirection
  timeoutId: number
  intervalId: number | null
  repeated: boolean
}

const activePress = ref<ActivePress | null>(null)

function stopPress(): void {
  const press = activePress.value
  if (!press) return
  window.clearTimeout(press.timeoutId)
  if (press.intervalId !== null) window.clearInterval(press.intervalId)
  activePress.value = null
}

function startPress(index: number, direction: JointDirection): void {
  stopPress()
  const press: ActivePress = {
    index,
    direction,
    timeoutId: 0,
    intervalId: null,
    repeated: false,
  }
  press.timeoutId = window.setTimeout(() => {
    press.repeated = true
    press.intervalId = window.setInterval(() => {
      emit('adjust-joint', press.index, press.direction, true)
    }, 80)
  }, 180)
  activePress.value = press
}

function finishPress(): void {
  const press = activePress.value
  if (!press) return
  if (!press.repeated) emit('adjust-joint', press.index, press.direction, false)
  stopPress()
}

function handleAngleChange(index: number, event: Event): void {
  const input = event.target as HTMLInputElement | null
  if (!input) return
  emit('set-joint', index, Number(input.value))
}

onBeforeUnmount(stopPress)
</script>

<template>
  <section class="joint-panel" aria-labelledby="joint-panel-title">
    <div class="panel-title-row">
      <div>
        <h2 id="joint-panel-title">六轴关节控制</h2>
      </div>
      <span class="control-status">FK READY</span>
    </div>

    <div class="panel-actions">
      <button
        type="button"
        class="secondary-action home-action"
        title="机器人回到零位姿态"
        @click="emit('reset')"
      >
        <Home :size="14" />回零
      </button>
      <button
        type="button"
        class="secondary-action"
        title="随机生成一组关节姿态"
        @click="emit('random')"
      >
        随机姿态
      </button>
    </div>

    <div class="joint-list">
      <article v-for="(angle, index) in props.joints" :key="index" class="joint-row">
        <span class="joint-name">J{{ index + 1 }}</span>
        <button
          type="button"
          class="step-button"
          :aria-label="`J${index + 1} 减小角度`"
          :title="`J${index + 1} 减小角度（按住连续）`"
          @pointerdown="startPress(index, -1)"
          @pointerup="finishPress"
          @pointerleave="finishPress"
          @pointercancel="finishPress"
        >
          −
        </button>
        <input
          class="angle-input"
          type="number"
          step="0.1"
          :min="props.jointRanges[index][0]"
          :max="props.jointRanges[index][1]"
          :value="angle.toFixed(1)"
          :aria-label="`J${index + 1} 角度输入`"
          @change="handleAngleChange(index, $event)"
        />
        <button
          type="button"
          class="step-button"
          :aria-label="`J${index + 1} 增加角度`"
          :title="`J${index + 1} 增加角度（按住连续）`"
          @pointerdown="startPress(index, 1)"
          @pointerup="finishPress"
          @pointerleave="finishPress"
          @pointercancel="finishPress"
        >
          +
        </button>
        <span class="joint-range"
          >{{ props.jointRanges[index][0] }}° ~ {{ props.jointRanges[index][1] }}°</span
        >
      </article>
    </div>

    <div class="step-selector" aria-label="关节步进选择">
      <span>步进</span>
      <button
        v-for="step in JOINT_STEPS"
        :key="step"
        type="button"
        :class="['step-choice', { active: props.jointStep === step }]"
        :aria-pressed="props.jointStep === step"
        :title="`设为步进 ${step}°`"
        @click="emit('step-change', step)"
      >
        {{ step }}°
      </button>
    </div>
  </section>
</template>

<style scoped>
.joint-panel {
  display: grid;
  gap: 14px;
  padding: 14px 16px;
}

.joint-panel h2 {
  color: var(--color-text-strong);
  font-size: var(--text-2xl);
  letter-spacing: -0.02em;
}

.joint-list {
  display: grid;
  gap: 10px;
}

/* 关节行：J 名 − 值 + 量程（无拖动条）。 */
.joint-row {
  display: grid;
  grid-template-columns: 24px 30px minmax(0, 1fr) 30px auto;
  align-items: center;
  gap: 6px;
}

.joint-name {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  font-weight: 700;
}

.step-button {
  width: 30px;
  height: 30px;
  font-size: var(--text-2xl);
}

.angle-input {
  width: 100%;
  min-width: 0;
  padding: 6px 4px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  outline: none;
  color: var(--color-text-strong);
  background: var(--color-editor);
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.angle-input:focus {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand) 18%, transparent);
}

.joint-range {
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.panel-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.home-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

/* Compact layout overrides applied when nested inside the jog tab panel.
   外层 .jog-control-tabs 已有横向 padding，内层归零避免双层内边距。 */
.jog-tabpanel > .joint-panel {
  height: 100%;
  min-height: 0;
  gap: 10px;
  padding: 0;
  align-content: start;
}
</style>
