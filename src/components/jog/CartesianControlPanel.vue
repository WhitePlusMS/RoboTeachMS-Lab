<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Component } from 'vue'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  RotateCw,
} from '@lucide/vue'
import PoseQuickActions from './PoseQuickActions.vue'
import type { CartesianAxis, CoordinateSystem } from '@/application/motion/cartesian-types.ts'
import type {
  CartesianDirection,
  CartesianStatus,
  OrientationStep,
  PositionStep,
} from '@/application/motion/cartesian-math.ts'
import { ORIENTATION_STEPS, POSITION_STEPS } from '@/application/motion/cartesian-math.ts'

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
  'continuous-start': [axis: CartesianAxis, direction: CartesianDirection]
  'continuous-end': []
  'coordinate-change': [value: CoordinateSystem]
  'position-step-change': [value: number]
  'orientation-step-change': [value: number]
  reset: []
  'mechanical-zero': []
  random: []
}>()

const coordinateSystems = ['World', 'Tool'] as const

/** 动作模式：平移（X/Y/Z）或旋转（RX/RY/RZ），仅切换方向键盘映射与提示。 */
type CartMode = 'trans' | 'rot'
const mode = ref<CartMode>('trans')

interface DpadKey {
  axis: CartesianAxis
  direction: CartesianDirection
  icon: Component
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
    up: { axis: 'y', direction: 1, icon: ArrowUp, name: 'Y 增加' },
    down: { axis: 'y', direction: -1, icon: ArrowDown, name: 'Y 减小' },
    left: { axis: 'x', direction: -1, icon: ArrowLeft, name: 'X 减小' },
    right: { axis: 'x', direction: 1, icon: ArrowRight, name: 'X 增加' },
    zUp: { axis: 'z', direction: 1, icon: ChevronUp, name: 'Z 增加' },
    zDown: { axis: 'z', direction: -1, icon: ChevronDown, name: 'Z 减小' },
  },
  rot: {
    tag: 'R',
    hint: '方向键 · RX / RY 旋转，右侧 RZ 正反转',
    up: { axis: 'rx', direction: 1, icon: ArrowUp, name: 'RX 增加' },
    down: { axis: 'rx', direction: -1, icon: ArrowDown, name: 'RX 减小' },
    left: { axis: 'ry', direction: -1, icon: ArrowLeft, name: 'RY 减小' },
    right: { axis: 'ry', direction: 1, icon: ArrowRight, name: 'RY 增加' },
    zUp: { axis: 'rz', direction: 1, icon: RotateCw, name: 'RZ 增加' },
    zDown: { axis: 'rz', direction: -1, icon: RotateCcw, name: 'RZ 减小' },
  },
}

const dpad = computed(() => DPAD_CONFIGS[mode.value])

interface ActivePress {
  axis: CartesianAxis
  direction: CartesianDirection
  timeoutId: number
  repeated: boolean
}

const activePress = ref<ActivePress | null>(null)

function stopPress(): void {
  const press = activePress.value
  if (!press) return
  window.clearTimeout(press.timeoutId)
  activePress.value = null
}

function startPress(axis: CartesianAxis, direction: CartesianDirection): void {
  stopPress()
  const press: ActivePress = {
    axis,
    direction,
    timeoutId: 0,
    repeated: false,
  }
  press.timeoutId = window.setTimeout(() => {
    press.repeated = true
    emit('continuous-start', press.axis, press.direction)
  }, 180)
  activePress.value = press
}

function finishPress(): void {
  const press = activePress.value
  if (!press) return
  if (!press.repeated) emit('move', press.axis, press.direction, false)
  else emit('continuous-end')
  stopPress()
}

/**
 * 键盘激活（Enter/Space）产生的 click 其 detail 为 0，此时发单次移动；
 * 鼠标/触摸走 pointer 事件的按住连续逻辑，不处理 click，避免双重触发。
 */
function handleKeyClick(event: MouseEvent, key: DpadKey): void {
  if (event.detail !== 0) return
  emit('move', key.axis, key.direction, false)
}

onBeforeUnmount(() => {
  // 面板切换/卸载时不能只清理 DOM 定时器；控制器还需要结束自己的点动会话。
  if (activePress.value?.repeated) emit('continuous-end')
  stopPress()
})
</script>

<template>
  <section class="cartesian-panel" aria-labelledby="cartesian-panel-title">
    <div class="panel-title-row">
      <h2 id="cartesian-panel-title">笛卡尔位姿控制</h2>
      <span class="control-status" role="status" :class="`cartesian-status-${props.status}`">
        {{ props.status === 'solved' ? 'PATH OK' : props.status.toUpperCase() }}
      </span>
    </div>

    <PoseQuickActions
      @reset="emit('reset')"
      @mechanical-zero="emit('mechanical-zero')"
      @random="emit('random')"
    />

    <div>
      <span class="field-label">坐标系</span>
      <div class="seg" role="group" aria-label="坐标系选择">
        <button
          v-for="frame in coordinateSystems"
          :key="frame"
          type="button"
          :class="{ on: props.coordinateSystem === frame }"
          :aria-pressed="props.coordinateSystem === frame"
          :title="`切换到 ${frame} 坐标系`"
          @click="emit('coordinate-change', frame)"
        >
          {{ frame }}
        </button>
      </div>
    </div>

    <div>
      <span class="field-label">动作模式</span>
      <div class="seg" role="group" aria-label="动作模式">
        <button
          type="button"
          :class="{ on: mode === 'trans' }"
          :aria-pressed="mode === 'trans'"
          title="平移模式：沿 X/Y/Z 移动"
          @click="mode = 'trans'"
        >
          平移
        </button>
        <button
          type="button"
          :class="{ on: mode === 'rot' }"
          :aria-pressed="mode === 'rot'"
          title="旋转模式：绕 RX/RY/RZ 转动"
          @click="mode = 'rot'"
        >
          旋转
        </button>
      </div>
    </div>

    <div>
      <span class="field-label field-hint">{{ dpad.hint }}</span>
      <div class="dpad-wrap">
        <div class="dpad" role="group" aria-label="方向键">
          <span></span>
          <button
            type="button"
            :aria-label="dpad.up.name"
            :title="`${dpad.up.name}（按住连续）`"
            @pointerdown="startPress(dpad.up.axis, dpad.up.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
            @click="handleKeyClick($event, dpad.up)"
          >
            <component :is="dpad.up.icon" :size="16" aria-hidden="true" />
          </button>
          <span></span>
          <button
            type="button"
            :aria-label="dpad.left.name"
            :title="`${dpad.left.name}（按住连续）`"
            @pointerdown="startPress(dpad.left.axis, dpad.left.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
            @click="handleKeyClick($event, dpad.left)"
          >
            <component :is="dpad.left.icon" :size="16" aria-hidden="true" />
          </button>
          <span class="dpad-tag">{{ dpad.tag }}</span>
          <button
            type="button"
            :aria-label="dpad.right.name"
            :title="`${dpad.right.name}（按住连续）`"
            @pointerdown="startPress(dpad.right.axis, dpad.right.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
            @click="handleKeyClick($event, dpad.right)"
          >
            <component :is="dpad.right.icon" :size="16" aria-hidden="true" />
          </button>
          <span></span>
          <button
            type="button"
            :aria-label="dpad.down.name"
            :title="`${dpad.down.name}（按住连续）`"
            @pointerdown="startPress(dpad.down.axis, dpad.down.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
            @click="handleKeyClick($event, dpad.down)"
          >
            <component :is="dpad.down.icon" :size="16" aria-hidden="true" />
          </button>
          <span></span>
        </div>
        <div class="zpad" role="group" aria-label="第三轴">
          <button
            type="button"
            :aria-label="dpad.zUp.name"
            :title="`${dpad.zUp.name}（按住连续）`"
            @pointerdown="startPress(dpad.zUp.axis, dpad.zUp.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
            @click="handleKeyClick($event, dpad.zUp)"
          >
            <component :is="dpad.zUp.icon" :size="16" aria-hidden="true" />
          </button>
          <button
            type="button"
            :aria-label="dpad.zDown.name"
            :title="`${dpad.zDown.name}（按住连续）`"
            @pointerdown="startPress(dpad.zDown.axis, dpad.zDown.direction)"
            @pointerup="finishPress"
            @pointerleave="finishPress"
            @pointercancel="finishPress"
            @click="handleKeyClick($event, dpad.zDown)"
          >
            <component :is="dpad.zDown.icon" :size="16" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>

    <div class="step-selector" role="group" aria-label="位置步进选择">
      <span>位置步进</span>
      <button
        v-for="step in POSITION_STEPS"
        :key="`position-${step}`"
        type="button"
        :class="['step-choice', { active: props.positionStep === step }]"
        :aria-pressed="props.positionStep === step"
        :title="`设为位置步进 ${step} mm`"
        @click="emit('position-step-change', step)"
      >
        {{ step }} mm
      </button>
    </div>

    <div class="step-selector" role="group" aria-label="姿态步进选择">
      <span>姿态步进</span>
      <button
        v-for="step in ORIENTATION_STEPS"
        :key="`orientation-${step}`"
        type="button"
        :class="['step-choice', { active: props.orientationStep === step }]"
        :aria-pressed="props.orientationStep === step"
        :title="`设为姿态步进 ${step}°`"
        @click="emit('orientation-step-change', step)"
      >
        {{ step }}°
      </button>
    </div>

    <!-- ready 为静止默认态，由标题行状态徽章表达；卡片只在有实际消息（规划中/失败诊断等）时出现。 -->
    <div v-if="props.status !== 'ready'" class="pose-card" role="group" aria-label="笛卡尔控制状态">
      <div class="pose-card-title" role="status">{{ props.statusMessage }}</div>
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
  font-size: var(--text-2xl);
  letter-spacing: -0.02em;
}

/* 分组标签与操作提示分级：标签略强，提示文案保持弱化。 */
.cartesian-panel .field-label {
  color: var(--color-text-dim);
}

.cartesian-panel .field-hint {
  color: var(--color-text-faint);
}

.cartesian-status-solved {
  border-color: color-mix(in srgb, var(--color-success) 40%, transparent);
  color: var(--color-success-soft);
}

.cartesian-status-planning {
  border-color: color-mix(in srgb, var(--color-brand) 40%, transparent);
  color: var(--color-brand-soft);
}

.cartesian-status-wrist-solved {
  border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
  color: var(--color-warning);
}

.cartesian-status-invalid,
.cartesian-status-unreachable,
.cartesian-status-singularity,
.cartesian-status-reconfiguration,
.cartesian-status-joint-limit,
.cartesian-status-joint-step,
.cartesian-status-not-converged {
  border-color: color-mix(in srgb, var(--color-danger) 40%, transparent);
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
  font-size: var(--text-2xl);
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
  color: var(--color-text-dim);
  font-family: var(--font-mono);
  font-size: var(--text-md);
}

/* Compact layout override when nested inside the jog tab panel.
   外层 .jog-control-tabs 已有横向 padding，内层归零避免双层内边距；
   border-top 是旧版上下堆叠布局的分隔线，页签布局下不需要。 */
.jog-tabpanel > .cartesian-panel {
  height: 100%;
  min-height: 0;
  gap: 12px;
  padding: 0;
  border-top: none;
  align-content: start;
}
</style>
