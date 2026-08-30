<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HomePage from '@/components/HomePage.vue'
import JogControlTabs from '@/components/JogControlTabs.vue'
import PoseReadout from '@/components/PoseReadout.vue'
import ProgramControlPanel from '@/components/ProgramControlPanel.vue'
import ProgramWorkspace from '@/components/ProgramWorkspace.vue'
import RunLogPanel from '@/components/RunLogPanel.vue'
import SceneViewport from '@/components/SceneViewport.vue'
import ToastHost from '@/components/ToastHost.vue'
import WorkbenchLayout from '@/components/WorkbenchLayout.vue'
import type { JointAngles, Pose } from '@/robot-geometry/model/index.ts'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/index.ts'
import { useJointControl } from '@/application/joint-control.ts'
import { useMotion } from '@/application/motion-control.ts'
import { createMotionCoordinator } from '@/application/motion-coordinator.ts'
import {
  presentMotionError,
  type HostMotionErrorPresentation,
} from '@/application/motion-errors.ts'
import { useProgramController } from '@/application/program-control.ts'
import { findRapidPreset } from '@/application/preset-programs.ts'
import { createBuiltinRapidSource } from '@/application/builtin-program.ts'
import { useRunLog, provideRunLog } from '@/application/run-log.ts'
import { provideToasts, useToasts } from '@/application/toast.ts'
import { useStatusToasts } from '@/application/status-toasts.ts'
import type { AbbRobTargetMarker, AbbSceneStatus } from '@/scene/abb-scene.ts'
import { useCartesianControl } from '@/application/cartesian-control.ts'
import { createMotionPlannerAdapter, planCartesianTargetSync } from '@/infrastructure/motion-worker/adapter.ts'
import { createCartesianTargetRequest } from '@/application/motion-requests.ts'
import { isRobtargetProgramData } from '@/rapid/language/index.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/editing/index.ts'
import { provideProgramPanelController } from '@/application/use-program-panel-controller.ts'
import { preemptManualMotion, provideRobotController, useRobotController } from '@/application/use-robot-controller.ts'
import { mapCoreFailure } from '@/rapid/planning/core-motion.ts'
import type { InstructionOutcome } from '@/rapid/execution/index.ts'

const profile = ABB_IRB1200_PROFILE
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '')
const labPath = basePath + '/lab'
const isLabRoute = ref(
  window.location.pathname === labPath || window.location.pathname.endsWith('/lab'),
)
const sceneStatus = ref<AbbSceneStatus>('loading')
const showGrid = ref(false)
const showCoordinateSystems = ref(false)
const showDhDebug = ref(false)
const showTrajectory = ref(false)
const showRobtargets = ref(false)
const showRobtargetLabels = ref(false)
const trajectoryCount = ref(0)
/** 程序数据中选中的 robtarget 名称；由 App 唯一持有，驱动 3D 场景高亮。 */
const selectedTargetName = ref<string | null>(null)
const {
  joints,
  jointStep,
  jointRanges,
  pose,
  setJoints: setJointsImmediate,
  setStep,
} = useJointControl({ profile })

/** 所有生产规划统一使用同一个常驻 Worker adapter；非浏览器环境仅用于测试的同步 fallback 仍在 adapter 内。 */
const motionPlanner = createMotionPlannerAdapter()

const {
  startEasedAnimation,
  startSpeedLimitedAnimation,
  startCartesianTrajectory,
  appendCartesianTrajectory,
  stopAnimation,
} = useMotion({
  getCurrentJoints: () => joints.value,
  setJoints: setJointsImmediate,
})

const motionCoordinator = createMotionCoordinator({
  plan: motionPlanner.plan,
  runImmediate: setJointsImmediate,
  runEased: startEasedAnimation,
  runSpeedLimited: startSpeedLimitedAnimation,
  runTrajectory: startCartesianTrajectory,
  appendTrajectory: appendCartesianTrajectory,
  stopRunner: stopAnimation,
  cancelPlan: motionPlanner.cancel,
  disposePlan: motionPlanner.dispose,
  log: (event) => console.info('[MOTION-COORDINATOR]', event),
})
onBeforeUnmount(() => motionCoordinator.dispose())

function syncRoute(): void {
  isLabRoute.value =
    window.location.pathname === labPath || window.location.pathname.endsWith('/lab')
}

function navigateTo(route: 'home' | 'lab'): void {
  const target = route === 'lab' ? labPath : basePath || '/'
  if (window.location.pathname !== target) window.history.pushState({}, '', target)
  isLabRoute.value = route === 'lab'
}

onMounted(() => window.addEventListener('popstate', syncRoute))
onBeforeUnmount(() => window.removeEventListener('popstate', syncRoute))

/** RAPID 源码在 localStorage 的键名；用于跨刷新/重开浏览器保留用户编辑。 */
const RAPID_SOURCE_STORAGE_KEY = 'abb-robot-lab:rapid-source'

/** 读取持久化的 RAPID 源码；无有效内容时回退到页面默认预设「1 · 大范围慢速运动演示（无限循环）」。localStorage 可能不可用（隐私/测试环境），静默降级。 */
function loadPersistedRapidSource(): string {
  try {
    const stored = localStorage.getItem(RAPID_SOURCE_STORAGE_KEY)
    if (typeof stored === 'string' && stored.trim() !== '') return stored
  } catch {
    /* localStorage 不可用时忽略，使用内置默认。 */
  }
  return findRapidPreset('preset-1')?.source ?? createBuiltinRapidSource()
}

/** 保存 RAPID 源码到 localStorage；失败静默忽略，不打断编辑。 */
function persistRapidSource(source: string): void {
  try {
    localStorage.setItem(RAPID_SOURCE_STORAGE_KEY, source)
  } catch {
    /* 存储不可用（隐私模式/配额满）时忽略。 */
  }
}

const rapidSource = ref(loadPersistedRapidSource())

/** RAPID 源程序控制器；解析结果只在运行时生成，运动链从同一 profile 获取模型与限制。 */
const programControl = useProgramController({
  source: rapidSource,
  profile,
  joints,
  motion: {
    submitMotion: (request, playback): Promise<InstructionOutcome> =>
      motionCoordinator.submit({ kind: 'move', source: 'rapid', request, playback }).then((outcome) => {
        if (outcome.ok) return { ok: true, result: outcome.result }
        if (outcome.result && !outcome.result.ok) {
          const error = mapCoreFailure(outcome.result)
          return {
            ok: false,
            error: error ?? { kind: 'unreachable', message: 'Core 运动规划失败' },
          }
        }
        return {
          ok: false,
          error: { kind: 'runtime-error', message: `运动执行${outcome.reason}` },
        }
      }),
    stopAnimation: () => motionCoordinator.stop('user'),
  },
})
const programSnapshot = programControl.snapshot
/** off-path Clear 确认的等待模式；作为本地 setup ref 以便模板自动解包传给面板。 */
const pendingClearState = programControl.pendingClear

/** 底部日志：程序状态迁移 / 诊断 / 运行时错误的派生记录；provide 供任意组件直接调用 info/ok/warn/error。 */
const runLog = useRunLog(programSnapshot)
provideRunLog(runLog)

// 瞬态状态提示：创建全局 toast 控制器，并把程序状态切换映射为 toast（日志已同步记录）。
const toasts = useToasts()
provideToasts(toasts)
useStatusToasts(programSnapshot, toasts)

// 静态教学说明（原常驻卡片下方提示）：启动时写入日志一次，使卡片区域不再占用固定空间。
runLog.info('说明', '关节面板：点击步进按钮单次调整，按住按钮可连续调整。')
runLog.info('说明', '笛卡尔面板：方向键执行按当前选择的坐标系（World/Tool）。')

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

/** 是否允许结构化编辑：可执行，或全部诊断都是 missing-target（`*` 未示教占位，真机仍可继续编辑）。 */
const programEditable = computed(() => {
  const parsed = programControl.parsed.value
  if (parsed.canExecute) return true
  return (
    parsed.diagnostics.length > 0 &&
    parsed.diagnostics.every((diagnostic) => diagnostic.code === 'missing-target')
  )
})

/** 3D 场景的 robtarget 空间标记：与 Program Data 同源（同一次解析），并写入选中态。 */
const robtargets = computed<readonly AbbRobTargetMarker[]>(() =>
  programData.value.filter(isRobtargetProgramData).map((entry) => ({
    name: entry.name,
    position: [entry.target.trans[0], entry.target.trans[1], entry.target.trans[2]],
    selected:
      selectedTargetName.value !== null &&
      entry.name.toLocaleLowerCase() === selectedTargetName.value.toLocaleLowerCase(),
  })),
)

/** 当前 ABB 基座 tool0 TCP（Pose：位置 + 旋转矩阵）；由 FK 派生，供点位示教使用。 */
const toolPose = computed(() => profile.model.forwardKinematics(joints.value))

/**
 * 末端法兰拖拽操作轴：在 3D 场景把机械臂末端（法兰/TCP）拖拽到空间任意可到达位姿。
 * 拖拽产生目标 ABB Pose → Core 运动计划 → Coordinator 统一提交。状态由 App 唯一持有并驱动 SceneViewport。
 * 拖拽开始（onGizmoDragStart）已通过 Coordinator 停止活动运动，这里只负责求解与提交，避免每 tick 重复 stop。
 */
const transformGizmoEnabled = ref(false)
const transformGizmoMode = ref<'translate' | 'rotate'>('translate')
/** 本次拖拽会话（drag-start→drag-end）内是否出现过不可达目标；用于结束一次性提示。 */
const gizmoDragUnreachable = ref(false)
const gizmoDragError = ref<HostMotionErrorPresentation | null>(null)

function solveGizmoTarget(pose: Pose): boolean {
  const request = createCartesianTargetRequest(pose, [...joints.value] as JointAngles)
  void motionCoordinator.submit({
    kind: 'continuous-update',
    source: 'gizmo',
    request,
    playback: 'immediate',
  })
  return true
}

/** 操作轴的显示锚点使用同一套 DH FK 真值，不能读取 FBX 近似骨骼原点。 */
function getGizmoPose(): Pose | null {
  return profile.model.forwardKinematics(joints.value)
}

function handleGizmoDragStart(): void {
  gizmoDragUnreachable.value = false
  gizmoDragError.value = null
  preemptManualMotion({ endCartesianContinuous, stopActiveProgram: programControl.stopActiveProgram })
  void motionCoordinator.submit({ kind: 'continuous-begin', source: 'gizmo' })
}

function prepareProgramRun(): void {
  endCartesianContinuous()
  motionCoordinator.stop('program-start')
}

/** 顶栏与程序工作区复用同一运行入口，避免模板内多语句被格式化后失去合法语法。 */
function handleProgramRun(): void {
  prepareProgramRun()
  programControl.run()
}

/** 单步与连续运行共享相同的运动抢占准备，只在最终程序动作上区分。 */
function handleProgramStep(): void {
  prepareProgramRun()
  programControl.step()
}

function handleGizmoDragEnd(): void {
  void motionCoordinator.submit({ kind: 'continuous-end', source: 'gizmo' })
  if (gizmoDragUnreachable.value) {
    const presentation = gizmoDragError.value ?? {
      title: '目标不可达',
      message: '运动 Core 未找到满足约束的规划。',
      recovery: '调整目标位置、姿态或构型后重试。',
    }
    runLog.info('运动', `${presentation.title}：${presentation.message} ${presentation.recovery}`)
    toasts.push('warn', presentation.title, `${presentation.message} ${presentation.recovery}`)
    gizmoDragUnreachable.value = false
    gizmoDragError.value = null
  }
}

const {
  coordinateSystem,
  positionStep,
  orientationStep,
  status: cartesianStatus,
  statusMessage: cartesianStatusMessage,
  move: moveCartesian,
  setCoordinateSystem,
  setPositionStep,
  setOrientationStep,
  beginContinuous: beginCartesianContinuous,
  endContinuous: endCartesianContinuous,
} = useCartesianControl({
  joints,
  pose,
  profile,
  buildRequest: createCartesianTargetRequest,
  submitMotion: (request, mode, durationMs, continuous = false, onPlanAccepted) => {
    if (continuous) {
      return motionCoordinator.submit({
        kind: 'continuous-update',
        source: 'manual-cartesian',
        request,
        playback: mode === 'stream' ? 'stream' : 'speed-limited',
        durationMs,
        onPlanAccepted,
      })
    }
    return motionCoordinator.submit({
      kind: 'move',
      source: 'manual-cartesian',
      request,
      playback: mode === 'stream' ? 'trajectory' : mode,
      durationMs,
    })
  },
  beginContinuous: () => {
    void motionCoordinator.submit({ kind: 'continuous-begin', source: 'manual-cartesian' })
  },
  endContinuous: () => {
    void motionCoordinator.submit({ kind: 'continuous-end', source: 'manual-cartesian' })
  },
})

const statusLabel = computed(() => {
  if (sceneStatus.value === 'ready') return '场景已就绪'
  if (sceneStatus.value === 'error') return '场景几何加载失败，使用占位显示'
  return '正在加载模型'
})

const motionPointerText = computed(() => programSnapshot.value.motionPointer?.toString() ?? '—')

/** 程序动作包装：在委托给 ProgramController 前补一条操作日志（状态迁移日志由 useRunLog 观察快照产生）。 */
function handlePP(): void {
  programControl.ppToMain()
  runLog.info('程序', 'PP 已回到 main，等待运行')
}

/** 源码整体替换（预设加载 / 手工设值）：记录来源；受控编辑历史由 controller 自动清空。 */
function handleSetSource(source: string): void {
  const changed = source !== rapidSource.value
  rapidSource.value = source
  if (changed) {
    persistRapidSource(source)
    runLog.info('源码', 'RAPID 源码已更新')
  }
}

/** 受控编辑：成功才记日志，失败保持源码不变并报告原因。 */
function handleApplyEdit(command: RapidEditCommand): RapidEditResult {
  const result = programControl.applyEdit(command)
  if (result.ok) {
    runLog.ok('数据', `${commandLabel(command)}已更新`)
  } else {
    runLog.error('数据', `${commandLabel(command)}更新失败：${result.error.message}`)
  }
  return result
}

/** 编辑命令的可读描述，用于操作日志。 */
function commandLabel(command: RapidEditCommand): string {
  switch (command.type) {
    case 'create-target':
      return `创建目标点 ${command.name}`
    case 'modify-position':
      return `更新目标点 ${command.name}`
    case 'rename-target':
      return `重命名目标点 ${command.name} → ${command.newName}`
    case 'delete-target':
      return `删除目标点 ${command.name}`
    case 'insert-motion':
      return `插入指令 ${command.kind.toUpperCase()}`
    case 'edit-motion-operand':
      return `修改指令参数 ${command.operand}`
    case 'delete-instruction':
      return '删除指令'
    case 'comment-instructions':
      return '注释指令'
    case 'uncomment-lines':
      return '取消注释'
    case 'change-motion-kind':
      return '切换 MoveJ/MoveL'
  }
}

/** Jog 工作区共享控制器：运动抢占编排收在 useRobotController 深模块内，App 只负责装配依赖。 */
provideRobotController(
  useRobotController({
    profile,
    joints,
    jointRanges,
    jointStep,
    pose,
    setStep,
    motionCoordinator,
    stopActiveProgram: programControl.stopActiveProgram,
    runLog,
    cartesian: {
      coordinateSystem,
      positionStep,
      orientationStep,
      status: cartesianStatus,
      statusMessage: cartesianStatusMessage,
      move: moveCartesian,
      beginContinuous: beginCartesianContinuous,
      endContinuous: endCartesianContinuous,
      setCoordinateSystem,
      setPositionStep,
      setOrientationStep,
    },
  }),
)

/** ProgramWorkspace 共享控制器：Program Data 全部派生自同一次 parseRapidProgram。 */
provideProgramPanelController({
  snapshot: programSnapshot,
  source: computed(() => rapidSource.value),
  program: computed(() => programControl.parsed.value.program),
  instructions: computed(() => programControl.parsed.value.instructions),
  pendingClear: pendingClearState,
  data: programData,
  activeIndex: activeInstructionIndex,
  canExecute: programDataCanExecute,
  editable: programEditable,
  insertionPoints: computed(() => programControl.parsed.value.motionInsertionPoints),
  pose: toolPose,
  joints,
  runtimeValues: computed(() => programSnapshot.value.variables),
  selectedTargetName,
  applyEdit: handleApplyEdit,
  selectTarget: (name) => {
    selectedTargetName.value = name
    if (name !== null) runLog.info('数据', `已选中目标点 ${name}`)
  },
  undo: () => programControl.undo(),
  redo: () => programControl.redo(),
  canUndo: programControl.canUndo,
  canRedo: programControl.canRedo,
  run: handleProgramRun,
  step: handleProgramStep,
  stop: () => programControl.stop(),
  ppToMain: handlePP,
  confirmClearToNext: () => programControl.confirmClearToNext(),
  cancelClearToNext: () => programControl.cancelClearToNext(),
  setSource: handleSetSource,
})
</script>

<template>
  <HomePage v-if="!isLabRoute" @start="navigateTo('lab')" />
  <main v-else class="shell">
    <header class="topbar">
      <button
        class="mark"
        type="button"
        aria-label="返回 RoboTeachMS Lab 主页"
        @click="navigateTo('home')"
      >
        <img class="mark-image" :src="basePath + '/brand/roboteachms-logo.png'" alt="" />
      </button>
      <h1>RoboTeachMS Lab · 工业机器人示教编程实验室</h1>
      <div class="topbar-spacer"></div>
      <ProgramControlPanel
        display="transport"
        :snapshot="programSnapshot"
        :source="rapidSource"
        :program="programControl.parsed.value.program"
        :pending-clear="pendingClearState"
        @run="handleProgramRun"
        @step="handleProgramStep"
        @stop="programControl.stop()"
        @pp="handlePP()"
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
        <div class="center-col">
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
              :show-robtarget-labels="showRobtargetLabels"
              :transform-gizmo-enabled="transformGizmoEnabled"
              :transform-gizmo-mode="transformGizmoMode"
              :on-gizmo-solve="solveGizmoTarget"
              :get-gizmo-pose="getGizmoPose"
              :on-gizmo-drag-start="handleGizmoDragStart"
              :on-gizmo-drag-end="handleGizmoDragEnd"
              :gizmo-interactive="() => programSnapshot.state !== 'running'"
              @status="sceneStatus = $event"
              @grid-change="showGrid = $event"
              @coordinates-change="showCoordinateSystems = $event"
              @dh-debug-change="showDhDebug = $event"
              @trajectory-change="showTrajectory = $event"
              @trajectory-count="trajectoryCount = $event"
              @robtargets-change="showRobtargets = $event"
              @robtarget-labels-change="showRobtargetLabels = $event"
              @transform-gizmo-change="transformGizmoEnabled = $event"
              @gizmo-mode-change="transformGizmoMode = $event"
            />
            <PoseReadout class="scene-pose-readout" :compact="true" />
          </div>
          <RunLogPanel :entries="runLog.entries.value" />
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
    </WorkbenchLayout>

    <ToastHost />
  </main>
</template>

<style scoped>
/* 骨架：56px 顶栏 + 主区（中央列内嵌 Three.js 视口与底部日志）。 */
.shell {
  display: grid;
  grid-template-rows: 56px minmax(0, 1fr);
  width: 100%;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
  background: var(--color-bg);
}

.topbar {
  position: relative;
  z-index: var(--z-sticky);
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
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-on-brand);
  background: linear-gradient(135deg, var(--color-brand), var(--color-brand-strong));
  cursor: pointer;
}

.mark-image {
  display: block;
  width: 30px;
  height: 30px;
  object-fit: contain;
}

.topbar h1 {
  color: var(--color-text-strong);
  font-size: var(--text-xl);
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

/* 中央列：Three.js 视口在上方弹性铺满，日志栏固定在底部（仅占中央视图宽度）。
   右侧边栏与整个中央列等高，因此日志不会横贯到边栏下方。 */
.center-col {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* 中央 3D 视口：铺满中央列剩余高度，caption 浮在底部。
   背景取 --color-scene-bg（唯一来源为 theme/scene.ts 的场景背景，
   与 WebGL scene.background 严格一致，避免同一块背景多处各写各的）。 */
.viewport-stage {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--color-scene-bg);
}

/* 位姿角标：紧凑叠放在 3D 场景右下角（原 viewport-caption 位置），不占面板空间。
   卡片本身允许选中文本和点击复制；只有卡片矩形区域不再穿透给画布。 */
.scene-pose-readout {
  position: absolute;
  right: 14px;
  bottom: 12px;
  z-index: var(--z-raised);
  pointer-events: auto;
}
</style>
