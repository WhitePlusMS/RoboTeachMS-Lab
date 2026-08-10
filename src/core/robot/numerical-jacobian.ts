import { orientationError } from './math/rotation3d'
import type { JointAngles, Pose } from './types'

export type ForwardKinematics = (jointsDeg: JointAngles) => Pose | null

/**
 * 共享的数值 Jacobian 计算器。
 * 机器人适配器只负责 FK；IK 和不同机器人模型都复用这一套差分语义。
 */
export function estimateNumericalJacobian(
  forwardKinematics: ForwardKinematics,
  jointsDeg: JointAngles,
  stepDeg = 0.2,
): number[][] | null {
  const basePose = forwardKinematics(jointsDeg)
  if (!basePose) return null

  const jacobian = Array.from({ length: 6 }, () => Array<number>(6).fill(0))
  for (let jointIndex = 0; jointIndex < 6; jointIndex += 1) {
    const offsetJoints = [...jointsDeg] as JointAngles
    offsetJoints[jointIndex] += stepDeg
    const offsetPose = forwardKinematics(offsetJoints)
    if (!offsetPose) return null

    for (let axis = 0; axis < 3; axis += 1) {
      jacobian[axis][jointIndex] =
        (offsetPose.position[axis] - basePose.position[axis]) / stepDeg
    }

    const orientationDelta = orientationError(offsetPose.rotation, basePose.rotation)
    for (let axis = 0; axis < 3; axis += 1) {
      jacobian[axis + 3][jointIndex] = orientationDelta[axis] / stepDeg
    }
  }

  return jacobian
}
