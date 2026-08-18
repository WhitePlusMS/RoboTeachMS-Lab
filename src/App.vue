<script setup lang="ts">
import { computed, ref } from 'vue'
import JogControlTabs from '@/components/JogControlTabs.vue'
import PoseReadout from '@/components/PoseReadout.vue'
import ProgramControlPanel from '@/components/ProgramControlPanel.vue'
import ProgramWorkspace from '@/components/ProgramWorkspace.vue'
import RunLogPanel from '@/components/RunLogPanel.vue'
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
import { useRunLog } from '@/application/run-log.ts'
import type { AbbRobTargetMarker, AbbSceneStatus } from '@/scene/abb-scene.ts'
import { useCartesianControl } from '@/application/cartesian-control.ts'
import { isRobtargetProgramData } from '@/rapid/rapid-parser.ts'
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
const showRobtargets = ref(true)
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

/** 数值输入是直接提交，按钮与目标姿态更新走原项目的动画过渡。 */
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

/** 底部日志：程序状态迁移 / 诊断 / 运行时错误的派生记录。 */
const runLog = useRunLog(programSnapshot)

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

/** 3D 场景的 robtarget 空间标记：与 Program Data 同源（同一次解析）。 */
const robtargets = computed<readonly AbbRobTargetMarker[]>(() =>
  programData.value.filter(isRobtargetProgramData).map((entry) => ({
    name: entry.name,
    position: [entry.target.trans[0], entry.target.trans[1], entry.target.trans[2]],
  })),
)

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

const motionPointerText = computed(() => programSnapshot.value.motionPointer?.toString() ?? '—')

/** Jog 工作区共享控制器：App 保持编排所有权（setJoint 先停程序/动画再运动）。 */
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

/** ProgramWorkspace 共享控制器：Program Data 全部派生自同一次 parseRapidProgram。 */
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
  <main class="shell">
    <header class="topbar">
      <span class="mark" aria-hidden="true">A</span>
      <h1>ABB IRB 1200-5/0.9 教学场景</h1>
      <div class="topbar-spacer"></div>
      <ProgramControlPanel
        display="transport"
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
      />
      <span class="pill pill-mono" title="程序指针 / 运动指针"
        >PP {{ programSnapshot.programPointer }} · MP {{ motionPointerText }}</span
      >
      <span class="pill status-pill" :class="`status-${sceneStatus}`" title="场景状态">
        <span class="pill-dot status-dot" aria-hidden="true"></span>{{ statusLabel }}
      </span>
    </header>

    <WorkbenchLayout>
      <template #center>
        <div class="viewport-stage">
          <SceneViewport
            :joints="joints"
            :show-grid="showGrid"
            :show-coordinate-systems="showCoordinateSystems"
            :show-dh-debug="showDhDebug"
            :show-trajectory="showTrajectory"
            :trajectory-count="trajectoryCount"
            :robtargets="robtargets"
            :show-robtargets="showRobtargets"
            @status="sceneStatus = $event"
            @grid-change="showGrid = $event"
            @coordinates-change="showCoordinateSystems = $event"
            @dh-debug-change="showDhDebug = $event"
            @trajectory-change="showTrajectory = $event"
            @trajectory-count="trajectoryCount = $event"
            @robtargets-change="showRobtargets = $event"
          />
          <div class="viewport-caption">
            <span>WORLD / BASE FRAME</span>
            <span>OrbitControls</span>
          </div>
        </div>
      </template>

      <template #panel="{ activeFunction, select }">
        <ProgramWorkspace
          v-show="activeFunction !== 'jog'"
          :view="activeFunction === 'data' ? 'data' : 'rapid'"
          @update:view="select"
        />
        <JogControlTabs v-show="activeFunction === 'jog'" />
      </template>

      <template #pose>
        <PoseReadout />
      </template>
    </WorkbenchLayout>

    <RunLogPanel :entries="runLog.entries.value" />
  </main>
</template>

<style scoped>
/* 骨架：56px 顶栏 + 主区 + 底部日志栏。 */
.shell {
  display: grid;
  grid-template-rows: 56px minmax(0, 1fr) auto;
  width: 100%;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: var(--color-bg);
}

.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-deep);
}

.mark {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: var(--color-on-brand);
  background: linear-gradient(135deg, var(--color-brand), #ff9a55);
  font-size: 12px;
  font-weight: 900;
}

.topbar h1 {
  color: var(--color-text-strong);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.topbar-spacer {
  flex: 1;
}

/* 场景状态丸的圆点随状态变色（默认加载中为警告色）。 */
.status-loading .pill-dot {
  background: var(--color-warning-strong);
  box-shadow: 0 0 8px var(--color-warning-strong);
}

.status-error .pill-dot {
  background: var(--color-danger);
  box-shadow: 0 0 8px var(--color-danger);
}

/* 中央 3D 视口：满幅铺底，caption 浮在底部。 */
.viewport-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: radial-gradient(130% 100% at 50% 24%, #171d27 0%, #10141b 52%, #0b0e13 100%);
}

.viewport-caption {
  position: absolute;
  right: 16px;
  bottom: 12px;
  left: 16px;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
  color: var(--color-text-dim);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
}
</style>
