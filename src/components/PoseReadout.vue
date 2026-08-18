<script setup lang="ts">
import { computed } from 'vue'
import type { PoseDisplay } from '@/robotics/types.ts'
import { injectRobotController } from '@/application/use-robot-controller.ts'

interface Props {
  /** 独立挂载（测试）时直接传入；真实应用里优先使用共享机器人控制器的 pose。 */
  pose?: PoseDisplay
}

const props = defineProps<Props>()

const EMPTY_POSE: PoseDisplay = { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }

const controller = injectRobotController()
const pose = computed(() => controller?.pose.value ?? props.pose ?? EMPTY_POSE)

function format(value: number): string {
  return value.toFixed(1)
}
</script>

<template>
  <section class="pose-card pose-readout" aria-label="正解结果">
    <div class="pose-readout-title">当前位姿（World 坐标值）</div>
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
  </section>
</template>

<style scoped>
.pose-readout {
  padding: 10px 16px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.pose-readout-title {
  margin-bottom: 6px;
  color: var(--color-text-dim);
  font-size: 11px;
}

/* 六格读数：X/Y/Z/RX/RY/RZ，跨功能共享的统一格式；无盒子，hairline 分隔。 */
.pose-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px 0;
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
  color: var(--color-text-dim);
  font-size: 10px;
}

.pose-cell strong {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
