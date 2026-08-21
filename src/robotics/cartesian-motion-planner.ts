import type { RobotProfile } from './robot-profile.ts'
import type { JointAngles, Pose } from './types.ts'
import { planCartesianPath, type CartesianPathResult } from './cartesian-path-planner.ts'

/** 手动笛卡尔目标规划 seam；实现可以是同步测试 adapter 或 Worker adapter。 */
export type CartesianTargetPlanner = (
  targetPose: Pose,
  initialJoints: JointAngles,
) => CartesianPathResult

/** 统一手动笛卡尔策略：普通目标严格规划，机械零位腕部失败才局部重试 wrist。 */
export function planCartesianTarget(
  targetPose: Pose,
  initialJoints: JointAngles,
  profile: RobotProfile,
): CartesianPathResult {
  const strict = planCartesianPath(
    targetPose,
    initialJoints,
    profile.model,
    profile.jointRanges,
  )
  // ABB 的 SingArea\Wrist 不是通用的“不可达重试”。只有起始关节已经处于
  // 机械零位腕部邻域时，严格姿态 IK 的任意数值失败才允许进入一次局部
  // wrist 规划。这样可以覆盖奇异点附近数值求解被归类为 ik-not-converged
  // 的情况，同时不会把普通工作区的真实不可达目标放宽成位置-only。
  const mechanicalZeroWristPath =
    profile.model.isMechanicalZeroSingularityNeighborhood?.(initialJoints) ?? false
  if (strict.ok || !mechanicalZeroWristPath) {
    return strict
  }
  return planCartesianPath(
    targetPose,
    initialJoints,
    profile.model,
    profile.jointRanges,
    { orientationMode: 'wrist' },
  )
}
