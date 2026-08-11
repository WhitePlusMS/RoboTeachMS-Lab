import { solveIK } from './ik-solver'
import {
  quaternionToRotationMatrix,
  rotationMatrixToEulerZYX,
  type RotationMatrix,
} from './math/rotation3d'
import type { RobotModel } from './robot-model'
import type { JointAngles, Pose } from './types'

const DEFAULT_LINEAR_STEP_MM = 1
const DEFAULT_ANGULAR_STEP_RAD = Math.PI / 180
const MAX_JOINT_STEP_DEG = 5
const MAX_WAYPOINTS = 200

type Quaternion = [number, number, number, number]

function normalizeQuaternion(quaternion: Quaternion): Quaternion {
  const length = Math.hypot(...quaternion)
  return quaternion.map((value) => value / length) as Quaternion
}

function rotationToQuaternion(rotation: RotationMatrix): Quaternion {
  const trace = rotation[0][0] + rotation[1][1] + rotation[2][2]
  let quaternion: Quaternion
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2
    quaternion = [
      (rotation[2][1] - rotation[1][2]) / scale,
      (rotation[0][2] - rotation[2][0]) / scale,
      (rotation[1][0] - rotation[0][1]) / scale,
      scale / 4,
    ]
  } else if (rotation[0][0] > rotation[1][1] && rotation[0][0] > rotation[2][2]) {
    const scale = Math.sqrt(1 + rotation[0][0] - rotation[1][1] - rotation[2][2]) * 2
    quaternion = [
      scale / 4,
      (rotation[0][1] + rotation[1][0]) / scale,
      (rotation[0][2] + rotation[2][0]) / scale,
      (rotation[2][1] - rotation[1][2]) / scale,
    ]
  } else if (rotation[1][1] > rotation[2][2]) {
    const scale = Math.sqrt(1 + rotation[1][1] - rotation[0][0] - rotation[2][2]) * 2
    quaternion = [
      (rotation[0][1] + rotation[1][0]) / scale,
      scale / 4,
      (rotation[1][2] + rotation[2][1]) / scale,
      (rotation[0][2] - rotation[2][0]) / scale,
    ]
  } else {
    const scale = Math.sqrt(1 + rotation[2][2] - rotation[0][0] - rotation[1][1]) * 2
    quaternion = [
      (rotation[0][2] + rotation[2][0]) / scale,
      (rotation[1][2] + rotation[2][1]) / scale,
      scale / 4,
      (rotation[1][0] - rotation[0][1]) / scale,
    ]
  }
  return normalizeQuaternion(quaternion)
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
  const startQuaternion = rotationToQuaternion(startPose.rotation)
  const targetQuaternion = rotationToQuaternion(targetPose.rotation)
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
