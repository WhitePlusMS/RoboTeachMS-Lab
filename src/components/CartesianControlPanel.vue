<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { CartesianAxis, CoordinateSystem, PoseDisplay } from '@/robotics/types.ts'
import type {
  CartesianDirection,
  CartesianStatus,
  OrientationStep,
  PositionStep,
} from '@/application/cartesian-control.ts'
import { ORIENTATION_STEPS, POSITION_STEPS } from '@/application/cartesian-control.ts'

interface Props {
  pose: PoseDisplay
  coordinateSystem: CoordinateSystem
  positionStep: PositionStep
  orientationStep: OrientationStep
  status: CartesianStatus
  statusMessage: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  move: [axis: CartesianAxis, direction: CartesianDirection, isContinuous?: boolean]
  'set-field': [axis: CartesianAxis, value: number]
  'coordinate-change': [value: CoordinateSystem]
  'position-step-change': [value: number]
  'orientation-step-change': [value: number]
}>()

const controls: readonly { axis: CartesianAxis; label: string; unit: string; index: number }[] = [
  { axis: 'x', label: 'X', unit: 'mm', index: 0 },
  { axis: 'y', label: 'Y', unit: 'mm', index: 1 },
  { axis: 'z', label: 'Z', unit: 'mm', index: 2 },
  { axis: 'rx', label: 'RX', unit: '°', index: 0 },
  { axis: 'ry', label: 'RY', unit: '°', index: 1 },
  { axis: 'rz', label: 'RZ', unit: '°', index: 2 },
]
const coordinateSystems = ['World', 'Tool'] as const

interface ActivePress {
  axis: CartesianAxis
  direction: CartesianDirection
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

function startPress(axis: CartesianAxis, direction: CartesianDirection): void {
  stopPress()
  const press: ActivePress = {
    axis,
    direction,
    timeoutId: 0,
    intervalId: null,
    repeated: false,
  }
  press.timeoutId = window.setTimeout(() => {
    press.repeated = true
    press.intervalId = window.setInterval(() => {
      emit('move', press.axis, press.direction, true)
    }, 100)
  }, 180)
  activePress.value = press
}

function finishPress(): void {
  const press = activePress.value
  if (!press) return
  if (!press.repeated) emit('move', press.axis, press.direction, false)
  stopPress()
}

function handleFieldChange(axis: CartesianAxis, event: Event): void {
  const input = event.target as HTMLInputElement | null
  if (!input) return
  const rawValue = input.value.trim()
  emit('set-field', axis, rawValue === '' ? Number.NaN : Number(rawValue))
}

function valueFor(control: (typeof controls)[number]): number {
  return control.axis === 'x' || control.axis === 'y' || control.axis === 'z'
    ? props.pose.positionMm[control.index]
    : props.pose.orientationDeg[control.index]
}

onBeforeUnmount(stopPress)
</script>

<template>
  <section class="cartesian-panel" aria-labelledby="cartesian-panel-title">
    <div class="panel-title-row">
      <div>
        <p class="panel-kicker">CARTESIAN CONTROL</p>
        <h2 id="cartesian-panel-title">笛卡尔位姿控制</h2>
      </div>
      <span class="control-status" :class="`cartesian-status-${props.status}`">
        {{ props.status === 'solved' ? 'PATH OK' : props.status.toUpperCase() }}
      </span>
    </div>

    <div class="frame-selector" aria-label="坐标系选择">
      <span>坐标系</span>
      <button
        v-for="frame in coordinateSystems"
        :key="frame"
        type="button"
        :class="['frame-choice', { active: props.coordinateSystem === frame }]"
        :aria-pressed="props.coordinateSystem === frame"
        @click="emit('coordinate-change', frame)"
      >
        {{ frame }}
      </button>
    </div>

    <div class="cartesian-list">
      <article v-for="control in controls" :key="control.axis" class="cartesian-row">
        <span class="cartesian-label">{{ control.label }}</span>
        <button
          type="button"
          class="step-button"
          :aria-label="`${control.label} 减小`"
          @pointerdown="startPress(control.axis, -1)"
          @pointerup="finishPress"
          @pointerleave="finishPress"
          @pointercancel="finishPress"
        >
          −
        </button>
        <input
          class="cartesian-input"
          type="number"
          step="0.1"
          :value="valueFor(control).toFixed(1)"
          :aria-label="`${control.label} 数值输入`"
          @change="handleFieldChange(control.axis, $event)"
        />
        <span class="degree-symbol">{{ control.unit }}</span>
        <button
          type="button"
          class="step-button"
          :aria-label="`${control.label} 增加`"
          @pointerdown="startPress(control.axis, 1)"
          @pointerup="finishPress"
          @pointerleave="finishPress"
          @pointercancel="finishPress"
        >
          +
        </button>
      </article>
    </div>

    <div class="step-selector" aria-label="位置步进选择">
      <span>位置步进</span>
      <button
        v-for="step in POSITION_STEPS"
        :key="`position-${step}`"
        type="button"
        :class="['step-choice', { active: props.positionStep === step }]"
        @click="emit('position-step-change', step)"
      >
        {{ step }} mm
      </button>
    </div>

    <div class="step-selector" aria-label="姿态步进选择">
      <span>姿态步进</span>
      <button
        v-for="step in ORIENTATION_STEPS"
        :key="`orientation-${step}`"
        type="button"
        :class="['step-choice', { active: props.orientationStep === step }]"
        @click="emit('orientation-step-change', step)"
      >
        {{ step }}°
      </button>
    </div>

    <div class="pose-card" aria-label="笛卡尔控制状态">
      <div class="pose-card-title">{{ props.statusMessage }}</div>
      <p class="panel-hint">
        当前显示为世界坐标值，方向按钮按 {{ props.coordinateSystem }} 坐标系执行。
      </p>
    </div>
  </section>
</template>

<style scoped>
.cartesian-panel {
  display: grid;
  gap: 14px;
  padding-top: 4px;
  border-top: 1px solid var(--color-border);
}

.cartesian-panel h2 {
  color: var(--color-text-strong);
  font-size: 19px;
  letter-spacing: -0.03em;
}

.cartesian-status-solved {
  border-color: rgba(52, 211, 153, 0.4);
  color: var(--color-success-soft);
}

.cartesian-status-position-fallback {
  border-color: rgba(251, 191, 36, 0.4);
  color: var(--color-warning);
}

.cartesian-status-invalid,
.cartesian-status-unreachable {
  border-color: rgba(251, 113, 133, 0.4);
  color: var(--color-danger-faint);
}

.cartesian-list {
  display: grid;
  gap: 8px;
}

.cartesian-row {
  display: grid;
  grid-template-columns: 30px 28px minmax(60px, 1fr) 18px 28px;
  align-items: center;
  gap: 5px;
}

.cartesian-label {
  color: var(--color-brand);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.cartesian-input {
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

.cartesian-input:focus {
  border-color: var(--color-brand-strong);
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.16);
}

/* Compact layout override when nested inside the jog tab panel. */
.jog-tabpanel > .cartesian-panel {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  gap: 10px;
}
</style>
