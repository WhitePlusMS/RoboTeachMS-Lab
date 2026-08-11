<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { JointAngles } from '../robotics/types.ts'
import {
  createAbbScene,
  type AbbSceneController,
  type AbbSceneStatus,
} from '../scene/abb-scene.ts'

const props = defineProps<{
  joints: JointAngles
  showGrid: boolean
  showCoordinateSystems: boolean
  showDhDebug: boolean
  showTrajectory: boolean
  trajectoryCount: number
}>()

const emit = defineEmits<{
  status: [value: AbbSceneStatus]
  'grid-change': [value: boolean]
  'coordinates-change': [value: boolean]
  'dh-debug-change': [value: boolean]
  'trajectory-change': [value: boolean]
  'trajectory-count': [value: number]
}>()

const viewport = ref<HTMLDivElement | null>(null)
let controller: AbbSceneController | null = null

onMounted(() => {
  if (!viewport.value) return
  controller = createAbbScene(viewport.value, {
    onStatus: (status) => emit('status', status),
    onTrajectoryCount: (count) => emit('trajectory-count', count),
    showGrid: props.showGrid,
    showCoordinateSystems: props.showCoordinateSystems,
    showDhDebug: props.showDhDebug,
    showTrajectory: props.showTrajectory,
  })
  controller.setJoints(props.joints)
})

watch(
  () => props.joints,
  (joints) => controller?.setJoints(joints),
  { deep: true },
)

function clearTrajectory(): void {
  controller?.clearTrajectory()
}

watch(
  () => [props.showGrid, props.showCoordinateSystems, props.showDhDebug, props.showTrajectory] as const,
  ([showGrid, showCoordinateSystems, showDhDebug, showTrajectory]) => {
    controller?.setGridVisible(showGrid)
    controller?.setCoordinateSystemsVisible(showCoordinateSystems)
    controller?.setDhDebugVisible(showDhDebug)
    controller?.setTrajectoryVisible(showTrajectory)
  },
)

onBeforeUnmount(() => {
  controller?.dispose()
  controller = null
})
</script>

<template>
  <div class="scene-viewport">
    <div ref="viewport" class="scene-canvas-host" role="img" aria-label="ABB IRB 1200-5/0.9 三维场景" />
    <div class="scene-aux-toolbar" role="toolbar" aria-label="场景辅助显示">
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showGrid }]"
        :aria-pressed="props.showGrid"
        @click="emit('grid-change', !props.showGrid)"
      >网格</button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showCoordinateSystems }]"
        :aria-pressed="props.showCoordinateSystems"
        @click="emit('coordinates-change', !props.showCoordinateSystems)"
      >基座/工具坐标</button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showDhDebug }]"
        :aria-pressed="props.showDhDebug"
        @click="emit('dh-debug-change', !props.showDhDebug)"
      >DH参考链</button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showTrajectory }]"
        :aria-pressed="props.showTrajectory"
        @click="emit('trajectory-change', !props.showTrajectory)"
      >轨迹</button>
      <button
        type="button"
        class="scene-aux-button scene-aux-clear"
        :disabled="props.trajectoryCount === 0"
        @click="clearTrajectory"
      >清空轨迹</button>
    </div>
  </div>
</template>

<style scoped>
.scene-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 420px;
  overflow: hidden;
  background: #101827;
}

.scene-canvas-host {
  position: absolute;
  inset: 0;
}

.scene-aux-toolbar {
  position: absolute;
  top: 14px;
  left: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: calc(100% - 28px);
  z-index: 2;
}

.scene-aux-button {
  padding: 6px 9px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  border-radius: 6px;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.82);
  cursor: pointer;
  font-size: 10px;
  backdrop-filter: blur(8px);
}

.scene-aux-button:hover,
.scene-aux-button.active {
  border-color: #38bdf8;
  color: #e0f2fe;
  background: rgba(14, 116, 144, 0.75);
}

.scene-aux-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.scene-aux-clear {
  border-color: rgba(251, 191, 36, 0.5);
}

.scene-trajectory-count {
  position: absolute;
  right: 14px;
  top: 14px;
  z-index: 2;
  padding: 6px 9px;
  border: 1px solid rgba(249, 115, 22, 0.45);
  border-radius: 6px;
  color: #fed7aa;
  background: rgba(124, 45, 18, 0.75);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
}
</style>
