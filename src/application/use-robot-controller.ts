import { inject, provide, type InjectionKey, type Ref } from 'vue'
import type { JointAngles, PoseDisplay } from '@/robot-geometry/robot-types.ts'
import type { JointRange, RobotProfile } from '@/robot-geometry/robot-types.ts'
import type { CartesianAxis, CoordinateSystem } from '@/application/motion/cartesian-jog-input.ts'
import type { JointDirection, JointStep } from '@/application/motion/joint-math.ts'
import { adjustJointAngle, randomJointAngles } from '@/application/motion/joint-math.ts'
import type {
  CartesianDirection,
  OrientationStep,
  PositionStep,
} from '@/application/motion/cartesian-jog-input.ts'
import type { CartesianStatus } from '@/application/motion/cartesian-result-presentation.ts'
import type { MotionCoordinator } from '@/application/motion/motion-coordinator.ts'
import type { RunLogController } from '@/application/notifications/run-log.ts'
import { createJointTargetRequest } from '@/application/motion/manual-motion-request.ts'

/**
 * 只读 ref：面板只读展示控制器提供的状态切片，因此只要求可读的 .value。
 * 既接受 Ref 也接受 ComputedRef，避免把控制器与某一具体响应式实现耦合。
 */
type ReadonlyRef<T> = { readonly value: T }

const JOINT_LABELS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']

/**
 * 跨面板共享的机器人控制切片（由 App 单一实例化并 provide，整个子树可 inject）。
 * 读切片只读展示；动作切片由本模块持有编排所有权（如 setJoint 先停程序再运动）。
 * 该接口只暴露面板需要的紧凑视图，不把 MotionRunner / ProgramSession 内部泄漏给组件。
 */
export interface RobotController {
  /** 共享关节读状态。 */
  joints: ReadonlyRef<JointAngles>
  jointRanges: readonly JointRange[]
  jointStep: ReadonlyRef<JointStep>
  pose: ReadonlyRef<PoseDisplay>
  /** 笛卡尔读状态。 */
  coordinateSystem: ReadonlyRef<CoordinateSystem>
  positionStep: ReadonlyRef<PositionStep>
  orientationStep: ReadonlyRef<OrientationStep>
  status: ReadonlyRef<CartesianStatus>
  statusMessage: ReadonlyRef<string>
  /** 关节动作。 */
  setJoint(index: number, value: number): void
  adjustJoint(index: number, direction: JointDirection, isContinuous?: boolean): void
  beginJointContinuous(index: number, direction: JointDirection): void
  endJointContinuous(): void
  setStep(value: number): void
  reset(): void
  resetMechanicalZero(): void
  randomize(): void
  /** 笛卡尔动作。 */
  moveCartesian(axis: CartesianAxis, direction: CartesianDirection, isContinuous?: boolean): void
  beginCartesianContinuous(axis: CartesianAxis, direction: CartesianDirection): void
  endCartesianContinuous(): void
  setCoordinateSystem(value: CoordinateSystem): void
  setPositionStep(value: number): void
  setOrientationStep(value: number): void
}

export const RobotControllerKey: InjectionKey<RobotController> = Symbol('robot-controller')

/** 由 App 在 setup 中调用一次，把共享机器人控制切片提供给左侧 Jog 工作区子树。 */
export function provideRobotController(controller: RobotController): void {
  provide(RobotControllerKey, controller)
}

/** 子面板 inject；无提供方（如独立测试挂载）时返回 null，由组件回退到自己的 props。 */
export function injectRobotController(): RobotController | null {
  return inject(RobotControllerKey, null)
}

/**
 * 手动运动抢占的公共前置步骤：先结束笛卡尔连续点动会话，再停止当前活动 RAPID 程序。
 * 任何要启动手动运动的入口（关节 Jog、末端拖拽 gizmo）都必须先做这两步，
 * 确保"停止程序在先，运动在后"这条不变量只在一处维护，不逐个入口手写。
 */
export function preemptManualMotion(deps: {
  endCartesianContinuous: () => void
  stopActiveProgram: () => void
}): void {
  deps.endCartesianContinuous()
  deps.stopActiveProgram()
}

export interface RobotControllerDeps {
  profile: RobotProfile
  joints: Ref<JointAngles>
  jointRanges: readonly JointRange[]
  jointStep: ReadonlyRef<JointStep>
  pose: ReadonlyRef<PoseDisplay>
  setStep: (value: number) => void
  motionCoordinator: MotionCoordinator
  /** 停止当前活动 RAPID 程序；来自 ProgramSession.stopActiveProgram。 */
  stopActiveProgram: () => void
  runLog: RunLogController
  cartesian: {
    coordinateSystem: ReadonlyRef<CoordinateSystem>
    positionStep: ReadonlyRef<PositionStep>
    orientationStep: ReadonlyRef<OrientationStep>
    status: ReadonlyRef<CartesianStatus>
    statusMessage: ReadonlyRef<string>
    move: (axis: CartesianAxis, direction: CartesianDirection, isContinuous?: boolean) => void
    beginContinuous: (axis: CartesianAxis, direction: CartesianDirection) => void
    endContinuous: () => void
    setCoordinateSystem: (value: CoordinateSystem) => void
    setPositionStep: (value: number) => void
    setOrientationStep: (value: number) => void
  }
}

/**
 * 组装真正的 RobotController 深模块：七处手动 Jog 入口共用的"先抢占、再提交、再记日志"
 * 编排逻辑在此实现一次；每个入口彼此的既有差异（setJoint 额外的 stop('superseded') 与
 * 失败告警、连续 Jog tick 不记日志）原样保留为参数化分支，不做行为统一。
 */
export function useRobotController(deps: RobotControllerDeps): RobotController {
  const {
    profile,
    joints,
    jointRanges,
    jointStep,
    pose,
    setStep,
    motionCoordinator,
    stopActiveProgram,
    runLog,
    cartesian,
  } = deps

  function preempt(): void {
    preemptManualMotion({ endCartesianContinuous: cartesian.endContinuous, stopActiveProgram })
  }

  /** 数值输入同样通过 Core 与 Coordinator 提交，使用 1ms 缓动保持近似即时的面板语义。 */
  function setJoint(index: number, value: number): void {
    preempt()
    motionCoordinator.stop('superseded')
    const before = joints.value[index]
    const target = [...joints.value] as JointAngles
    target[index] = value
    void motionCoordinator
      .submit({
        kind: 'move',
        source: 'manual-joint',
        request: createJointTargetRequest(joints.value, target, profile),
        playback: 'immediate',
      })
      .then((outcome) => {
        if (!outcome.ok && outcome.reason === 'planning-failure') {
          runLog.warn(
            '运动',
            `J${index + 1} 目标被 Core 拒绝：${outcome.result?.ok === false ? outcome.result.error.code : outcome.reason}`,
          )
        }
      })
    runLog.info('运动', `J${index + 1} ${before.toFixed(1)}° → ${value.toFixed(1)}°`)
  }

  function adjustJoint(index: number, direction: JointDirection, isContinuous = false): void {
    if (!isContinuous) cartesian.endContinuous()
    stopActiveProgram()
    const next = adjustJointAngle(
      joints.value,
      index,
      direction,
      jointStep.value,
      profile.jointRanges,
    )
    if (isContinuous) {
      void motionCoordinator.submit({
        kind: 'continuous-update',
        source: 'manual-joint',
        request: createJointTargetRequest(joints.value, next, profile),
        playback: 'speed-limited',
      })
    } else {
      void motionCoordinator.submit({
        kind: 'move',
        source: 'manual-joint',
        request: createJointTargetRequest(joints.value, next, profile),
        playback: 'eased',
      })
      // 只有离散单步才记日志；按住连续 Jog 的 80ms 高频 tick 不做逐条记录以免刷屏。
      runLog.info(
        '运动',
        `${JOINT_LABELS[index] ?? `J${index + 1}`} 单步 ${
          direction > 0 ? '+' : '−'
        }${jointStep.value}° → ${next[index].toFixed(1)}°`,
      )
    }
  }

  function beginJointContinuous(index: number, direction: JointDirection): void {
    preempt()
    void motionCoordinator.submit({ kind: 'continuous-begin', source: 'manual-joint' })
    runLog.info(
      '运动',
      `${JOINT_LABELS[index] ?? `J${index + 1}`} 开始连续 Jog（${direction > 0 ? '+' : '−'}）`,
    )
  }

  function endJointContinuous(): void {
    void motionCoordinator.submit({ kind: 'continuous-end', source: 'manual-joint' })
  }

  function reset(): void {
    preempt()
    void motionCoordinator.submit({
      kind: 'move',
      source: 'manual-joint',
      request: createJointTargetRequest(
        joints.value,
        [...profile.homeJoints] as JointAngles,
        profile,
      ),
      playback: 'eased',
    })
    runLog.info('运动', '机器人回到教学 Home')
  }

  function resetMechanicalZero(): void {
    preempt()
    void motionCoordinator.submit({
      kind: 'move',
      source: 'manual-joint',
      request: createJointTargetRequest(
        joints.value,
        [...profile.mechanicalZeroJoints] as JointAngles,
        profile,
      ),
      playback: 'eased',
    })
    runLog.info('运动', '机器人回到 ABB 机械零位')
  }

  function randomize(): void {
    preempt()
    void motionCoordinator.submit({
      kind: 'move',
      source: 'manual-joint',
      request: createJointTargetRequest(
        joints.value,
        randomJointAngles(profile.jointRanges),
        profile,
      ),
      playback: 'eased',
    })
    runLog.info('运动', '随机生成姿态')
  }

  return {
    joints,
    jointRanges,
    jointStep,
    pose,
    coordinateSystem: cartesian.coordinateSystem,
    positionStep: cartesian.positionStep,
    orientationStep: cartesian.orientationStep,
    status: cartesian.status,
    statusMessage: cartesian.statusMessage,
    setJoint,
    adjustJoint,
    beginJointContinuous,
    endJointContinuous,
    setStep,
    reset,
    resetMechanicalZero,
    randomize,
    moveCartesian: (axis, direction, isContinuous) => {
      // 先结束程序语义，再由 Coordinator 接管运动；正常抢占不能被程序当成 stale 错误。
      stopActiveProgram()
      cartesian.move(axis, direction, isContinuous)
    },
    beginCartesianContinuous: (axis, direction) => {
      preempt()
      cartesian.beginContinuous(axis, direction)
    },
    endCartesianContinuous: cartesian.endContinuous,
    setCoordinateSystem: cartesian.setCoordinateSystem,
    setPositionStep: cartesian.setPositionStep,
    setOrientationStep: cartesian.setOrientationStep,
  }
}
