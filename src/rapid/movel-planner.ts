import { planCartesianPath } from '../robotics/cartesian-path-planner.ts'
import type { MotionResult } from '../robotics/motion-runner.ts'
import type { RobotModel } from '../robotics/robot-model.ts'
import type { JointAngles } from '../robotics/types.ts'
import {
  simulateDurationMs,
  validateMotionInput,
  type MotionPlanError,
} from './plan-shared.ts'
import { flangeToWorldTcpPose, robTargetToWorldPose, worldTcpToFlangePose } from './coordinate-transform.ts'
import type { StructuredMoveL } from './rapid-types.ts'

export type MoveLPlanResult =
  | { ok: true; waypoints: JointAngles[]; durationMs: number }
  | { ok: false; error: MotionPlanError }

/** MoveL 执行注入的运动执行 seam；规划层不自行操作 RAF 或插值关节。 */
export interface MoveLExecutionSeam {
  model: RobotModel
  currentJoints: () => JointAngles
  jointRanges: readonly (readonly [number, number])[]
  runTrajectory: (waypoints: readonly JointAngles[], durationMs: number) => Promise<MotionResult>
}

export type MoveLOutcome =
  | { ok: true; result: MotionResult }
  | { ok: false; error: MotionPlanError }

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
  jointRanges: readonly (readonly [number, number])[],
): MoveLPlanResult {
  const dataConfigError = validateMotionInput(
    movel.target,
    movel.speed,
    movel.tool,
    movel.wobj,
    movel.zone,
  )
  if (dataConfigError) return { ok: false, error: dataConfigError }

  const currentFlange = model.forwardKinematics(currentJoints)
  if (!currentFlange) {
    return { ok: false, error: { kind: 'unreachable', message: '机器人模型不可用或正解失败' } }
  }
  // MoveL 要求 TCP 走直线：以当前法兰→工具得到的 TCP 为起点、robtarget 世界 TCP 为终点，
  // 在 TCP 空间插补，再逐点把 TCP 转回机械法兰送入 IK。
  const tcpTarget = robTargetToWorldPose(movel.target, movel.wobj)
  const waypoints = planCartesianPath(
    tcpTarget,
    currentJoints,
    model,
    jointRanges,
    {
      tcpStart: flangeToWorldTcpPose(currentFlange, movel.tool),
      toFlange: (tcp) => worldTcpToFlangePose(tcp, movel.tool),
    },
  )
  if (!waypoints || waypoints.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'unreachable',
        message: '直线路径不可达、接近奇异或超过 waypoint/构型跳变限制',
      },
    }
  }

  // 仿真时长近似：TCP 起点到终点距离 / v_tcp，转毫秒并保证正的有限值。
  const durationMs = simulateDurationMs(model, currentJoints, movel.target.trans, movel.speed.v_tcp)
  if (durationMs === null) {
    return { ok: false, error: { kind: 'unreachable', message: '机器人模型不可用或正解失败' } }
  }

  return { ok: true, waypoints, durationMs }
}

/**
 * 规划成功后整组 waypoint 只调用一次 MotionRunner 轨迹入口（不逐点提交），
 * 并把 completed/stopped 原样返回调用者；规划错误不触发任何运动。
 */
export async function executeMoveL(
  movel: StructuredMoveL,
  seam: MoveLExecutionSeam,
): Promise<MoveLOutcome> {
  const plan = planMoveL(movel, seam.model, seam.currentJoints(), seam.jointRanges)
  if (!plan.ok) return { ok: false, error: plan.error }
  const result = await seam.runTrajectory(plan.waypoints, plan.durationMs)
  return { ok: true, result }
}
