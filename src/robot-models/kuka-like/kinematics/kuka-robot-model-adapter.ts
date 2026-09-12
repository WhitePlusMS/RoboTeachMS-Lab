import { extractPose } from '@/robot-geometry/math/pose-conversion.ts'
import { forwardKinematicsDegrees } from './legacy-forward-kinematics.ts'
import { estimateNumericalJacobian } from '@/robot-geometry/ik/numerical-jacobian.ts'
import type { RobotModel } from '@/robot-geometry/robot-types.ts'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import { KUKA_LIKE } from '../parameters.ts'

/** GLB 尚未完成加载时的同接口 DH 回退模型。 */
export class KukaRobotModelAdapter implements RobotModel {
  isAvailable(): boolean {
    return true
  }

  forwardKinematics(jointsDeg: JointAngles): Pose {
    const matrix = forwardKinematicsDegrees(jointsDeg, KUKA_LIKE)
    const pose = extractPose(matrix)
    return { position: pose.position, euler: pose.eulerZYX, rotation: matrix.getRotation() }
  }

  estimateJacobian(jointsDeg: JointAngles, stepDeg = 0.2): number[][] {
    return estimateNumericalJacobian(this.forwardKinematics.bind(this), jointsDeg, stepDeg) ?? []
  }
}
