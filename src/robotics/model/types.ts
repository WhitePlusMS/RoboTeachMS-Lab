/** 机器人类型的单一出口；具体定义归属各自 deep module。 */
export type { JointAngles, Pose, PoseDisplay } from './joint-pose.ts'
export type { DHParams, RobotConfig } from '../kinematics/dh-types.ts'
export type {
  ABBConfiguration,
  IKCandidate,
  IKLockedJointTargets,
  IKSolverConfig,
} from '../inverse-kinematics/types.ts'
export type { MotionConfig } from '../motion/types.ts'
