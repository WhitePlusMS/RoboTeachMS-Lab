<script setup lang="ts">
import { computed, ref } from 'vue'
import JogControlTabs from '@/components/JogControlTabs.vue'
import ProgramWorkspace from '@/components/ProgramWorkspace.vue'
import SceneViewport from '@/components/SceneViewport.vue'
import WorkbenchLayout from '@/components/WorkbenchLayout.vue'
import type { JointAngles } from '@/robotics/types.ts'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import {
  adjustJointAngle,
  randomJointAngles,
  useJointControl,
} from '@/application/joint-control.ts'
import { useMotion } from '@/application/motion-control.ts'
import { useProgramController } from '@/application/program-control.ts'
import { createBuiltinRapidSource } from '@/application/builtin-program.ts'
import { flangeToWorldTcpPose } from '@/rapid/coordinate-transform.ts'
import type { AbbSceneStatus } from '@/scene/abb-scene.ts'
import { useCartesianControl } from '@/application/cartesian-control.ts'
import { isRapidMotionInstruction } from '@/rapid/rapid-parser.ts'
import {
  provideProgramPanelController,
} from '@/application/use-program-panel-controller.ts'
import { provideRobotController } from '@/application/use-robot-controller.ts'

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

const { startEasedAnimation, startSpeedLimitedAnimation, startCartesianTrajectory, stopAnimation } =
  useMotion({
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
  const next = adjustJointAngle(
    joints.value,
    index,
    direction,
    jointStep.value,
    profile.jointRanges,
  )
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

function animateCartesianTrajectory(
  trajectory: readonly JointAngles[],
  isContinuous = false,
): void {
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
 * Program Data 派生视图：声明来自同一次解析，标量当前值来自同一 ProgramExecutor 快照。
 * 面板按数据类型浏览六类运动记录与 num/bool 标量；不建立第二份变量状态。
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
  const instruction = programControl.parsed.value.program[index] ?? null
  return instruction && isRapidMotionInstruction(instruction) ? instruction : null
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

/** 左侧 Jog 工作区共享控制器：App 保持编排所有权（setJoint 先停程序/动画再运动）。 */
provideRobotController({
  joints,
  jointRanges,
  jointStep,
  pose,
  coordinateSystem,
  positionStep,
  orientationStep,
  status: cartesianStatus,
  statusMessage: cartesianStatusMessage,
  setJoint,
  adjustJoint,
  setStep,
  reset,
  randomize,
  moveCartesian,
  setCartesianField,
  setCoordinateSystem,
  setPositionStep,
  setOrientationStep,
})

/** 右侧 ProgramWorkspace 共享控制器：Program Data 全部派生自同一次 parseRapidProgram。 */
provideProgramPanelController({
  snapshot: programSnapshot,
  source: computed(() => rapidSource.value),
  program: computed(() => programControl.parsed.value.program),
  pendingClear: pendingClearState,
  data: programData,
  activeIndex: activeInstructionIndex,
  canExecute: programDataCanExecute,
  insertionPoints: computed(() => programControl.parsed.value.motionInsertionPoints),
  pose: toolPose,
  runtimeValues: computed(() => programSnapshot.value.variables),
  applyEdit: programControl.applyEdit,
  run: () => programControl.run(),
  step: () => programControl.step(),
  stop: () => programControl.stop(),
  ppToMain: () => programControl.ppToMain(),
  confirmClearToNext: () => programControl.confirmClearToNext(),
  cancelClearToNext: () => programControl.cancelClearToNext(),
  setSource: (source) => {
    rapidSource.value = source
  },
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

          <JogControlTabs />
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
        <ProgramWorkspace />
      </template>
    </WorkbenchLayout>
  </main>
</template>

<style scoped>
/* App shell: fixed full-screen single view, vertical flex. */
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100dvh;
  min-height: 0;
  padding: 14px clamp(12px, 2vw, 32px);
  overflow: hidden;
  background:
    radial-gradient(circle at 76% 14%, rgba(37, 99, 235, 0.15), transparent 30rem), var(--color-bg);
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: 16px;
  width: 100%;
  max-width: none;
  margin: 0 auto 10px;
}

.app-header h1 {
  color: var(--color-text-strong);
  font-size: clamp(18px, 1.8vw, 26px);
  line-height: 1.1;
  letter-spacing: -0.035em;
}

.app-header .subtitle {
  margin-top: 4px;
  color: var(--color-text-faint);
  font-size: 11px;
}

.app-header-status {
  display: grid;
  justify-items: end;
  gap: 5px;
}

.viewport-size-warning {
  display: none;
  margin: 0;
  color: var(--color-warning);
  font-size: 10px;
  white-space: nowrap;
}

/* Scene status pill (only shown in the app header). */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 9px 13px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  background: rgba(15, 23, 42, 0.74);
  font-size: 12px;
  font-weight: 600;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-warning-strong);
  box-shadow: 0 0 12px currentColor;
}

.status-ready .status-dot {
  color: var(--color-success);
  background: var(--color-success);
}

.status-error .status-dot {
  color: var(--color-danger);
  background: var(--color-danger);
}

/* Left slot scaffold (model summary + jog tabs). */
.left-workbench-content {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  gap: 10px;
}

.left-model-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--color-border);
}

.left-model-summary h2 {
  color: var(--color-text-strong);
  font-size: 17px;
  letter-spacing: -0.03em;
}

.left-model-summary .panel-hint {
  max-width: 150px;
  text-align: right;
}

/* Central viewport card hosts the 3D scene + caption. */
.viewport-card {
  position: relative;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.8);
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.viewport-card .scene-viewport {
  min-height: 0;
}

.viewport-caption {
  position: absolute;
  right: 16px;
  bottom: 14px;
  left: 16px;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
}

@media (max-width: 1365px), (max-height: 767px) {
  .viewport-size-warning {
    display: block;
  }
}

@media (max-width: 820px) {
  .app-shell {
    padding: 20px 14px 16px;
  }

  .app-header {
    flex-direction: column;
    gap: 16px;
  }

  .viewport-card {
    min-height: 58vh;
  }
}
</style>
