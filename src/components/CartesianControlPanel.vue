<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { CartesianAxis, CoordinateSystem } from '@/robotics/types.ts'
import type {
  CartesianDirection,
  CartesianStatus,
  OrientationStep,
  PositionStep,
} from '@/application/cartesian-control.ts'
import { ORIENTATION_STEPS, POSITION_STEPS } from '@/application/cartesian-control.ts'

interface Props {
  coordinateSystem: CoordinateSystem
  positionStep: PositionStep
  orientationStep: OrientationStep
  status: CartesianStatus
  statusMessage: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  move: [axis: CartesianAxis, direction: CartesianDirection, isContinuous?: boolean]
  'coordinate-change': [value: CoordinateSystem]
  'position-step-change': [value: number]
  'orientation-step-change': [value: number]
}>()

const coordinateSystems = ['World', 'Tool'] as const

/** 动作模式：平移（X/Y/Z）或旋转（RX/RY/RZ），仅切换方向键盘映射与提示。 */
type CartMode = 'trans' | 'rot'
const mode = ref<CartMode>('trans')

interface DpadKey {
  axis: CartesianAxis
  direction: CartesianDirection
  icon: string
  name: string
}

interface DpadConfig {
  tag: string
  hint: string
  up: DpadKey
  down: DpadKey
  left: DpadKey
  right: DpadKey
  zUp: DpadKey
  zDown: DpadKey
}

const DPAD_CONFIGS: Record<CartMode, DpadConfig> = {
  trans: {
    tag: 'XY',
    hint: '方向键 · X / Y 平移，右侧 Z 升降',
    up: { axis: 'y', direction: 1, icon: '↑', name: 'Y 增加' },
    down: { axis: 'y', direction: -1, icon: '↓', name: 'Y 减小' },
    left: { axis: 'x', direction: -1, icon: '←', name: 'X 减小' },
    right: { axis: 'x', direction: 1, icon: '→', name: 'X 增加' },
    zUp: { axis: 'z', direction: 1, icon: '⇧', name: 'Z 增加' },
    zDown: { axis: 'z', direction: -1, icon: '⇩', name: 'Z 减小' },
  },
  rot: {
    tag: 'R',
    hint: '方向键 · RX / RY 旋转，右侧 RZ 正反转',
    up: { axis: 'rx', direction: 1, icon: '↑', name: 'RX 增加' },
    down: { axis: 'rx', direction: -1, icon: '↓', name: 'RX 减小' },
    left: { axis: 'ry', direction: -1, icon: '←', name: 'RY 减小' },
    right: { axis: 'ry', direction: 1, icon: '→', name: 'RY 增加' },
    zUp: { axis: 'rz', direction: 1, icon: '↻', name: 'RZ 增加' },
    zDown: { axis: 'rz', direction: -1, icon: '↺', name: 'RZ 减小' },
  },
}

const dpad = computed(() => DPAD_CONFIGS[mode.value])

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

    <div>
      <span class="field-label">坐标系</span>
      <div class="seg" aria-label="坐标系选择">
        <button
          v-for="frame in coordinateSystems"
          :key="frame"
          type="button"
          :class="{ on: props.coordinateSystem === frame }"
          :aria-pressed="props.coordinateSystem === frame"
          @click="emit('coordinate-change', frame)"
        >
          {{ frame }}
        </button>
      </div>
    </div>

    <div>
      <span class="field-label">动作模式</span>
      <div class="seg" aria-label="动作模式">
        <button
          type="button"
          :class="{ on: mode === 'trans' }"
          :aria-pressed="mode === 'trans'"
          @click="mode = 'trans'"
        >
          平移
        </button>
        <button
          type="button"
          :class="{ on: mode === 'rot' }"
          :aria-pressed="mode === 'rot'"
          @click="mode = 'rot'"
        >
          旋转
        </button>
      </div>
    </div>

    <div>
      <span class="field-label">{{ dpad.hint }}</span>
      <div class="dpad-wrap">
        <div class="dpad" aria-label="方向键">
          <span></span>
          <button
            type="button"
            :aria-label="dpad.up.name"
            @pointerdown="startPress(dpad.up.axis, dpad.up.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
          >
            {{ dpad.up.icon }}
          </button>
          <span></span>
          <button
            type="button"
            :aria-label="dpad.left.name"
            @pointerdown="startPress(dpad.left.axis, dpad.left.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
          >
            {{ dpad.left.icon }}
          </button>
          <span class="dpad-tag">{{ dpad.tag }}</span>
          <button
            type="button"
            :aria-label="dpad.right.name"
            @pointerdown="startPress(dpad.right.axis, dpad.right.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
          >
            {{ dpad.right.icon }}
          </button>
          <span></span>
          <button
            type="button"
            :aria-label="dpad.down.name"
            @pointerdown="startPress(dpad.down.axis, dpad.down.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
          >
            {{ dpad.down.icon }}
          </button>
          <span></span>
        </div>
        <div class="zpad" aria-label="第三轴">
          <button
            type="button"
            :aria-label="dpad.zUp.name"
            @pointerdown="startPress(dpad.zUp.axis, dpad.zUp.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
          >
            {{ dpad.zUp.icon }}
          </button>
          <button
            type="button"
            :aria-label="dpad.zDown.name"
            @pointerdown="startPress(dpad.zDown.axis, dpad.zDown.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
          >
            {{ dpad.zDown.icon }}
          </button>
        </div>
      </div>
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
        当前显示为世界坐标值，方向键按 {{ props.coordinateSystem }} 坐标系执行。
      </p>
    </div>
  </section>
</template>

<style scoped>
.cartesian-panel {
  display: grid;
  gap: 14px;
  padding: 14px 16px;
  border-top: 1px solid var(--color-border);
}

.cartesian-panel h2 {
  color: var(--color-text-strong);
  font-size: 15px;
  letter-spacing: -0.02em;
}

.cartesian-status-solved {
  border-color: rgba(62, 207, 142, 0.4);
  color: var(--color-success-soft);
}

.cartesian-status-position-fallback {
  border-color: rgba(245, 197, 66, 0.4);
  color: var(--color-warning);
}

.cartesian-status-invalid,
.cartesian-status-unreachable {
  border-color: rgba(242, 109, 109, 0.4);
  color: var(--color-danger-faint);
}

/* 方向键盘：44px 键位，中央轴标签；右列第三轴升降/正反转。 */
.dpad-wrap {
  display: grid;
  grid-template-columns: auto auto;
  gap: 14px;
  align-items: center;
  justify-content: center;
}

.dpad {
  display: grid;
  grid-template-columns: repeat(3, 44px);
  grid-template-rows: repeat(3, 44px);
  gap: 4px;
}

.zpad {
  display: grid;
  grid-template-rows: 44px 44px;
  gap: 4px;
  width: 44px;
}

.dpad button,
.zpad button {
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 16px;
  user-select: none;
  touch-action: none;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.dpad button:hover,
.zpad button:hover {
  border-color: var(--color-brand);
  color: var(--color-brand-soft);
}

.dpad button:active,
.zpad button:active {
  background: var(--color-brand-dim);
}

.dpad-tag {
  display: grid;
  place-items: center;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: 11px;
}

/* Compact layout override when nested inside the jog tab panel. */
.jog-tabpanel > .cartesian-panel {
  height: 100%;
  min-height: 0;
  gap: 12px;
}
</style>
