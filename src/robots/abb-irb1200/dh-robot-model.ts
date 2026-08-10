import { estimateNumericalJacobian } from '../../core/robot/numerical-jacobian'
import { extractPose } from '../../core/robot/kinematics'
import type { RobotModel } from '../../core/robot/robot-model'
import type { JointAngles, Pose } from '../../core/robot/types'
import { forwardAbbKinematicsDegrees } from './abb-kinematics'

/**
 * ABB 候选等价 DH 链模型；当前用于FK/IK验证，不代表ABB官方标定机制。
 * FBX 只负责视觉呈现，不参与这条候选DH计算链。
 */
export class AbbDhRobotModel implements RobotModel {
  isAvailable(): boolean {
    return true
  }

  forwardKinematics(jointsDeg: JointAngles): Pose {
    const matrix = forwardAbbKinematicsDegrees(jointsDeg)
    const pose = extractPose(matrix)
    return { position: pose.position, euler: pose.eulerZYX, rotation: matrix.getRotation() }
  }

  estimateJacobian(jointsDeg: JointAngles, stepDeg = 0.2): number[][] {
    return estimateNumericalJacobian(this.forwardKinematics.bind(this), jointsDeg, stepDeg) ?? []
  }
}
