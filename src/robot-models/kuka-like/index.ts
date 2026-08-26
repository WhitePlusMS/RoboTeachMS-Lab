/** KUKA-like 型号模块的公开接缝；保留为后续多厂商扩展位置。 */
export { KUKA_LIKE, KUKA_JOINT_RANGES, DEFAULT_JOINTS } from './parameters.ts'
export { KukaRobotModelAdapter } from './kinematics/kuka-robot-model-adapter.ts'
export {
  forwardKinematics,
  forwardKinematicsDegrees,
  poseFromJoints,
} from './kinematics/legacy-forward-kinematics.ts'
