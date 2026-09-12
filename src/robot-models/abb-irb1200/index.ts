/** ABB IRB 1200 型号模块的公开接缝。 */
export { ABB_IRB1200_PROFILE } from './profile.ts'
export {
  ABB_IRB1200_5_90_STANDARD_DH,
  ABB_JOINT_RANGES,
  ABB_MECHANICAL_ZERO_JOINTS,
  ABB_TEACHING_HOME_JOINTS,
  ABB_WRIST_SINGULARITY_THRESHOLD_DEG,
} from './parameters.ts'
export { AbbRobotModelAdapter } from './abb-robot-model-adapter.ts'
export {
  ABB_FLANGE_CORRECTION,
  forwardAbbKinematics,
  forwardAbbKinematicsDegrees,
  forwardAbbKinematicsFrames,
  forwardAbbKinematicsFramesDegrees,
} from './forward-kinematics.ts'
export { abbConfigurationFromJoints, solveAbbAnalyticIK } from './analytic-inverse-kinematics.ts'
export {
  abbConfigurationForRepresentation,
  abbConfigurationFromBranch,
  abbQuadrant,
} from './configuration.ts'
export type { ABBConfiguration } from './configuration.ts'
