import {
  quaternionToRotationMatrix,
  rotationMatrixToEulerZYX,
  rotationMatrixToQuaternion,
} from '@/robotics/math/rotation3d.ts'
import type { RobotModel } from './robot-model.ts'
import type { IKSolverConfig, JointAngles, Pose } from './types.ts'
import { solvePoseWaypoints } from './ik-waypoint-solver.ts'

const DEFAULT_LINEAR_STEP_MM = 1
const DEFAULT_ANGULAR_STEP_RAD = Math.PI / 180
/** waypoint 采样上限：仅作为「单条 MoveL 的采样点数」性能护栏，不再据此拒绝长距离轨迹。 */
const MAX_WAYPOINTS = 200
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
 * 把单个笛卡尔目标拆成短直线段，并用上一段的关节解继续求下一段。
 *
 * 规划器只依赖 RobotModel 的 FK/Jacobian seam，因此 ABB 之外的六轴设备也能复用；
 * 调用方只负责播放返回的关节 waypoint，不需要了解内部插补和 IK 细节。
 */
/**
 * 规划器只依赖 RobotModel 的 FK/Jacobian seam，因此 ABB 之外的六轴设备也能复用；
 * 调用方只负责播放返回的关节 waypoint，不需要了解内部插补和 IK 细节。
 *
 * 可选 `opts`（票据 02，MoveL 带自定义 Tool/WObj 时）：
 * - `tcpStart`：直线插补的起点 TCP 位姿（默认取 `model.forwardKinematics(initialJoints)`，
 *   即“法兰即 TCP”的 tool0/wobj0 快照）。提供后插补在 TCP 空间进行。
 * - `toFlange`：把插补得到的 TCP 位姿变换为机械法兰位姿后再送入 IK；缺省为原样（tool0 时法兰=TCP）。
 * 未提供两参数时行为与旧版一致（Jog 笛卡尔控制）。
 */
export function planCartesianPath(
  targetPose: Pose,
  initialJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  opts?: { tcpStart?: Pose; toFlange?: (pose: Pose) => Pose },
): JointAngles[] | null {
  const startPose = opts?.tcpStart ?? model.forwardKinematics(initialJoints)
  if (!startPose) return null
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
  // 自适应步距：短路径用细步距保精度（连续直线/姿态采样），长路径自动放宽步距，
  // 使 waypoint 数始终被 MAX_WAYPOINTS 钳制——不再存在「距离超过上限即 unreachable」的拒绝。
  const linearStep = Math.max(DEFAULT_LINEAR_STEP_MM, distance / MAX_WAYPOINTS)
  const angularStep = Math.max(DEFAULT_ANGULAR_STEP_RAD, angularDistance / MAX_WAYPOINTS)
  const segmentCount = Math.max(
    1,
    Math.ceil(distance / linearStep),
    Math.ceil(angularDistance / angularStep),
  )
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

  // 逆解交给 MoveL/MoveC 共享的多初值逐点求解器（含相邻构型跳变护栏），
  // 并保持 MoveL 原有的紧 IK 容差。
  return solvePoseWaypoints(poses, initialJoints, model, jointRanges, toFlange, MOVE_L_IK_CONFIG)
}
