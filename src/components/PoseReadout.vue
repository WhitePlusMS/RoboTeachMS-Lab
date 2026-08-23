<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Axis3d, Copy, Rotate3d, SlidersHorizontal } from '@lucide/vue'
import type { JointAngles, PoseDisplay } from '@/robotics/types.ts'
import { injectRobotController } from '@/application/use-robot-controller.ts'
import { eulerZYXToMatrix } from '@/robotics/matrix4x4.ts'
import { rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'

interface Props {
  /** 独立挂载（测试）时直接传入；真实应用里优先使用共享机器人控制器的 pose。 */
  pose?: PoseDisplay
  /** 独立挂载（测试）时直接传入；真实应用里优先使用共享机器人控制器的六轴关节。 */
  joints?: JointAngles
  /** 紧凑模式：作为半透明角标叠放在 3D 场景角落，而非面板底部的大卡片。 */
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  pose: undefined,
  joints: undefined,
  compact: false,
})

const EMPTY_POSE: PoseDisplay = { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }
const EMPTY_JOINTS: JointAngles = [0, 0, 0, 0, 0, 0]

const controller = injectRobotController()
const pose = computed(() => controller?.pose.value ?? props.pose ?? EMPTY_POSE)
const joints = computed(() => controller?.joints.value ?? props.joints ?? EMPTY_JOINTS)

type ReadoutMode = 'euler' | 'quat' | 'joints'

/** 读数方式：笛卡尔欧拉角、ABB RAPID 四元数，或六轴关节角。 */
const readoutMode = ref<ReadoutMode>('euler')
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')
let copyResetTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 由欧拉角(RX/RY/RZ，ZYX 顺序)换算为 RAPID 四元数 [q1,q2,q3,q4]（q1=w），
 * 与 RAPID robtarget.rot 记录形状一致，便于与源码点位对照。
 */
const rapidQuat = computed<[number, number, number, number]>(() => {
  const deg = pose.value.orientationDeg
  const rotation = eulerZYXToMatrix(deg.map((value) => (value * Math.PI) / 180) as [
    number,
    number,
    number,
  ])
  const [qx, qy, qz, qw] = rotationMatrixToQuaternion(rotation)
  return [qw, qx, qy, qz]
})

function format(value: number): string {
  return value.toFixed(1)
}

const readoutCells = computed(() => {
  if (readoutMode.value === 'joints') {
    return joints.value.map((value, index) => ({
      label: `J${index + 1}`,
      value: format(value),
    }))
  }
  if (readoutMode.value === 'quat') {
    return [
      { label: 'X', value: format(pose.value.positionMm[0]) },
      { label: 'Y', value: format(pose.value.positionMm[1]) },
      { label: 'Z', value: format(pose.value.positionMm[2]) },
      { label: 'q1', value: format(rapidQuat.value[0]) },
      { label: 'q2', value: format(rapidQuat.value[1]) },
      { label: 'q3', value: format(rapidQuat.value[2]) },
      { label: 'q4', value: format(rapidQuat.value[3]) },
    ]
  }
  return [
    { label: 'X', value: format(pose.value.positionMm[0]) },
    { label: 'Y', value: format(pose.value.positionMm[1]) },
    { label: 'Z', value: format(pose.value.positionMm[2]) },
    { label: 'RX', value: format(pose.value.orientationDeg[0]) },
    { label: 'RY', value: format(pose.value.orientationDeg[1]) },
    { label: 'RZ', value: format(pose.value.orientationDeg[2]) },
  ]
})

function setReadoutMode(mode: ReadoutMode): void {
  readoutMode.value = mode
  copyState.value = 'idle'
}

function copyFallback(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

async function copyReadout(): Promise<void> {
  const text = readoutCells.value.map(({ label, value }) => `${label}: ${value}`).join('\t')
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
    else if (!copyFallback(text)) throw new Error('clipboard-unavailable')
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
  if (copyResetTimer !== undefined) clearTimeout(copyResetTimer)
  copyResetTimer = setTimeout(() => {
    copyState.value = 'idle'
    copyResetTimer = undefined
  }, 1500)
}

onBeforeUnmount(() => {
  if (copyResetTimer !== undefined) clearTimeout(copyResetTimer)
})
</script>

<template>
  <section
    class="pose-card pose-readout"
    :class="{ compact }"
    aria-label="正解结果"
  >
    <div class="pose-readout-title">
      <span>{{ compact ? '位姿' : '当前位姿（World 坐标值）' }}</span>
      <div class="orientation-toggle" role="group" aria-label="位姿表示方式">
        <button
          type="button"
          :class="{ active: readoutMode === 'euler' }"
          :aria-pressed="readoutMode === 'euler'"
          aria-label="欧拉角 RX/RY/RZ"
          title="欧拉角 RX/RY/RZ"
          @click="setReadoutMode('euler')"
        >
          <Axis3d :size="13" />
        </button>
        <button
          type="button"
          :class="{ active: readoutMode === 'quat' }"
          :aria-pressed="readoutMode === 'quat'"
          aria-label="RAPID 四元数 q1..q4"
          title="RAPID 四元数 q1..q4"
          @click="setReadoutMode('quat')"
        >
          <Rotate3d :size="13" />
        </button>
        <button
          type="button"
          :class="{ active: readoutMode === 'joints' }"
          :aria-pressed="readoutMode === 'joints'"
          aria-label="六轴关节 J1..J6"
          title="六轴关节 J1..J6"
          @click="setReadoutMode('joints')"
        >
          <SlidersHorizontal :size="13" />
        </button>
      </div>
      <button
        type="button"
        class="copy-readout"
        :class="`copy-${copyState}`"
        :aria-label="copyState === 'copied' ? '已复制当前读数' : '复制当前读数'"
        :title="copyState === 'copied' ? '已复制当前读数' : '复制当前读数'"
        @click="copyReadout"
      >
        <Copy :size="13" />
      </button>
    </div>
    <template v-if="readoutMode === 'joints'">
      <div class="pose-grid joint-grid">
        <div v-for="cell in readoutCells.slice(0, 3)" :key="cell.label" class="pose-cell">
          <span>{{ cell.label }}</span><strong>{{ cell.value }}</strong>
        </div>
      </div>
      <div class="pose-grid joint-grid">
        <div v-for="cell in readoutCells.slice(3)" :key="cell.label" class="pose-cell">
          <span>{{ cell.label }}</span><strong>{{ cell.value }}</strong>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="pose-grid">
        <div v-for="cell in readoutCells.slice(0, 3)" :key="cell.label" class="pose-cell">
          <span>{{ cell.label }}</span><strong>{{ cell.value }}</strong>
        </div>
      </div>
      <div
        class="pose-grid"
        :class="{ 'quat-grid': readoutMode === 'quat' }"
      >
        <div v-for="cell in readoutCells.slice(3)" :key="cell.label" class="pose-cell">
          <span>{{ cell.label }}</span><strong>{{ cell.value }}</strong>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.pose-readout {
  padding: 10px 16px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
}

/* 紧凑角标：半透明圆角小卡片，叠放于 3D 场景角落，不再占据面板底部大卡片。
   背景用 color-mix 从 --color-overlay-bg 派生低透明度玻璃底，保留足够的透光
   让背面 backdrop-filter 的模糊清晰可见（--color-overlay-bg 本身是 0.88 近不透明白，
   直接用会盖住模糊、毛玻璃失效——见主题提交 f02e46a 的回归）。 */
.pose-readout.compact {
  padding: 8px 12px 9px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-overlay-bg) 60%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: var(--shadow-pop);
}

.pose-readout.compact .pose-readout-title {
  margin-bottom: 4px;
}

.pose-readout.compact .pose-grid {
  grid-template-columns: repeat(3, auto);
  gap: 2px 10px;
  justify-content: start;
}

.pose-readout.compact .pose-grid.quat-grid {
  grid-template-columns: repeat(4, auto);
  margin-top: 3px;
}

.pose-readout.compact .pose-grid.joint-grid {
  grid-template-columns: repeat(3, auto);
}

.pose-readout.compact .pose-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 0;
  border: 0;
}

.pose-readout.compact .pose-cell span {
  font-size: var(--text-xs);
  letter-spacing: 0.03em;
}

.pose-readout.compact .pose-cell strong {
  font-size: var(--text-md);
}

.pose-readout-title {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  margin-bottom: 6px;
  color: var(--color-text-dim);
  font-size: var(--text-sm);
}

/* 姿态表示切换：标题右侧的小分段按钮，切换 RX/RY/RZ 与 RAPID 四元数。
   置于场景角标（pointer-events:none）内时，仅按钮自身可点击，其余区域仍穿透画布。 */
.orientation-toggle {
  display: inline-flex;
  gap: 2px;
  margin-left: auto;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-surface-deep);
  pointer-events: auto;
}

.copy-readout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 6px);
  color: var(--color-text-faint);
  background: var(--color-surface-deep);
  cursor: pointer;
  pointer-events: auto;
}

.copy-readout:hover {
  border-color: var(--color-brand-strong);
  color: var(--color-text-strong);
}

.copy-readout.copy-copied {
  color: var(--color-success);
}

.copy-readout.copy-failed {
  color: var(--color-danger);
}

.orientation-toggle button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 3px;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-faint);
  line-height: 1;
  cursor: pointer;
}

.orientation-toggle button.active {
  background: var(--color-accent);
  color: var(--color-on-fill);
}

/* 六格读数：X/Y/Z/RX/RY/RZ，跨功能共享的统一格式；无盒子，hairline 分隔。 */
.pose-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px 0;
}

/* 四元数模式：q1..q4 单行四列，与 X/Y/Z 行分隔，保持排版整洁。 */
.pose-grid.quat-grid {
  grid-template-columns: repeat(4, 1fr);
  margin-top: 4px;
}

/* 非紧凑四元数行：四列等宽，标签与格线统一（紧凑角标保持细线无边框）。 */
.pose-readout:not(.compact) .pose-grid.quat-grid .pose-cell {
  padding-left: 10px;
}

.pose-readout:not(.compact) .pose-grid.quat-grid .pose-cell:first-child {
  padding-left: 0;
}

.pose-readout:not(.compact) .pose-grid.quat-grid .pose-cell:not(:first-child) {
  border-left: 1px solid var(--color-border);
}

.pose-cell {
  padding: 3px 10px;
  user-select: text;
}

.pose-cell:nth-child(3n + 1) {
  padding-left: 0;
}

.pose-cell:nth-child(3n + 2),
.pose-cell:nth-child(3n) {
  border-left: 1px solid var(--color-border);
}

.pose-cell span {
  display: block;
  color: var(--color-text-faint);
  font-size: var(--text-sm);
}

.pose-cell strong {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
