import type { MotionResult } from '@/robotics/motion/runner.ts'
import type { MotionPlanningResultOk } from '@/robot-motion-core/index.ts'
import type { RobotModel } from '@/robotics/model/robot-model.ts'
import type { JointAngles } from '@/robotics/model/index.ts'
import {
  validateMotionInput,
  type MotionPlanError,
} from './motion-input.ts'
import type { StructuredMoveC } from '../data/index.ts'
import { planMotion } from '@/robot-motion-core/index.ts'
import { abbConfigurationFromJoints } from '@/robot-models/abb-irb1200/index.ts'
import { coreConfigurationPolicy, coreRequest, coreSingularity, coreToolFromRapid, coreWorkObjectFromRapid, mapCoreFailure, poseDataFromRobTarget } from './core-motion.ts'

export type MoveCPlanResult =
  { ok: true; waypoints: JointAngles[]; durationMs: number; corePlan: MotionPlanningResultOk } | { ok: false; error: MotionPlanError }

/** MoveC 执行注入的运动执行 seam；规划层不自行操作 RAF 或插值关节。 */
export interface MoveCExecutionSeam {
  model: RobotModel
  currentJoints: () => JointAngles
  jointRanges: readonly (readonly [number, number])[]
  runTrajectory: (waypoints: readonly JointAngles[], durationMs: number, corePlan?: MotionPlanningResultOk) => Promise<MotionResult>
}

export type MoveCOutcome =
  { ok: true; result: MotionResult } | { ok: false; error: MotionPlanError }

/**
 * 校验并规划单条结构化 MoveC：以当前 TCP 为起点、圆点为途经点、终点为目标，
 * 在 TCP 空间构弧采样，再转法兰送 IK 得到关节 waypoint。纯函数，不操作 RAF 或关节。
 */
export function planMoveC(
  movec: StructuredMoveC,
  _model: RobotModel,
  currentJoints: JointAngles,
  _jointRanges: readonly (readonly [number, number])[],
  _options?: { preserveConfiguration?: boolean },
): MoveCPlanResult {
  // 校验终点与圆点，以及各运动数据：圆点也是完整 robtarget，需单独过同一套校验。
  const cirError = validateMotionInput(
    movec.cirPoint,
    movec.speed,
    movec.tool,
    movec.wobj,
    movec.zone,
  )
  if (cirError) return { ok: false, error: cirError }
  const targetError = validateMotionInput(
    movec.target,
    movec.speed,
    movec.tool,
    movec.wobj,
    movec.zone,
  )
  if (targetError) return { ok: false, error: targetError }

  const currentConfigurationTuple = abbConfigurationFromJoints(currentJoints)
  if (!currentConfigurationTuple) return { ok: false, error: { kind: 'unreachable', message: '当前关节无法推导 ABB robconf' } }
  const currentConfiguration = { cf1: currentConfigurationTuple[0], cf4: currentConfigurationTuple[1], cf6: currentConfigurationTuple[2], cfx: currentConfigurationTuple[3] }
  const configurationPolicy = movec.target.robconf.every((value) => value === 0)
    ? { kind: 'nearest-valid' as const }
    : coreConfigurationPolicy(movec.target, movec.confL ?? 'on', currentConfiguration)
  const planned = planMotion(coreRequest(currentJoints, {
    kind: 'circular-path',
    viaTcpPose: poseDataFromRobTarget(movec.cirPoint),
    targetTcpPose: poseDataFromRobTarget(movec.target),
    tool: coreToolFromRapid(movec.tool),
    workObject: coreWorkObjectFromRapid(movec.wobj),
    speedMmPerSec: movec.speed.v_tcp,
    zone: movec.zone.finep ? 'fine' : 'fly-by',
    configurationPolicy,
    singularityPolicy: coreSingularity(movec.singArea ?? 'off'),
  }))
  if (!planned.ok) {
    const mapped = mapCoreFailure(planned)
    return { ok: false, error: mapped ?? { kind: 'unreachable', message: 'Core MoveC 规划失败' } }
  }
  const waypoints = planned.waypoints.slice(1).map((point) => [...point.jointsDeg] as JointAngles)
  const durationMs = Math.max(1, planned.waypoints.at(-1)?.timeMs ?? 1)
  return { ok: true, waypoints: waypoints.length > 0 ? waypoints : [[...currentJoints] as JointAngles], durationMs, corePlan: planned }
}

/** 圆弧采样点数：按 TCP 弧长自适应，钳制到性能护栏。 */
/**
 * 规划成功后整组 waypoint 只调用一次 MotionRunner 轨迹入口，并把
 * completed/stopped 原样返回调用者；规划错误不触发任何运动。
 */
export async function executeMoveC(
  movec: StructuredMoveC,
  seam: MoveCExecutionSeam,
): Promise<MoveCOutcome> {
  const plan = planMoveC(movec, seam.model, seam.currentJoints(), seam.jointRanges)
  if (!plan.ok) return { ok: false, error: plan.error }
  const result = await seam.runTrajectory(plan.waypoints, plan.durationMs, plan.corePlan)
  return { ok: true, result }
}
