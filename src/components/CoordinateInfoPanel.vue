<script setup lang="ts">
import type { PoseDisplay } from '@/robotics/model/types.ts'

defineProps<{
  toolPose: PoseDisplay
}>()

const basePose: PoseDisplay = {
  positionMm: [0, 0, 0],
  orientationDeg: [0, 0, 0],
}

function formatValue(value: number): string {
  return value.toFixed(1)
}
</script>

<template>
  <section class="coordinate-info-panel" aria-label="基坐标和工具坐标信息">
    <div class="panel-title-row">
      <div>
        <h2>坐标信息</h2>
      </div>
      <span class="coordinate-info-tag">BASE / TOOL</span>
    </div>

    <div class="coordinate-info-grid">
      <article class="coordinate-info-card coordinate-info-base">
        <div class="coordinate-info-heading">
          <span class="coordinate-info-dot" />
          <strong>基坐标系</strong>
          <small>BASE</small>
        </div>
        <div class="coordinate-info-values">
          <span>X {{ formatValue(basePose.positionMm[0]) }} mm</span>
          <span>Y {{ formatValue(basePose.positionMm[1]) }} mm</span>
          <span>Z {{ formatValue(basePose.positionMm[2]) }} mm</span>
          <span>Rx {{ formatValue(basePose.orientationDeg[0]) }}°</span>
          <span>Ry {{ formatValue(basePose.orientationDeg[1]) }}°</span>
          <span>Rz {{ formatValue(basePose.orientationDeg[2]) }}°</span>
        </div>
      </article>

      <article class="coordinate-info-card coordinate-info-tool">
        <div class="coordinate-info-heading">
          <span class="coordinate-info-dot" />
          <strong>工具坐标系</strong>
          <small>TOOL</small>
        </div>
        <div class="coordinate-info-values">
          <span>X {{ formatValue(toolPose.positionMm[0]) }} mm</span>
          <span>Y {{ formatValue(toolPose.positionMm[1]) }} mm</span>
          <span>Z {{ formatValue(toolPose.positionMm[2]) }} mm</span>
          <span>Rx {{ formatValue(toolPose.orientationDeg[0]) }}°</span>
          <span>Ry {{ formatValue(toolPose.orientationDeg[1]) }}°</span>
          <span>Rz {{ formatValue(toolPose.orientationDeg[2]) }}°</span>
        </div>
      </article>
    </div>

    <p class="panel-hint">基坐标固定在底座；工具坐标跟随末端法兰运动。</p>
  </section>
</template>

<style scoped>
.coordinate-info-panel {
  display: grid;
  gap: 14px;
  padding-top: 4px;
  border-top: 1px solid var(--color-border);
}

.coordinate-info-panel h2 {
  color: var(--color-text-strong);
  font-size: var(--text-3xl);
  letter-spacing: -0.03em;
}

.coordinate-info-grid {
  display: grid;
}

.coordinate-info-tag {
  padding: 3px 7px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-faint);
  background: transparent;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  letter-spacing: 0.06em;
}

.coordinate-info-card {
  padding: 10px 0;
}

.coordinate-info-card + .coordinate-info-card {
  border-top: 1px solid var(--color-border);
}

.coordinate-info-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.coordinate-info-heading small {
  margin-left: auto;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  letter-spacing: 0.08em;
}

.coordinate-info-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-info);
}

.coordinate-info-tool .coordinate-info-dot {
  background: var(--color-accent-orange);
}

.coordinate-info-values {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 8px;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.coordinate-info-values span {
  white-space: nowrap;
}
</style>
