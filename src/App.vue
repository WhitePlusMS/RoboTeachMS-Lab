<script setup lang="ts">
import { computed, ref } from 'vue'
import CartesianControlPanel from './components/CartesianControlPanel.vue'
import CoordinateInfoPanel from './components/CoordinateInfoPanel.vue'
import JointControlPanel from './components/JointControlPanel.vue'
import ProgramControlPanel from './components/ProgramControlPanel.vue'
import ProgramDataPanel from './components/ProgramDataPanel.vue'
import SceneViewport from './components/SceneViewport.vue'
import type { JointAngles } from './robotics/types.ts'
import { ABB_IRB1200_PROFILE } from './robot-models/abb-irb1200/robot-profile.ts'
import { adjustJointAngle, randomJointAngles, useJointControl } from './application/joint-control.ts'
import { useMotion } from './application/motion-control.ts'
import { useProgramController } from './application/program-control.ts'
import { createBuiltinRapidSource } from './application/builtin-program.ts'
import type { AbbSceneStatus } from './scene/abb-scene.ts'
import { useCartesianControl } from './application/cartesian-control.ts'

const profile = ABB_IRB1200_PROFILE
const sceneStatus = ref<AbbSceneStatus>('loading')
const showGrid = ref(true)
const showCoordinateSystems = ref(true)
const showDhDebug = ref(true)
const showTrajectory = ref(false)
const trajectoryCount = ref(0)
const {
  joints,
  jointStep,
  jointRanges,
  pose,
  setJoint: setJointImmediate,
  setJoints: setJointsImmediate,
  setStep,
} = useJointControl({ profile })

const {
  startEasedAnimation,
  startSpeedLimitedAnimation,
  startCartesianTrajectory,
  stopAnimation,
} = useMotion({
  getCurrentJoints: () => joints.value,
  setJoints: setJointsImmediate,
})

/** 滑块输入是直接提交，按钮与目标姿态更新走原项目的动画过渡。 */
function setJoint(index: number, value: number): void {
  programControl.stopActiveProgram()
  stopAnimation()
  setJointImmediate(index, value)
}

function adjustJoint(index: number, direction: -1 | 1, isContinuous = false): void {
  programControl.stopActiveProgram()
  const next = adjustJointAngle(joints.value, index, direction, jointStep.value, profile.jointRanges)
  if (isContinuous) startSpeedLimitedAnimation(next)
  else startEasedAnimation(next)
}

function reset(): void {
  programControl.stopActiveProgram()
  startEasedAnimation([...profile.homeJoints])
}

function randomize(): void {
  programControl.stopActiveProgram()
  startEasedAnimation(randomJointAngles(profile.jointRanges))
}

function animateCartesianTrajectory(trajectory: readonly JointAngles[], isContinuous = false): void {
  programControl.stopActiveProgram()
  startCartesianTrajectory(trajectory, isContinuous ? 140 : undefined)
}

const rapidSource = ref(createBuiltinRapidSource())

/** RAPID 源程序控制器；解析结果只在运行时生成，运动链从同一 profile 获取模型与限制。 */
const programControl = useProgramController({
  source: rapidSource,
  profile,
  joints,
  motion: {
    startEasedAnimation,
    startCartesianTrajectory,
    stopAnimation,
  },
})
const programSnapshot = programControl.snapshot
/** off-path Clear 确认的等待模式；作为本地 setup ref 以便模板自动解包传给面板。 */
const pendingClearState = programControl.pendingClear

/** Program Data 派生视图：来自同一次解析，实时随源码更新。 */
const programData = computed(() => programControl.parsed.value.data)
const programDataCanExecute = computed(() => programControl.parsed.value.canExecute)

/** 当前 ABB 基座 tool0 TCP（Pose：位置 + 旋转矩阵）；由 FK 派生，供点位示教使用。 */
const toolPose = computed(() => profile.model.forwardKinematics(joints.value))

const {
  coordinateSystem,
  positionStep,
  orientationStep,
  status: cartesianStatus,
  statusMessage: cartesianStatusMessage,
  move: moveCartesian,
  setField: setCartesianField,
  setCoordinateSystem,
  setPositionStep,
  setOrientationStep,
} = useCartesianControl({
  joints,
  pose,
  profile,
  moveToTrajectory: animateCartesianTrajectory,
})

const statusLabel = computed(() => {
  if (sceneStatus.value === 'ready') return '场景已就绪'
  if (sceneStatus.value === 'error') return '场景几何加载失败，使用占位显示'
  return '正在加载模型'
})
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">ROBOT PROGRAMMING LAB · SKELETON</p>
        <h1>ABB IRB 1200-5/0.9 教学场景</h1>
        <p class="subtitle">基于 ABB 官方规格的六轴编程仿真前端</p>
      </div>
      <span class="status-pill" :class="`status-${sceneStatus}`">
        <span class="status-dot" aria-hidden="true" />
        {{ statusLabel }}
      </span>
    </header>

    <section class="workspace" aria-label="ABB IRB 1200-5/0.9 工作台">
      <aside class="info-panel">
        <div class="panel-heading">
          <span class="panel-kicker">MODEL</span>
          <h2>IRB 1200-5/0.9</h2>
        </div>

        <dl class="model-facts">
          <div>
            <dt>当前阶段</dt>
            <dd>关节与笛卡尔控制</dd>
          </div>
          <div>
            <dt>场景交互</dt>
            <dd>旋转 · 缩放 · 平移</dd>
          </div>
          <div>
            <dt>逆解状态</dt>
            <dd>数值 DLS 求解</dd>
          </div>
        </dl>

        <div class="hint-card">
          <p class="hint-title">操作提示</p>
          <p>左键拖拽旋转视角，滚轮缩放，右键拖拽平移场景。</p>
        </div>

        <CoordinateInfoPanel :tool-pose="pose" />

        <JointControlPanel
          :joints="joints"
          :joint-ranges="jointRanges"
          :joint-step="jointStep"
          :pose="pose"
          @set-joint="setJoint"
          @adjust-joint="adjustJoint"
          @step-change="setStep"
          @reset="reset"
          @random="randomize"
        />

        <CartesianControlPanel
          :pose="pose"
          :coordinate-system="coordinateSystem"
          :position-step="positionStep"
          :orientation-step="orientationStep"
          :status="cartesianStatus"
          :status-message="cartesianStatusMessage"
          @move="moveCartesian"
          @set-field="setCartesianField"
          @coordinate-change="setCoordinateSystem"
          @position-step-change="setPositionStep"
          @orientation-step-change="setOrientationStep"
        />

        <ProgramDataPanel
          :targets="programData"
          :can-execute="programDataCanExecute"
          :program="programControl.parsed.value.program"
          :insertion-points="programControl.parsed.value.motionInsertionPoints"
          :pose="toolPose"
          :apply-edit="programControl.applyEdit"
        />
      </aside>

      <div class="viewport-card">
        <SceneViewport
          :joints="joints"
          :show-grid="showGrid"
          :show-coordinate-systems="showCoordinateSystems"
          :show-dh-debug="showDhDebug"
          :show-trajectory="showTrajectory"
          :trajectory-count="trajectoryCount"
          @status="sceneStatus = $event"
          @grid-change="showGrid = $event"
          @coordinates-change="showCoordinateSystems = $event"
          @dh-debug-change="showDhDebug = $event"
          @trajectory-change="showTrajectory = $event"
          @trajectory-count="trajectoryCount = $event"
        />
        <div class="viewport-caption">
          <span>WORLD / BASE FRAME</span>
          <span>OrbitControls</span>
        </div>
      </div>

      <aside class="source-panel">
        <ProgramControlPanel
          :snapshot="programSnapshot"
          :source="rapidSource"
          :program="programControl.parsed.value.program"
          :pending-clear="pendingClearState"
          @run="programControl.run()"
          @step="programControl.step()"
          @stop="programControl.stop()"
          @pp="programControl.ppToMain()"
          @confirm-clear="programControl.confirmClearToNext()"
          @cancel-clear="programControl.cancelClearToNext()"
          @source-change="rapidSource = $event"
        />
      </aside>
    </section>

    <footer class="app-footer">
      <span>独立 Vite + Vue3 + TypeScript 应用</span>
      <span>·</span>
      <span>基础资源与构建配置自包含</span>
    </footer>
  </main>
</template>
