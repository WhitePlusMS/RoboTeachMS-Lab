import { extractPose, forwardKinematicsDegrees } from '../../robotics/kinematics.ts'
import { orientationError } from '../../robotics/math/rotation3d.ts'
import type { RobotModel } from '../../robotics/robot-model.ts'
import type { JointAngles, Pose } from '../../robotics/types.ts'
import { KUKA_LIKE } from './robot-config.ts'

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
