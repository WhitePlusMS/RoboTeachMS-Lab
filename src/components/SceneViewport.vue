<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import {
  createAbbScene,
  type AbbRobTargetMarker,
  type AbbSceneController,
  type AbbSceneStatus,
} from '@/scene/abb-scene.ts'
import type { TransformGizmoMode } from '@/scene/abb-transform-gizmo.ts'

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
    /** 是否显示末端法兰拖拽操作轴。 */
    transformGizmoEnabled?: boolean
    /** 操作轴模式：'translate'（XYZ 平移）或 'rotate'（RX/RY/RZ 旋转）。 */
    transformGizmoMode?: TransformGizmoMode
    /** 拖拽目标 ABB Pose 的 IK 求解器：成功并应用返回 true，不可达返回 false。 */
    onGizmoSolve?: (pose: Pose) => boolean
    /** 操作轴跟随的当前 DH 机械法兰 Pose，避免读取 FBX 视觉近似坐标作为 IK 起点。 */
    getGizmoPose?: () => Pose | null
    /** 拖拽开始回调（用于停止动画/程序）。 */
    onGizmoDragStart?: () => void
    /** 拖拽结束回调。 */
    onGizmoDragEnd?: () => void
    /** 是否允许拖拽（程序运行期间可设为 false）。 */
    gizmoInteractive?: () => boolean
  }>(),
  {
    robtargets: () => [],
    showRobtargets: false,
    showRobtargetLabels: false,
    transformGizmoEnabled: false,
    transformGizmoMode: 'translate',
    onGizmoSolve: undefined,
    getGizmoPose: undefined,
    onGizmoDragStart: undefined,
    onGizmoDragEnd: undefined,
    gizmoInteractive: undefined,
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
  'transform-gizmo-change': [value: boolean]
  'gizmo-mode-change': [value: TransformGizmoMode]
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
      onGizmoSolve: props.onGizmoSolve,
      getGizmoPose: props.getGizmoPose,
      onGizmoDragStart: props.onGizmoDragStart,
      onGizmoDragEnd: props.onGizmoDragEnd,
      gizmoInteractive: props.gizmoInteractive,
    })
    controller.setJoints(props.joints)
    controller.setRobTargets(props.robtargets)
    controller.setRobTargetsVisible(props.showRobtargets)
    controller.setRobTargetLabelsVisible(props.showRobtargetLabels)
    controller.enableTransformGizmo(props.transformGizmoEnabled)
    controller.setTransformGizmoMode(props.transformGizmoMode)
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

watch(
  () => props.transformGizmoEnabled,
  (enabled) => controller?.enableTransformGizmo(enabled),
)

watch(
  () => props.transformGizmoMode,
  (mode) => controller?.setTransformGizmoMode(mode),
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
        title="显示/隐藏地面网格"
        @click="emit('grid-change', !props.showGrid)"
      >
        网格
      </button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showCoordinateSystems }]"
        :aria-pressed="props.showCoordinateSystems"
        title="显示/隐藏基座与工具坐标系"
        @click="emit('coordinates-change', !props.showCoordinateSystems)"
      >
        基座/工具坐标
      </button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showDhDebug }]"
        :aria-pressed="props.showDhDebug"
        title="显示/隐藏 DH 参考链"
        @click="emit('dh-debug-change', !props.showDhDebug)"
      >
        DH参考链
      </button>
      <span class="scene-aux-group scene-aux-trajectory-group" role="group" aria-label="轨迹操作">
        <button
          type="button"
          :class="['scene-aux-button', { active: props.showTrajectory }]"
          :aria-pressed="props.showTrajectory"
          title="显示/隐藏 TCP 运行轨迹"
          @click="emit('trajectory-change', !props.showTrajectory)"
        >
          轨迹
        </button>
        <button
          type="button"
          class="scene-aux-button scene-aux-clear"
          :disabled="props.trajectoryCount === 0"
          title="清空已记录的 TCP 轨迹"
          @click="clearTrajectory"
        >
          清空轨迹
        </button>
      </span>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showRobtargets }]"
        :aria-pressed="props.showRobtargets"
        title="显示/隐藏 robtarget 点位标记"
        @click="emit('robtargets-change', !props.showRobtargets)"
      >
        点位
      </button>
      <button
        type="button"
        :class="['scene-aux-button', { active: props.showRobtargets && props.showRobtargetLabels }]"
        :aria-pressed="props.showRobtargetLabels"
        :disabled="!props.showRobtargets"
        title="显示/隐藏点位名称标签（需先开启点位）"
        @click="emit('robtarget-labels-change', !props.showRobtargetLabels)"
      >
        标签
      </button>
      <span class="scene-aux-group scene-aux-gizmo-group" role="group" aria-label="末端拖拽操作轴">
        <button
          type="button"
          :class="['scene-aux-button', { active: props.transformGizmoEnabled }]"
          :aria-pressed="props.transformGizmoEnabled"
          title="显示/隐藏机械臂末端拖拽操作轴。开启后可抓取法兰末端拖动（平移/旋转）到空间任意可到达位姿"
          @click="emit('transform-gizmo-change', !props.transformGizmoEnabled)"
        >
          操作轴
        </button>
        <template v-if="props.transformGizmoEnabled">
          <button
            type="button"
            :class="[
              'scene-aux-button',
              'scene-aux-gizmo-mode',
              { active: props.transformGizmoMode === 'translate' },
            ]"
            :aria-pressed="props.transformGizmoMode === 'translate'"
            title="平移模式：拖动三轴箭头移动末端位置 X / Y / Z"
            @click="emit('gizmo-mode-change', 'translate')"
          >
            平移
          </button>
          <button
            type="button"
            :class="[
              'scene-aux-button',
              'scene-aux-gizmo-mode',
              { active: props.transformGizmoMode === 'rotate' },
            ]"
            :aria-pressed="props.transformGizmoMode === 'rotate'"
            title="旋转模式：拖动圆弧手柄旋转末端姿态 RX / RY / RZ"
            @click="emit('gizmo-mode-change', 'rotate')"
          >
            旋转
          </button>
        </template>
      </span>
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
  z-index: var(--z-overlay);
  display: grid;
  place-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--color-text-muted);
  text-align: center;
  background: radial-gradient(
    circle at center,
    var(--color-overlay-bg-strong),
    var(--color-scene-bg) 72%
  );
}

.scene-webgl-fallback strong {
  color: var(--color-danger-soft);
  font-size: var(--text-xl);
}

.scene-webgl-fallback p {
  max-width: 360px;
  margin: 0;
  color: var(--color-text-faint);
  font-size: var(--text-md);
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
  z-index: var(--z-raised);
}

/* 场景辅助按钮：半透明毛玻璃底，blur 清晰可见。
   背景用 color-mix 从 --color-overlay-bg 派生低透明度玻璃（原 token 是 0.88 近不透明白，
   直接用作背景会把 backdrop-filter 模糊盖住、毛玻璃失效）。 */
.scene-aux-button {
  padding: 7px 11px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: color-mix(in srgb, var(--color-overlay-bg) 60%, transparent);
  cursor: pointer;
  font-size: var(--text-md);
  backdrop-filter: blur(8px);
}

.scene-aux-button:hover {
  color: var(--color-text-strong);
  background: color-mix(in srgb, var(--color-overlay-bg-strong) 60%, transparent);
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
  border-color: color-mix(in srgb, var(--color-warning) 50%, transparent);
}

/* 末端拖拽操作轴按钮组：子按钮（平移/旋转）在开启后与主按钮同排紧凑排列。 */
.scene-aux-gizmo-group {
  display: flex;
  gap: 6px;
}

.scene-aux-trajectory-group {
  display: flex;
  gap: 6px;
}

.scene-aux-gizmo-mode {
  padding-inline: 9px;
  font-size: var(--text-sm);
}
</style>
