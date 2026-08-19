<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { JointAngles } from '@/robotics/types.ts'
import {
  createAbbScene,
  type AbbRobTargetMarker,
  type AbbSceneController,
  type AbbSceneStatus,
} from '@/scene/abb-scene.ts'

const props = withDefaults(
  defineProps<{
    joints: JointAngles
    showGrid: boolean
    showCoordinateSystems: boolean
    showDhDebug: boolean
    showTrajectory: boolean
    trajectoryCount: number
    /** RAPID 源码解析出的 robtarget 空间标记（ABB 基座坐标，毫米）。 */
    robtargets?: readonly AbbRobTargetMarker[]
    showRobtargets?: boolean
    /** robtarget 名称标签是否随点位小球一起显示。 */
    showRobtargetLabels?: boolean
  }>(),
  {
    robtargets: () => [],
    showRobtargets: false,
    showRobtargetLabels: false,
  },
)

const emit = defineEmits<{
  status: [value: AbbSceneStatus]
  'grid-change': [value: boolean]
  'coordinates-change': [value: boolean]
  'dh-debug-change': [value: boolean]
  'trajectory-change': [value: boolean]
  'trajectory-count': [value: number]
  'robtargets-change': [value: boolean]
  'robtarget-labels-change': [value: boolean]
}>()

const viewport = ref<HTMLDivElement | null>(null)
const sceneError = ref<string | null>(null)
let controller: AbbSceneController | null = null

onMounted(() => {
  if (!viewport.value) return
  try {
    controller = createAbbScene(viewport.value, {
      onStatus: (status) => emit('status', status),
      onTrajectoryCount: (count) => emit('trajectory-count', count),
      showGrid: props.showGrid,
      showCoordinateSystems: props.showCoordinateSystems,
      showDhDebug: props.showDhDebug,
      showTrajectory: props.showTrajectory,
    })
    controller.setJoints(props.joints)
    controller.setRobTargets(props.robtargets)
    controller.setRobTargetsVisible(props.showRobtargets)
    controller.setRobTargetLabelsVisible(props.showRobtargetLabels)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sceneError.value = message.includes('WebGL')
      ? '当前浏览器未提供可用 WebGL，Three.js 场景无法显示。请启用硬件加速或更换浏览器。'
      : 'Three.js 场景初始化失败，已进入降级显示。'
    console.error('[SceneViewport] Three.js 场景初始化失败', error)
    emit('status', 'error')
  }
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
  () =>
    [props.showGrid, props.showCoordinateSystems, props.showDhDebug, props.showTrajectory] as const,
  ([showGrid, showCoordinateSystems, showDhDebug, showTrajectory]) => {
    controller?.setGridVisible(showGrid)
    controller?.setCoordinateSystemsVisible(showCoordinateSystems)
    controller?.setDhDebugVisible(showDhDebug)
    controller?.setTrajectoryVisible(showTrajectory)
  },
)

watch(
  () => props.robtargets,
  (robtargets) => controller?.setRobTargets(robtargets),
  { deep: true },
)

watch(
  () => props.showRobtargets,
  (visible) => controller?.setRobTargetsVisible(visible),
)

watch(
  () => props.showRobtargetLabels,
  (visible) => controller?.setRobTargetLabelsVisible(visible),
)

onBeforeUnmount(() => {
  controller?.dispose()
  controller = null
})
</script>

<template>
  <div class="scene-viewport">
    <div
      ref="viewport"
      class="scene-canvas-host"
      role="img"
      aria-label="ABB IRB 1200-5/0.9 三维场景"
    />
    <div v-if="sceneError" class="scene-webgl-fallback" role="status">
      <strong>Three.js 场景不可用</strong>
      <p>{{ sceneError }}</p>
    </div>
    <div class="scene-aux-toolbar" role="toolbar" aria-label="场景辅助显示">
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showGrid }]"
        :aria-pressed="props.showGrid"
        @click="emit('grid-change', !props.showGrid)"
      >
        网格
      </button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showCoordinateSystems }]"
        :aria-pressed="props.showCoordinateSystems"
        @click="emit('coordinates-change', !props.showCoordinateSystems)"
      >
        基座/工具坐标
      </button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showDhDebug }]"
        :aria-pressed="props.showDhDebug"
        @click="emit('dh-debug-change', !props.showDhDebug)"
      >
        DH参考链
      </button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showTrajectory }]"
        :aria-pressed="props.showTrajectory"
        @click="emit('trajectory-change', !props.showTrajectory)"
      >
        轨迹
      </button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showRobtargets }]"
        :aria-pressed="props.showRobtargets"
        @click="emit('robtargets-change', !props.showRobtargets)"
      >
        点位
      </button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showRobtargets && props.showRobtargetLabels }]"
        :aria-pressed="props.showRobtargetLabels"
        :disabled="!props.showRobtargets"
        title="点位名称标签"
        @click="emit('robtarget-labels-change', !props.showRobtargetLabels)"
      >
        标签
      </button>
      <button
        type="button"
        class="scene-aux-button scene-aux-clear"
        :disabled="props.trajectoryCount === 0"
        @click="clearTrajectory"
      >
        清空轨迹
      </button>
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
  background: var(--color-scene-bg);
}

.scene-canvas-host {
  position: absolute;
  inset: 0;
}

.scene-webgl-fallback {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--color-text-muted);
  text-align: center;
  background: radial-gradient(circle at center, rgba(35, 39, 47, 0.94), var(--color-scene-bg) 72%);
}

.scene-webgl-fallback strong {
  color: var(--color-danger-soft);
  font-size: 14px;
}

.scene-webgl-fallback p {
  max-width: 360px;
  margin: 0;
  color: var(--color-text-faint);
  font-size: 12px;
  line-height: 1.6;
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
  padding: 7px 11px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: rgba(20, 22, 27, 0.82);
  cursor: pointer;
  font-size: 12px;
  backdrop-filter: blur(8px);
}

.scene-aux-button:hover {
  color: var(--color-text-strong);
  background: rgba(39, 44, 54, 0.85);
}

.scene-aux-button.active {
  color: var(--color-brand-soft);
  background: var(--color-brand-dim);
}

.scene-aux-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.scene-aux-clear:hover:not(:disabled) {
  border-color: rgba(245, 197, 66, 0.5);
}
</style>
