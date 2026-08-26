import type { RobotProfile } from '../model/robot-profile.ts'
import type { JointAngles, Pose } from '../model/joint-pose.ts'
import { planCartesianPath, type CartesianPathResult } from './path-planner.ts'

export { planCartesianPath } from './path-planner.ts'
export type { CartesianPathFailure, CartesianPathResult } from './path-planner.ts'
export { solveGizmoTarget } from './gizmo-target-solver.ts'
export { resolveJointSolution } from './solution/joint-solution.ts'
export { solvePoseWaypoints } from './solution/waypoint-solver.ts'
export type { WaypointFailureDiagnostic } from './solution/waypoint-types.ts'

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
  options?: { preserveConfiguration?: boolean },
): CartesianPathResult {
  return planCartesianPath(targetPose, initialJoints, profile.model, profile.jointRanges, options)
}
