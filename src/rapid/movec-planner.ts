import type { MotionResult } from '@/robotics/motion/runner.ts'
import type { RobotModel } from '@/robotics/model/robot-model.ts'
import type { JointAngles, Pose } from '@/robotics/model/types.ts'
import { rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'
import {
  cartesianPathFailureToMotionError,
  validateMotionInput,
  type MotionPlanError,
} from './plan-shared.ts'
import { solvePoseWaypoints } from '@/robotics/inverse-kinematics/waypoint-solver.ts'
import { arcLengthMm, sampleArcPoses } from './arc-planner.ts'
import {
  flangeToWorldTcpPose,
  robTargetToWorldPose,
  worldTcpToFlangePose,
} from './coordinate-transform.ts'
import type { StructuredMoveC } from './rapid-types.ts'

export type MoveCPlanResult =
  { ok: true; waypoints: JointAngles[]; durationMs: number } | { ok: false; error: MotionPlanError }

/** MoveC 执行注入的运动执行 seam；规划层不自行操作 RAF 或插值关节。 */
export interface MoveCExecutionSeam {
  model: RobotModel
  currentJoints: () => JointAngles
  jointRanges: readonly (readonly [number, number])[]
  runTrajectory: (waypoints: readonly JointAngles[], durationMs: number) => Promise<MotionResult>
}

export type MoveCOutcome =
  { ok: true; result: MotionResult } | { ok: false; error: MotionPlanError }

/**
 * 校验并规划单条结构化 MoveC：以当前 TCP 为起点、圆点为途经点、终点为目标，
 * 在 TCP 空间构弧采样，再转法兰送 IK 得到关节 waypoint。纯函数，不操作 RAF 或关节。
 */
export function planMoveC(
  movec: StructuredMoveC,
  model: RobotModel,
  currentJoints: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
): MoveCPlanResult {
  // 校验终点与圆点，以及各运动数据：圆点也是完整 robtarget，需单独过同一套校验，
  // 否则圆点中的 NaN/Infinity/零四元数会流入坐标求值、圆弧与 IK（表现为 unreachable 而非 invalid-data）。
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

  const currentFlange = model.forwardKinematics(currentJoints)
  if (!currentFlange) {
    return { ok: false, error: { kind: 'unreachable', message: '机器人模型不可用或正解失败' } }
  }

  const startTcp = flangeToWorldTcpPose(currentFlange, movec.tool)
  const cirTcp = robTargetToWorldPose(movec.cirPoint, movec.wobj)
  const targetTcp = robTargetToWorldPose(movec.target, movec.wobj)

  // 圆弧采样：三点定圆，姿态在首末间 slerp。q0/q2 用机器人核心的内部四元数序
  // [x,y,z,w]（sampleArcPoses 内部按同样序 slerp 并交给 quaternionToRotationMatrix），
  // 不得在此包成 RAPID [w,x,y,z] 序，否则制造出错误的旋转矩阵，IK 必然失败。
  const q0 = rotationMatrixToQuaternion(startTcp.rotation)
  const q2 = rotationMatrixToQuaternion(targetTcp.rotation)
  const segmentCount = computeSegmentCount(startTcp, targetTcp)
  const poses = sampleArcPoses(
    startTcp.position,
    cirTcp.position,
    targetTcp.position,
    q0,
    q2,
    segmentCount,
  )
  if (!poses) {
    return {
      ok: false,
      error: { kind: 'unreachable', message: '起点/圆点/终点三点无法确定圆弧（共线或过近）' },
    }
  }

  const waypoints = solvePoseWaypoints(
    poses,
    currentJoints,
    model,
    jointRanges,
    (tcp) => worldTcpToFlangePose(tcp, movec.tool),
    // 由共享 waypoint 求解器逐点决定是否需要腕部姿态回退，不能把整条圆弧
    // 预先降级为 position-only，否则非奇异段也会丢失编程姿态。
    {},
    { allowWristFallback: movec.singArea === 'wrist' },
  )
  if (!waypoints.ok || waypoints.waypoints.length === 0) {
    if (!waypoints.ok) {
      return {
        ok: false,
        error: cartesianPathFailureToMotionError(waypoints.failure, waypoints.diagnostic),
      }
    }
    return {
      ok: false,
      error: {
        kind: 'unreachable',
        message: '圆弧路径不可达、接近奇异或超过 waypoint/构型跳变限制',
      },
    }
  }

  // 时长近似：圆弧弧长 / v_tcp，转毫秒并保证正的有限值。
  const arcLen = arcLengthMm(startTcp.position, cirTcp.position, targetTcp.position)
  const distance =
    arcLen ??
    Math.hypot(
      targetTcp.position[0] - startTcp.position[0],
      targetTcp.position[1] - startTcp.position[1],
      targetTcp.position[2] - startTcp.position[2],
    )
  const durationMs = (distance / movec.speed.v_tcp) * 1000
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? Math.max(durationMs, 1) : 1

  return { ok: true, waypoints: waypoints.waypoints, durationMs: safeDuration }
}

/** 圆弧采样点数：按 TCP 弧长自适应，钳制到性能护栏。 */
function computeSegmentCount(start: Pose, target: Pose): number {
  const distance = Math.hypot(
    target.position[0] - start.position[0],
    target.position[1] - start.position[1],
    target.position[2] - start.position[2],
  )
  // 圆弧曲率可能让关节变化明显大于 TCP 弧长比例；1 mm 的采样上限给 5°
  // 相邻关节步长护栏留出余量，避免把本来连续的圆弧误判为构型跳变。
  return Math.min(200, Math.max(2, Math.ceil(distance)))
}

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
  const result = await seam.runTrajectory(plan.waypoints, plan.durationMs)
  return { ok: true, result }
}
