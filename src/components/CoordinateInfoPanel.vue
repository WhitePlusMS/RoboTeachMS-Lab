<script setup lang="ts">
import type { PoseDisplay } from '../core/robot/types'

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
        <p class="panel-kicker">COORDINATE INFO</p>
        <h2>坐标信息</h2>
      </div>
      <span class="control-status">BASE / TOOL</span>
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
