import { planStrictCandidateGraph } from './candidate-path-planner.ts'
import type { RobotModel } from '../model/robot-model.ts'
import type { JointAngles, Pose } from '../model/joint-pose.ts'
import type { IKSolverConfig } from '../inverse-kinematics/types.ts'
export function solveGizmoTarget(
  targetPose: Pose,
  referenceJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  solverConfig: Partial<IKSolverConfig> = {},
): JointAngles | null {
  const graph = planStrictCandidateGraph(
    [targetPose],
    referenceJoints,
    model,
    jointRanges,
    (pose) => pose,
    // 单帧拖拽不使用 MoveL 的 5°硬拒绝；候选连续性代价和软限位仍保持统一。
    {
      solverConfig,
      maxJointStepDeg: null,
      preserveConfiguration: solverConfig.preserveConfiguration,
    },
  )
  if (!graph.ok || graph.waypoints.length === 0) return null
  return graph.waypoints[0]
}
