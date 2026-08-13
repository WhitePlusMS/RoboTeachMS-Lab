<script setup lang="ts">
import { computed, ref } from 'vue'
import JogControlTabs from './components/JogControlTabs.vue'
import ProgramWorkspace from './components/ProgramWorkspace.vue'
import SceneViewport from './components/SceneViewport.vue'
import WorkbenchLayout from './components/WorkbenchLayout.vue'
import type { JointAngles } from './robotics/types.ts'
import { ABB_IRB1200_PROFILE } from './robot-models/abb-irb1200/robot-profile.ts'
import { adjustJointAngle, randomJointAngles, useJointControl } from './application/joint-control.ts'
import { useMotion } from './application/motion-control.ts'
import { useProgramController } from './application/program-control.ts'
import { createBuiltinRapidSource } from './application/builtin-program.ts'
import { flangeToWorldTcpPose } from './rapid/coordinate-transform.ts'
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

/**
 * Program Data 派生视图：来自同一次解析，实时随源码更新。
 * 面板按数据类型浏览五类记录（robtarget/tooldata/wobjdata/speeddata/zonedata）；数据唯一来源于解析结果。
 */
const programData = computed(() => programControl.parsed.value.data)
const programDataCanExecute = computed(() => programControl.parsed.value.canExecute)
/** 当前活动（或下一条待执行）的指令下标，用于面板高亮当前使用的 Tool/WObj/Speed/Zone/目标。 */
const activeInstructionIndex = computed(() => {
  const snapshot = programControl.snapshot.value
  return snapshot.motionPointer ?? snapshot.programPointer
})

/** 当前 ABB 基座 tool0 TCP（Pose：位置 + 旋转矩阵）；由 FK 派生，供点位示教使用。 */
const toolPose = computed(() => profile.model.forwardKinematics(joints.value))

/** 当前活动指令（可能为 null）。 */
const activeInstruction = computed(() => {
  const index = activeInstructionIndex.value
  if (index === null || index === undefined) return null
  return programControl.parsed.value.program[index] ?? null
})

/**
 * 场景坐标为米；本平台采用“域 mm → 场景 m = /1000”的近似约定（仅用于视觉效果指示，
 * 不参与任何轨迹/坐标求值）。活动工具/工件坐标系框的位置由领域层计算，场景只负责显示。
 */
const activeToolFrameMm = computed<[number, number, number] | null>(() => {
  const instruction = activeInstruction.value
  if (!instruction || !toolPose.value) return null
  const tcp = flangeToWorldTcpPose(toolPose.value, instruction.tool)
  return [tcp.position[0] / 1000, tcp.position[1] / 1000, tcp.position[2] / 1000]
})
const activeWobjFrameMm = computed<[number, number, number] | null>(() => {
  const instruction = activeInstruction.value
  if (!instruction) return null
  const trans = instruction.wobj.uframe.trans
  return [trans[0] / 1000, trans[1] / 1000, trans[2] / 1000]
})


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
        <p class="eyebrow">ABB TEACHING WORKBENCH</p>
        <h1>ABB IRB 1200-5/0.9 教学场景</h1>
        <p class="subtitle">Jog · RAPID · Program Data</p>
      </div>
      <div class="app-header-status">
        <span class="status-pill" :class="`status-${sceneStatus}`">
          <span class="status-dot" aria-hidden="true" />
          {{ statusLabel }}
        </span>
        <p class="viewport-size-warning" role="status">建议使用至少 1366×768 的窗口尺寸。</p>
      </div>
    </header>

    <WorkbenchLayout>
      <template #left>
        <div class="left-workbench-content">
          <div class="left-model-summary">
            <div>
              <p class="panel-kicker">MODEL</p>
              <h2>IRB 1200-5/0.9</h2>
            </div>
            <p class="panel-hint">左键旋转 · 滚轮缩放 · 右键平移</p>
          </div>

          <JogControlTabs
            :joints="joints"
            :joint-ranges="jointRanges"
            :joint-step="jointStep"
            :pose="pose"
            :coordinate-system="coordinateSystem"
            :position-step="positionStep"
            :orientation-step="orientationStep"
            :status="cartesianStatus"
            :status-message="cartesianStatusMessage"
            @set-joint="setJoint"
            @adjust-joint="adjustJoint"
            @step-change="setStep"
            @reset="reset"
            @random="randomize"
            @move="moveCartesian"
            @set-field="setCartesianField"
            @coordinate-change="setCoordinateSystem"
            @position-step-change="setPositionStep"
            @orientation-step-change="setOrientationStep"
          />
        </div>
      </template>

      <template #center>
        <div class="viewport-card">
          <SceneViewport
            :joints="joints"
            :show-grid="showGrid"
            :show-coordinate-systems="showCoordinateSystems"
            :show-dh-debug="showDhDebug"
            :show-trajectory="showTrajectory"
            :trajectory-count="trajectoryCount"
            :active-tool-frame="activeToolFrameMm"
            :active-wobj-frame="activeWobjFrameMm"
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
      </template>

      <template #right>
        <ProgramWorkspace
          :snapshot="programSnapshot"
          :source="rapidSource"
          :program="programControl.parsed.value.program"
          :pending-clear="pendingClearState"
          :data="programData"
          :active-index="activeInstructionIndex"
          :can-execute="programDataCanExecute"
          :insertion-points="programControl.parsed.value.motionInsertionPoints"
          :pose="toolPose"
          :apply-edit="programControl.applyEdit"
          @run="programControl.run()"
          @step="programControl.step()"
          @stop="programControl.stop()"
          @pp="programControl.ppToMain()"
          @confirm-clear="programControl.confirmClearToNext()"
          @cancel-clear="programControl.cancelClearToNext()"
          @source-change="rapidSource = $event"
        />
      </template>
    </WorkbenchLayout>
  </main>
</template>
