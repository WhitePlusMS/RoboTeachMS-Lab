import { extractPose } from '@/robotics/kinematics/pose-conversion.ts'
import { forwardKinematicsDegrees } from './legacy-forward-kinematics.ts'
import { estimateNumericalJacobian } from '@/robotics/kinematics/numerical-jacobian.ts'
import type { RobotModel } from '@/robotics/model/robot-model.ts'
import type { JointAngles, Pose } from '@/robotics/model/joint-pose.ts'
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
