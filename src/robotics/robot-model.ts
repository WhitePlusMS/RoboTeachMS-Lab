import type { JointAngles, Pose } from './types.ts'

/** FK/Jacobian 来源抽象；逆解器不直接依赖 Vue 或 Three.js。 */
export interface RobotModel {
  forwardKinematics(jointsDeg: JointAngles): Pose | null
  estimateJacobian(jointsDeg: JointAngles, stepDeg?: number): number[][] | null
  isAvailable(): boolean
  /** 可选的型号特定腕部奇异判定；未提供时不把通用步长失败误报为腕部重构。 */
  isWristSingularity?(jointsDeg: JointAngles): boolean
  /**
   * 可选的型号特定机械零位奇异邻域判定；只有返回 true 的路径才允许自动 wrist 回退。
   * 与广义 J5 腕部奇异分开，避免普通工作区仅因 J5≈0 就放宽姿态约束。
   */
  isMechanicalZeroSingularityNeighborhood?(jointsDeg: JointAngles): boolean
}
