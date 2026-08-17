<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { JointAngles, PoseDisplay } from '@/robotics/types.ts'
import type { JointRange } from '@/robotics/robot-profile.ts'
import type { JointDirection, JointStep } from '@/application/joint-control.ts'
import { JOINT_STEPS } from '@/application/joint-control.ts'

interface Props {
  joints: JointAngles
  jointRanges: readonly JointRange[]
  jointStep: JointStep
  pose: PoseDisplay
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

function formatPoseValue(value: number): string {
  return value.toFixed(1)
}

onBeforeUnmount(stopPress)
</script>

<template>
  <section class="joint-panel" aria-labelledby="joint-panel-title">
    <div class="panel-title-row">
      <div>
        <p class="panel-kicker">JOINT SPACE CONTROL</p>
        <h2 id="joint-panel-title">六轴关节控制</h2>
      </div>
      <span class="control-status">FK READY</span>
    </div>

    <div class="joint-list">
      <article v-for="(angle, index) in props.joints" :key="index" class="joint-row">
        <div class="joint-row-head">
          <span class="joint-name">J{{ index + 1 }}</span>
          <button
            type="button"
            class="step-button"
            :aria-label="`J${index + 1} 减小角度`"
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
          <span class="degree-symbol">°</span>
          <button
            type="button"
            class="step-button"
            :aria-label="`J${index + 1} 增加角度`"
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
        </div>
        <input
          class="joint-slider"
          type="range"
          :min="props.jointRanges[index][0]"
          :max="props.jointRanges[index][1]"
          step="0.1"
          :value="angle"
          :aria-label="`J${index + 1} 角度滑块`"
          @input="handleAngleChange(index, $event)"
        />
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
        @click="emit('step-change', step)"
      >
        {{ step }}°
      </button>
    </div>

    <div class="panel-actions">
      <button type="button" class="secondary-action" @click="emit('reset')">回零</button>
      <button type="button" class="secondary-action" @click="emit('random')">随机姿态</button>
    </div>

    <div class="pose-card" aria-label="正解结果">
      <div class="pose-card-title">当前正解末端位姿</div>
      <div class="pose-grid">
        <span
          >P X <strong>{{ formatPoseValue(props.pose.positionMm[0]) }}</strong> mm</span
        >
        <span
          >P Y <strong>{{ formatPoseValue(props.pose.positionMm[1]) }}</strong> mm</span
        >
        <span
          >P Z <strong>{{ formatPoseValue(props.pose.positionMm[2]) }}</strong> mm</span
        >
        <span
          >R X <strong>{{ formatPoseValue(props.pose.orientationDeg[0]) }}</strong
          >°</span
        >
        <span
          >R Y <strong>{{ formatPoseValue(props.pose.orientationDeg[1]) }}</strong
          >°</span
        >
        <span
          >R Z <strong>{{ formatPoseValue(props.pose.orientationDeg[2]) }}</strong
          >°</span
        >
      </div>
    </div>

    <p class="panel-hint">点击步进按钮单次调整，按住按钮可连续调整。</p>
  </section>
</template>

<style scoped>
.joint-panel {
  display: grid;
  gap: 16px;
  padding-top: 4px;
}

.joint-panel h2 {
  color: var(--color-text-strong);
  font-size: 19px;
  letter-spacing: -0.03em;
}

.joint-list {
  display: grid;
  gap: 13px;
}

.joint-row {
  display: grid;
  gap: 8px;
}

.joint-row-head {
  display: grid;
  grid-template-columns: 28px 28px minmax(54px, 1fr) 10px 28px auto;
  align-items: center;
  gap: 5px;
}

.joint-name {
  color: var(--color-brand);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
}

.angle-input {
  width: 100%;
  min-width: 0;
  padding: 5px 4px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-xs);
  outline: none;
  color: var(--color-text-strong);
  background: var(--color-surface);
  font-family: var(--font-mono);
  font-size: 12px;
  text-align: center;
}

.angle-input:focus {
  border-color: var(--color-brand-strong);
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.16);
}

.joint-range {
  color: var(--color-text-dim);
  font-size: 10px;
  white-space: nowrap;
}

.joint-slider {
  width: 100%;
  height: 5px;
  accent-color: var(--color-brand-strong);
  cursor: pointer;
}

.panel-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/* Compact layout overrides applied when nested inside the jog tab panel. */
.jog-tabpanel > .joint-panel {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  gap: 2px;
}

.jog-tabpanel .joint-list {
  gap: 4px;
}

.jog-tabpanel .joint-row {
  gap: 3px;
}
</style>
