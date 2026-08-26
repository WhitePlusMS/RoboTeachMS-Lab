import type { JointAngles, Pose } from '../../model/joint-pose.ts'
import type { MotionError, MotionPlanningResultOk } from '../../../robot-motion-core/index.ts'

/** 已应用的腕部奇异处理模式。 */
export type AppliedSingularityMode = 'wrist'

/** 笛卡尔 waypoint 规划对上层公开的失败原因。 */
export type WaypointFailureReason =
  'wrist-singularity' | 'wrist-reconfiguration' | 'joint-limit' | 'joint-step' | 'ik-not-converged'

/** 在 waypoint 之间传递的腕部奇异处理上下文。 */
export interface WristSingularityContext {
  /** 第一次脱离 J5≈0 时选择的目标 J5 侧。 */
  escapeDirection: -1 | 1
  /** 是否已经真正离开腕部奇异面。 */
  escapeDone: boolean
  /** 成功脱离后沿用的实际法兰姿态窗口。 */
  escapePose: Pick<Pose, 'euler' | 'rotation'> | null
}

/** 单个 waypoint 失败时的关节级诊断。 */
export interface JointFailureDetail {
  axisIndex: number
  previousAngleDeg: number
  attemptedAngleDeg?: number
  deltaDeg?: number
  limitRangeDeg?: readonly [number, number]
}

/** 路径失败诊断；waypointIndex 对用户展示时从 1 开始。 */
export interface WaypointFailureDiagnostic extends JointFailureDetail {
  waypointIndex: number
}

export type WaypointSolveResult =
  | {
      ok: true
      waypoints: JointAngles[]
      appliedSingularityMode: AppliedSingularityMode | null
      /** Core-backed callers retain the original pure plan for Coordinator submission. */
      corePlan?: MotionPlanningResultOk
    }
  | {
      ok: false
      failure: WaypointFailureReason
      diagnostic?: WaypointFailureDiagnostic
      /** Core 入口产生的机器错误；宿主据此生成场景化文案，不重复猜测失败原因。 */
      coreError?: MotionError
    }

export interface WaypointSolveOptions {
  /** 仅由 RAPID `SingArea\\Wrist` 或其他明确退化 intent 显式授权。 */
  allowWristFallback?: boolean
}

export type JointSolutionFailureReason = 'joint-limit' | 'unreachable' | 'joint-step'

export type JointSolutionFailure = {
  failure: JointSolutionFailureReason
  detail?: JointFailureDetail
}

export type JointSolutionResult =
  { joints: JointAngles; wristContext?: WristSingularityContext } | JointSolutionFailure
