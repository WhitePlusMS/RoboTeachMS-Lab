import type { JointAngles, Pose } from './joint-pose.ts'
import type { IKCandidate, RobotConfiguration } from '../numerical-ik/types.ts'

/** FK/Jacobian 来源抽象；逆解器不直接依赖 Vue 或 Three.js。 */
export interface RobotModel {
  forwardKinematics(jointsDeg: JointAngles): Pose | null
  estimateJacobian(jointsDeg: JointAngles, stepDeg?: number): number[][] | null
  isAvailable(): boolean
  /** 可选的解析/几何逆解；返回全部分支，不在模型层选择 J4/J6 构型。 */
  solveAllIK?(targetPose: Pose, referenceJoints?: JointAngles): readonly IKCandidate[]
  /** 可选的型号特定构型反推（如 ABB cf1/cf4/cf6/cfx）；供多解选择保持当前构型。 */
  deriveConfiguration?(jointsDeg: JointAngles): RobotConfiguration | null
  /** 将解析分支的构型标签映射到某个多圈关节表示。 */
  configurationForRepresentation?(
    source: RobotConfiguration,
    jointsDeg: JointAngles,
  ): RobotConfiguration
  /** 可选的型号特定腕部奇异判定；未提供时不把通用步长失败误报为腕部重构。 */
  isWristSingularity?(jointsDeg: JointAngles): boolean
  /**
   * 可选的型号特定机械零位奇异邻域判定；只有返回 true 的路径才允许自动 wrist 回退。
   * 与广义 J5 腕部奇异分开，避免普通工作区仅因 J5≈0 就放宽姿态约束。
   */
  isMechanicalZeroSingularityNeighborhood?(jointsDeg: JointAngles): boolean
}
