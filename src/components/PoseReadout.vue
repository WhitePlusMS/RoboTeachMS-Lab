<script setup lang="ts">
import { computed, ref } from 'vue'
import { Axis3d, Rotate3d } from '@lucide/vue'
import type { PoseDisplay } from '@/robotics/types.ts'
import { injectRobotController } from '@/application/use-robot-controller.ts'
import { eulerZYXToMatrix } from '@/robotics/matrix4x4.ts'
import { rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'

interface Props {
  /** 独立挂载（测试）时直接传入；真实应用里优先使用共享机器人控制器的 pose。 */
  pose?: PoseDisplay
  /** 紧凑模式：作为半透明角标叠放在 3D 场景角落，而非面板底部的大卡片。 */
  compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  compact: false,
})

const EMPTY_POSE: PoseDisplay = { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }

const controller = injectRobotController()
const pose = computed(() => controller?.pose.value ?? props.pose ?? EMPTY_POSE)

/** 姿态表示方式：false=欧拉角(RX/RY/RZ)、true=ABB RAPID 四元数(q1/q2/q3/q4，q1 为标量 w)。 */
const orientationAsQuat = ref(false)

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
</script>

<template>
  <section
    class="pose-card pose-readout"
    :class="{ compact }"
    aria-label="正解结果"
  >
    <div class="pose-readout-title">
      <span>{{ compact ? '位姿' : '当前位姿（World 坐标值）' }}</span>
      <div class="orientation-toggle" role="group" aria-label="姿态表示方式">
        <button
          type="button"
          :class="{ active: !orientationAsQuat }"
          :aria-label="'欧拉角 RX/RY/RZ'"
          :title="'欧拉角 RX/RY/RZ'"
          @click="orientationAsQuat = false"
        >
          <Axis3d :size="13" />
        </button>
        <button
          type="button"
          :class="{ active: orientationAsQuat }"
          :aria-label="'RAPID 四元数 q1..q4'"
          :title="'RAPID 四元数 q1..q4'"
          @click="orientationAsQuat = true"
        >
          <Rotate3d :size="13" />
        </button>
      </div>
    </div>
    <div class="pose-grid">
      <div class="pose-cell">
        <span>X</span><strong>{{ format(pose.positionMm[0]) }}</strong>
      </div>
      <div class="pose-cell">
        <span>Y</span><strong>{{ format(pose.positionMm[1]) }}</strong>
      </div>
      <div class="pose-cell">
        <span>Z</span><strong>{{ format(pose.positionMm[2]) }}</strong>
      </div>
    </div>
    <div v-if="!orientationAsQuat" class="pose-grid">
      <div class="pose-cell">
        <span>RX</span><strong>{{ format(pose.orientationDeg[0]) }}</strong>
      </div>
      <div class="pose-cell">
        <span>RY</span><strong>{{ format(pose.orientationDeg[1]) }}</strong>
      </div>
      <div class="pose-cell">
        <span>RZ</span><strong>{{ format(pose.orientationDeg[2]) }}</strong>
      </div>
    </div>
    <div v-else class="pose-grid quat-grid">
      <div class="pose-cell">
        <span>q1</span><strong>{{ format(rapidQuat[0]) }}</strong>
      </div>
      <div class="pose-cell">
        <span>q2</span><strong>{{ format(rapidQuat[1]) }}</strong>
      </div>
      <div class="pose-cell">
        <span>q3</span><strong>{{ format(rapidQuat[2]) }}</strong>
      </div>
      <div class="pose-cell">
        <span>q4</span><strong>{{ format(rapidQuat[3]) }}</strong>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pose-readout {
  padding: 10px 16px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
}

/* 紧凑角标：半透明圆角小卡片，叠放于 3D 场景角落，不再占据面板底部大卡片。 */
.pose-readout.compact {
  padding: 8px 12px 9px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: rgba(13, 15, 19, 0.72);
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35);
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

.pose-readout.compact .pose-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 0;
  border: 0;
}

.pose-readout.compact .pose-cell span {
  font-size: 10px;
  letter-spacing: 0.03em;
}

.pose-readout.compact .pose-cell strong {
  font-size: 12px;
}

.pose-readout-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
  color: var(--color-text-dim);
  font-size: 11px;
}

/* 姿态表示切换：标题右侧的小分段按钮，切换 RX/RY/RZ 与 RAPID 四元数。
   置于场景角标（pointer-events:none）内时，仅按钮自身可点击，其余区域仍穿透画布。 */
.orientation-toggle {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-surface-deep, rgba(13, 15, 19, 0.6));
  pointer-events: auto;
}

.orientation-toggle button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 3px;
  border: 0;
  border-radius: 4px;
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
  font-size: 11px;
}

.pose-cell strong {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
