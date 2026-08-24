import type { RobotProfile } from './robot-profile.ts'
import type { JointAngles, Pose } from './types.ts'
import { planCartesianPath, type CartesianPathResult } from './cartesian-path-planner.ts'

/** 手动笛卡尔目标规划 seam；实现可以是同步测试 adapter 或 Worker adapter。 */
export type CartesianTargetPlanner = (
  targetPose: Pose,
  initialJoints: JointAngles,
) => CartesianPathResult

/**
 * 统一手动笛卡尔策略：严格姿态规划是唯一入口。
 * 腕部奇异处理由 `solvePoseWaypoints` 内部的 WristSingularityContext 单一决策，
 * 规划层不再维护第二套局部姿态过渡分支。
 */
export function planCartesianTarget(
  targetPose: Pose,
  initialJoints: JointAngles,
  profile: RobotProfile,
): CartesianPathResult {
  return planCartesianPath(targetPose, initialJoints, profile.model, profile.jointRanges)
}
