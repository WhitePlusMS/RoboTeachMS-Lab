import type { RobotProfile } from '@/robot-geometry/robot-types.ts'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import { DEFAULT_ROBOT } from '@/robot-models/registry.ts'
import { buildIKCandidateCatalog } from '@/robot-geometry/ik/candidate-catalog.ts'

/** 独立正解；输出机器人基座下的法兰位姿。 */
export function forwardKinematics(
  joints: JointAngles,
  profile: RobotProfile = DEFAULT_ROBOT,
): Pose | null {
  return profile.model.forwardKinematics(joints)
}
/** 返回候选事实与残差，调用方不能把存在候选等同于可执行路径。 */
export function inverseKinematics(
  target: Pose,
  reference: JointAngles,
  profile: RobotProfile = DEFAULT_ROBOT,
) {
  return buildIKCandidateCatalog(target, reference, profile.model, profile.jointRanges)
}
