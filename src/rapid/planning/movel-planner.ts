import type { MotionResult } from '@/robotics/motion/runner.ts'
import type { MotionPlanningResultOk } from '@/robot-motion-core/index.ts'
import type { RobotModel } from '@/robotics/model/robot-model.ts'
import type { JointAngles } from '@/robotics/model/index.ts'
import {
  simulateDurationMs,
  validateMotionInput,
  type MotionPlanError,
} from './motion-input.ts'
import type { StructuredMoveL } from '../data/index.ts'
import { planMotion } from '@/robot-motion-core/index.ts'
import { abbConfigurationFromJoints } from '@/robot-models/abb-irb1200/index.ts'
import { coreConfigurationPolicy, coreRequest, coreSingularity, coreToolFromRapid, coreWorkObjectFromRapid, mapCoreFailure, poseDataFromRobTarget } from './core-motion.ts'

export type MoveLPlanResult =
  { ok: true; waypoints: JointAngles[]; durationMs: number; corePlan: MotionPlanningResultOk } | { ok: false; error: MotionPlanError }

/** MoveL 执行注入的运动执行 seam；规划层不自行操作 RAF 或插值关节。 */
export interface MoveLExecutionSeam {
  model: RobotModel
  currentJoints: () => JointAngles
  jointRanges: readonly (readonly [number, number])[]
  runTrajectory: (waypoints: readonly JointAngles[], durationMs: number, corePlan?: MotionPlanningResultOk) => Promise<MotionResult>
}

export type MoveLOutcome =
  { ok: true; result: MotionResult } | { ok: false; error: MotionPlanError }

/**
 * 校验并规划单条结构化 MoveL：复用现有 planCartesianPath 生成连续关节 waypoint。
 * 纯函数，不操作 RAF 或关节；规划错误（空路径/不可达/奇异附近/waypoint 上限/构型跳变）
 * 统一在运动启动前返回，不能先移动一部分再返回规划错误。
 *
 * 时长使用仿真近似：TCP 起点到终点笛卡尔距离 / v_tcp，转毫秒并保证正的有限值；
 * 姿态变化仍参与现有路径采样，但首期不实现 ABB 控制器的完整转向速度协调。
 */
export function planMoveL(
  movel: StructuredMoveL,
  model: RobotModel,
  currentJoints: JointAngles,
  _jointRanges: readonly (readonly [number, number])[],
  _options?: { preserveConfiguration?: boolean },
): MoveLPlanResult {
  const dataConfigError = validateMotionInput(
    movel.target,
    movel.speed,
    movel.tool,
    movel.wobj,
    movel.zone,
  )
  if (dataConfigError) return { ok: false, error: dataConfigError }

  const currentConfigurationTuple = abbConfigurationFromJoints(currentJoints)
  if (!currentConfigurationTuple) {
    return { ok: false, error: { kind: 'unreachable', message: '机器人模型不可用或正解失败' } }
  }
  const currentConfiguration = { cf1: currentConfigurationTuple[0], cf4: currentConfigurationTuple[1], cf6: currentConfigurationTuple[2], cfx: currentConfigurationTuple[3] }
  const configurationPolicy = movel.target.robconf.every((value) => value === 0)
    ? { kind: 'nearest-valid' as const }
    : coreConfigurationPolicy(movel.target, movel.confL ?? 'on', currentConfiguration)
  const planned = planMotion(coreRequest(currentJoints, {
    kind: 'linear-path',
    targetTcpPose: poseDataFromRobTarget(movel.target),
    tool: coreToolFromRapid(movel.tool),
    workObject: coreWorkObjectFromRapid(movel.wobj),
    speedMmPerSec: movel.speed.v_tcp,
    zone: movel.zone.finep ? 'fine' : 'fly-by',
    configurationPolicy,
    singularityPolicy: coreSingularity(movel.singArea ?? 'off'),
  }))
  if (!planned.ok) {
    const mapped = mapCoreFailure(planned)
    return { ok: false, error: mapped ?? { kind: 'unreachable', message: 'Core MoveL 规划失败' } }
  }

  // 仿真时长近似：TCP 起点到终点距离 / v_tcp，转毫秒并保证正的有限值。
  const durationMs = simulateDurationMs(model, currentJoints, movel.target.trans, movel.speed.v_tcp)
  if (durationMs === null) {
    return { ok: false, error: { kind: 'unreachable', message: '机器人模型不可用或正解失败' } }
  }

  const waypoints = planned.waypoints.slice(1).map((point) => [...point.jointsDeg] as JointAngles)
  return { ok: true, waypoints: waypoints.length > 0 ? waypoints : [[...currentJoints] as JointAngles], durationMs, corePlan: planned }
}

/**
 * 规划成功后整组 waypoint 只调用一次 MotionRunner 轨迹入口（不逐点提交），
 * 并把 completed/stopped 原样返回调用者；规划错误不触发任何运动。
 */
export async function executeMoveL(
  movel: StructuredMoveL,
  seam: MoveLExecutionSeam,
): Promise<MoveLOutcome> {
  const initialJoints = seam.currentJoints()
  const plan = planMoveL(movel, seam.model, initialJoints, seam.jointRanges)
  if (!plan.ok) return { ok: false, error: plan.error }
  const result = await seam.runTrajectory(plan.waypoints, plan.durationMs, plan.corePlan)
  return { ok: true, result }
}
