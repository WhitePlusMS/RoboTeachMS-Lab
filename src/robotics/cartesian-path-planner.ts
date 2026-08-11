import { solveIK } from './ik-solver.ts'
import {
  quaternionToRotationMatrix,
  rotationMatrixToEulerZYX,
  rotationMatrixToQuaternion,
} from './math/rotation3d.ts'
import type { RobotModel } from './robot-model.ts'
import type { JointAngles, Pose } from './types.ts'

const DEFAULT_LINEAR_STEP_MM = 1
const DEFAULT_ANGULAR_STEP_RAD = Math.PI / 180
const MAX_JOINT_STEP_DEG = 5
const MAX_WAYPOINTS = 200

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
  return start.map((value, index) =>
    value * startWeight + end[index] * endWeight,
  ) as Quaternion
}

/**
 * 把单个笛卡尔目标拆成短直线段，并用上一段的关节解继续求下一段。
 *
 * 规划器只依赖 RobotModel 的 FK/Jacobian seam，因此 ABB 之外的六轴设备也能复用；
 * 调用方只负责播放返回的关节 waypoint，不需要了解内部插补和 IK 细节。
 */
export function planCartesianPath(
  targetPose: Pose,
  initialJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
): JointAngles[] | null {
  const startPose = model.forwardKinematics(initialJoints)
  if (!startPose) return null

  const distance = Math.hypot(
    targetPose.position[0] - startPose.position[0],
    targetPose.position[1] - startPose.position[1],
    targetPose.position[2] - startPose.position[2],
  )
  const startQuaternion = rotationMatrixToQuaternion(startPose.rotation)
  const targetQuaternion = rotationMatrixToQuaternion(targetPose.rotation)
  const quaternionDot = Math.abs(startQuaternion.reduce(
    (sum, value, index) => sum + value * targetQuaternion[index],
    0,
  ))
  const angularDistance = 2 * Math.acos(Math.max(-1, Math.min(1, quaternionDot)))
  const segmentCount = Math.max(
    1,
    Math.ceil(distance / DEFAULT_LINEAR_STEP_MM),
    Math.ceil(angularDistance / DEFAULT_ANGULAR_STEP_RAD),
  )
  if (segmentCount > MAX_WAYPOINTS) return null
  const waypoints: JointAngles[] = []
  let previousJoints = [...initialJoints] as JointAngles

  for (let segment = 1; segment <= segmentCount; segment += 1) {
    const progress = segment / segmentCount
    const waypointRotation = quaternionToRotationMatrix(
      slerpQuaternion(startQuaternion, targetQuaternion, progress),
    )
    const waypointPose: Pose = {
      position: startPose.position.map((value, axis) =>
        value + (targetPose.position[axis] - value) * progress,
      ) as Pose['position'],
      euler: rotationMatrixToEulerZYX(waypointRotation),
      rotation: waypointRotation,
    }
    const solved = solveIK(
      waypointPose,
      previousJoints,
      model,
      { maxIterations: 150, posTolerance: 0.05, oriTolerance: 0.001 },
      jointRanges,
    )
    if (!solved) return null
    const maxJointStep = Math.max(...solved.map((value, index) =>
      Math.abs(value - previousJoints[index]),
    ))
    if (maxJointStep > MAX_JOINT_STEP_DEG) return null
    waypoints.push(solved)
    previousJoints = solved
  }

  return waypoints
}
