import { extractPose, forwardKinematicsDegrees } from '../../core/robot/kinematics'
import { orientationError } from '../../core/robot/math/rotation3d'
import type { RobotModel } from '../../core/robot/robot-model'
import type { JointAngles, Pose } from '../../core/robot/types'
import { KUKA_LIKE } from './robot-config'

/** GLB 尚未完成加载时的同接口 DH 回退模型。 */
export class DhRobotModel implements RobotModel {
  isAvailable(): boolean {
    return true
  }

  forwardKinematics(jointsDeg: JointAngles): Pose {
    const matrix = forwardKinematicsDegrees(jointsDeg, KUKA_LIKE)
    const pose = extractPose(matrix)
    return { position: pose.position, euler: pose.eulerZYX, rotation: matrix.getRotation() }
  }

  estimateJacobian(jointsDeg: JointAngles, stepDeg = 0.2): number[][] {
    const basePose = this.forwardKinematics(jointsDeg)
    const jacobian = Array.from({ length: 6 }, () => Array(6).fill(0))
    for (let jointIndex = 0; jointIndex < 6; jointIndex += 1) {
      const offset = [...jointsDeg] as JointAngles
      offset[jointIndex] += stepDeg
      const offsetPose = this.forwardKinematics(offset)
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
}
