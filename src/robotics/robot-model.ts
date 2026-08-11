import type { JointAngles, Pose } from './types.ts'

/** FK/Jacobian 来源抽象；逆解器不直接依赖 Vue 或 Three.js。 */
export interface RobotModel {
  forwardKinematics(jointsDeg: JointAngles): Pose | null
  estimateJacobian(jointsDeg: JointAngles, stepDeg?: number): number[][] | null
  isAvailable(): boolean
}
