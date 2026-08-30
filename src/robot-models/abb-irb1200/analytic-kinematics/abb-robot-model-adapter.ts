import { estimateNumericalJacobian } from '@/robot-geometry/transform/numerical-jacobian.ts'
import { extractPose } from '@/robot-geometry/transform/pose-conversion.ts'
import type { RobotModel } from '@/robot-geometry/model/robot-model.ts'
import type { JointAngles, Pose } from '@/robot-geometry/model/joint-pose.ts'
import { forwardAbbKinematicsDegrees } from './forward-kinematics.ts'
import { abbConfigurationFromJoints, solveAbbAnalyticIK } from './analytic-inverse-kinematics.ts'
import { abbConfigurationForRepresentation, type ABBConfiguration } from './configuration.ts'
import {
  ABB_MECHANICAL_ZERO_JOINTS,
  ABB_MECHANICAL_ZERO_NEIGHBORHOOD_DEG,
  ABB_WRIST_SINGULARITY_THRESHOLD_DEG,
} from '../parameters.ts'

/**
 * ABB 候选等价 DH 链模型；当前用于FK/IK验证，不代表ABB官方标定机制。
 * FBX 只负责视觉呈现，不参与这条候选DH计算链。
 */
export class AbbRobotModelAdapter implements RobotModel {
  isAvailable(): boolean {
    return true
  }

  isWristSingularity(jointsDeg: JointAngles): boolean {
    return Math.abs(jointsDeg[4]) <= ABB_WRIST_SINGULARITY_THRESHOLD_DEG
  }

  isMechanicalZeroSingularityNeighborhood(jointsDeg: JointAngles): boolean {
    if (!this.isWristSingularity(jointsDeg)) return false
    return jointsDeg.every((value, index) => {
      const threshold =
        index === 4 ? ABB_WRIST_SINGULARITY_THRESHOLD_DEG : ABB_MECHANICAL_ZERO_NEIGHBORHOOD_DEG
      return Math.abs(value - ABB_MECHANICAL_ZERO_JOINTS[index]) <= threshold
    })
  }

  forwardKinematics(jointsDeg: JointAngles): Pose {
    const matrix = forwardAbbKinematicsDegrees(jointsDeg)
    const pose = extractPose(matrix)
    return { position: pose.position, euler: pose.eulerZYX, rotation: matrix.getRotation() }
  }

  solveAllIK(targetPose: Pose, referenceJoints?: JointAngles) {
    return solveAbbAnalyticIK(targetPose, referenceJoints)
  }

  deriveConfiguration(jointsDeg: JointAngles): ABBConfiguration | null {
    return abbConfigurationFromJoints(jointsDeg)
  }

  configurationForRepresentation(
    source: readonly number[],
    jointsDeg: JointAngles,
  ): ABBConfiguration {
    return abbConfigurationForRepresentation(source, jointsDeg)
  }

  estimateJacobian(jointsDeg: JointAngles, stepDeg = 0.2): number[][] {
    return estimateNumericalJacobian(this.forwardKinematics.bind(this), jointsDeg, stepDeg) ?? []
  }
}
