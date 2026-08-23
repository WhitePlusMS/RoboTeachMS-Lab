import type { RobotProfile } from './robot-profile.ts'
import type { JointAngles, Pose } from './types.ts'
import { planCartesianPath, type CartesianPathResult } from './cartesian-path-planner.ts'

/** 手动笛卡尔目标规划 seam；实现可以是同步测试 adapter 或 Worker adapter。 */
export type CartesianTargetPlanner = (
  targetPose: Pose,
  initialJoints: JointAngles,
  options?: CartesianTargetPlanningOptions,
) => CartesianPathResult

/** 手动笛卡尔规划策略；腕部姿态放宽只允许由机械零位邻域自动触发。 */
export interface CartesianTargetPlanningOptions {
  /** 允许平移按钮自动进入机械零位 SingArea\\Wrist。 */
  allowWristEntry?: boolean
}
/** 统一手动笛卡尔策略：严格姿态优先，机械零位失败才局部重试 SingArea\\Wrist。 */
export function planCartesianTarget(
  targetPose: Pose,
  initialJoints: JointAngles,
  profile: RobotProfile,
  options: CartesianTargetPlanningOptions = {},
): CartesianPathResult {
  const strict = planCartesianPath(
    targetPose,
    initialJoints,
    profile.model,
    profile.jointRanges,
  )
  // ABB 的 SingArea\Wrist 不是通用的“不可达重试”。只有起始关节已经处于
  // 机械零位腕部邻域时，严格姿态 IK 失败才允许局部放宽姿态；普通工作区
  // 仍保持严格 6D 位姿约束。
  const mechanicalZeroWristPath =
    profile.model.isMechanicalZeroSingularityNeighborhood?.(initialJoints) ?? false
  const startPose = profile.model.forwardKinematics(initialJoints)
  const hasTranslationDelta =
    startPose !== null &&
    Math.hypot(
      targetPose.position[0] - startPose.position[0],
      targetPose.position[1] - startPose.position[1],
      targetPose.position[2] - startPose.position[2],
    ) > 1e-6
  if (
    strict.ok ||
    !mechanicalZeroWristPath ||
    options.allowWristEntry === false ||
    !hasTranslationDelta
  ) {
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
