/** ABB IRB 1200 型号模块的公开接缝。 */
export { ABB_IRB1200_PROFILE } from './profile.ts'
export {
  ABB_IRB1200_5_90_STANDARD_DH,
  ABB_JOINT_RANGES,
  ABB_MECHANICAL_ZERO_JOINTS,
  ABB_TEACHING_HOME_JOINTS,
  ABB_WRIST_SINGULARITY_THRESHOLD_DEG,
  ABB_MECHANICAL_ZERO_NEIGHBORHOOD_DEG,
} from './parameters.ts'
export { AbbRobotModelAdapter } from './kinematics/abb-robot-model-adapter.ts'
export {
  ABB_FLANGE_CORRECTION,
  forwardAbbKinematics,
  forwardAbbKinematicsDegrees,
  forwardAbbKinematicsFrames,
  forwardAbbKinematicsFramesDegrees,
} from './kinematics/forward-kinematics.ts'
export { abbConfigurationFromJoints, solveAbbAnalyticIK } from './kinematics/analytic-inverse-kinematics.ts'
export {
  abbConfigurationForRepresentation,
  abbConfigurationFromBranch,
  abbQuadrant,
} from './kinematics/configuration.ts'
export type { ABBConfiguration } from './kinematics/configuration.ts'
