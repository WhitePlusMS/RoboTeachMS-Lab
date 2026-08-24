import {
  quaternionToRotationMatrix,
  rotationMatrixToEulerZYX,
  rotationMatrixToQuaternion,
} from '@/robotics/math/rotation3d.ts'
import type { RobotModel } from './robot-model.ts'
import type { IKSolverConfig, JointAngles, Pose } from './types.ts'
import {
  MAX_JOINT_STEP_DEG,
  solvePoseWaypoints,
  type WaypointFailureDiagnostic,
  type WaypointFailureReason,
  type WaypointSolveResult,
} from './ik-waypoint-solver.ts'

export type CartesianPathFailure = WaypointFailureReason
export type CartesianPathResult = WaypointSolveResult
export type { WaypointFailureDiagnostic }

const DEFAULT_LINEAR_STEP_MM = 1
const DEFAULT_ANGULAR_STEP_RAD = Math.PI / 180
/** waypoint 采样上限：仅作为「单条 MoveL 的采样点数」性能护栏，不再据此拒绝长距离轨迹。 */
const MAX_WAYPOINTS = 200
/**
 * 只为临界关节步长失败提供有限的路径加密预算。
 * 180° 构型跳变不会进入该重试，因此不会通过无限加密掩盖真实构型问题。
 */
const MAX_ADAPTIVE_WAYPOINTS = MAX_WAYPOINTS * 4
const MAX_ADAPTIVE_RETRIES = 2
const ADAPTIVE_STEP_RETRY_FACTOR = 2
/** MoveL 逆解精度：延续原内联实现的紧容差（教学定位精度），逆解交由共享多初值求解器执行。 */
const MOVE_L_IK_CONFIG: Partial<IKSolverConfig> = {
  maxIterations: 150,
  posTolerance: 0.05,
  oriTolerance: 0.001,
}

type Quaternion = [number, number, number, number]

function normalizeQuaternion(quaternion: Quaternion): Quaternion {
  const length = Math.hypot(...quaternion)
  return quaternion.map((value) => value / length) as Quaternion
}

function slerpQuaternion(start: Quaternion, target: Quaternion, progress: number): Quaternion {
  let end = target
  let dot = start.reduce((sum, value, index) => sum + value * target[index], 0)
  if (dot < 0) {
    end = target.map((value) => -value) as Quaternion
    dot = -dot
  }
  if (dot > 0.9995) {
    return normalizeQuaternion(
      start.map((value, index) => value + (end[index] - value) * progress) as Quaternion,
    )
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
  const denominator = Math.sin(angle)
  const startWeight = Math.sin((1 - progress) * angle) / denominator
  const endWeight = Math.sin(progress * angle) / denominator
  return start.map((value, index) => value * startWeight + end[index] * endWeight) as Quaternion
}

/**
 * 规划器只依赖 RobotModel 的 FK/Jacobian seam，因此 ABB 之外的六轴设备也能复用；
 * 调用方只负责播放返回的关节 waypoint，不需要了解内部插补和 IK 细节。
 *
 * 可选 `opts`（票据 02，MoveL 带自定义 Tool/WObj 时）：
 * - `tcpStart`：直线插补的起点 TCP 位姿（默认取 `model.forwardKinematics(initialJoints)`，
 *   即“法兰即 TCP”的 tool0/wobj0 快照）。提供后插补在 TCP 空间进行。
 * - `toFlange`：把插补得到的 TCP 位姿变换为机械法兰位姿后再送入 IK；缺省为原样（tool0 时法兰=TCP）。
 * 未提供 options 时行为与旧版一致（Jog 笛卡尔控制）。
 *
 * 腕部奇异回退由底层 IK 根据当前关节是否处于机械零位腕部邻域自动判断，不再通过
 * `orientationMode` 显式开关控制。
 */
export function planCartesianPath(
  targetPose: Pose,
  initialJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  opts?: {
    tcpStart?: Pose
    toFlange?: (pose: Pose) => Pose
  },
): CartesianPathResult {
  const startPose = opts?.tcpStart ?? model.forwardKinematics(initialJoints)
  if (!startPose) return { ok: false, failure: 'ik-not-converged' }
  const toFlange = opts?.toFlange ?? ((pose: Pose) => pose)

  const distance = Math.hypot(
    targetPose.position[0] - startPose.position[0],
    targetPose.position[1] - startPose.position[1],
    targetPose.position[2] - startPose.position[2],
  )
  const startQuaternion = rotationMatrixToQuaternion(startPose.rotation)
  const targetQuaternion = rotationMatrixToQuaternion(targetPose.rotation)
  const quaternionDot = Math.abs(
    startQuaternion.reduce((sum, value, index) => sum + value * targetQuaternion[index], 0),
  )
  const angularDistance = 2 * Math.acos(Math.max(-1, Math.min(1, quaternionDot)))
  // 初始采样：短路径用细步距保精度，长路径先用性能护栏限制到 MAX_WAYPOINTS。
  const initialLinearStep = Math.max(DEFAULT_LINEAR_STEP_MM, distance / MAX_WAYPOINTS)
  const initialAngularStep = Math.max(DEFAULT_ANGULAR_STEP_RAD, angularDistance / MAX_WAYPOINTS)
  const initialSegmentCount = Math.max(
    1,
    Math.ceil(distance / initialLinearStep),
    Math.ceil(angularDistance / initialAngularStep),
  )

  const buildPoses = (segmentCount: number): Pose[] => {
    const poses: Pose[] = []
    for (let segment = 1; segment <= segmentCount; segment += 1) {
      const progress = segment / segmentCount
      const waypointRotation = quaternionToRotationMatrix(
        slerpQuaternion(startQuaternion, targetQuaternion, progress),
      )
      poses.push({
        position: startPose.position.map(
          (value, axis) => value + (targetPose.position[axis] - value) * progress,
        ) as Pose['position'],
        euler: rotationMatrixToEulerZYX(waypointRotation),
        rotation: waypointRotation,
      })
    }
    return poses
  }

  const solveAtSegmentCount = (segmentCount: number): CartesianPathResult =>
    solvePoseWaypoints(
      buildPoses(segmentCount),
      initialJoints,
      model,
      jointRanges,
      toFlange,
      // 始终先使用完整位姿 IK；`solvePoseWaypoints` 只在单个 waypoint
      // 接近腕部奇异或发生构型重新分配时，按算法自动局部回退。
      MOVE_L_IK_CONFIG,
    )

  let segmentCount = initialSegmentCount
  let result = solveAtSegmentCount(segmentCount)
  for (let retry = 0; retry < MAX_ADAPTIVE_RETRIES; retry += 1) {
    if (result.ok || result.failure !== 'joint-step') return result
    // 只有“略微超过”连续性阈值才值得加密；大步长很可能是构型跳变，
    // 必须保留失败并交给上层提示用户调整姿态/先脱离奇异点。
    const delta = result.diagnostic?.deltaDeg
    if (delta === undefined || delta > MAX_JOINT_STEP_DEG * 2) return result
    const nextSegmentCount = Math.min(
      MAX_ADAPTIVE_WAYPOINTS,
      segmentCount * ADAPTIVE_STEP_RETRY_FACTOR,
    )
    if (nextSegmentCount <= segmentCount) return result
    segmentCount = nextSegmentCount
    result = solveAtSegmentCount(segmentCount)
  }
  return result
}
