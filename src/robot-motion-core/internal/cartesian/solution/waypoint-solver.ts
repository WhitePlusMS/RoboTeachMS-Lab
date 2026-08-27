import { planStrictCandidateGraph } from '../candidate-path-planner.ts'
import { MAX_CARTESIAN_JOINT_STEP_DEG } from '../step-policy.ts'
import type { RobotModel } from '@/robotics/model/robot-model.ts'
import type { JointAngles, Pose } from '@/robotics/model/joint-pose.ts'
import type { IKSolverConfig } from '@/robotics/inverse-kinematics/types.ts'
import {
  buildJointStepDetail,
  getSinglePointWristEscapeDirection,
  isNearWristSingularity,
  isWristReconfiguration,
  mapJointSolutionFailure,
  resolveJointSolution,
  withWaypointDiagnostic,
} from './joint-solution.ts'
import type {
  AppliedSingularityMode,
  WaypointSolveOptions,
  WaypointSolveResult,
  WristSingularityContext,
} from './waypoint-types.ts'

/** 逐点把一串 TCP 位姿求解为关节 waypoint（MoveL 与 MoveC 共用）。 */
export function solvePoseWaypoints(
  poses: readonly Pose[],
  initialJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  toFlange: (pose: Pose) => Pose,
  solverConfig: Partial<IKSolverConfig> = {},
  options: WaypointSolveOptions = {},
): WaypointSolveResult {
  const waypoints: JointAngles[] = []
  let previousJoints = [...initialJoints] as JointAngles
  let appliedSingularityMode: AppliedSingularityMode | null = null
  // 腕部回退必须由调用方显式声明（例如 RAPID SingArea\\Wrist）；
  // 型号位置不能隐式改变完整位姿约束。
  const wristFallbackPath = options.allowWristFallback === true
  // 只有明确授权或机械零位腕部特例需要相邻步长护栏；普通严格路径保持全局候选图。
  const continuityLimitDeg = wristFallbackPath ? MAX_CARTESIAN_JOINT_STEP_DEG : undefined

  // 非机械零位的严格解析路径先使用全局候选图，避免逐 waypoint 最近分支把任一腕部推向
  // 等价构型；机械零位腕部路径直接走局部求解，并预创建 wristContext 供单点 IK 使用。
  if (!wristFallbackPath && model.solveAllIK) {
    const graph = planStrictCandidateGraph(poses, initialJoints, model, jointRanges, toFlange, {
      solverConfig,
      preserveConfiguration: solverConfig.preserveConfiguration,
      requiredConfiguration: options.requiredConfiguration,
      maxJointStepDeg: options.maxJointStepDeg,
    })
    if (graph.ok) {
      return {
        ok: true,
        waypoints: graph.waypoints,
        appliedSingularityMode: null,
      }
    }
    return {
      ok: false,
      failure: graph.failure === 'unreachable' ? 'ik-not-converged' : graph.failure,
      diagnostic: graph.diagnostic,
    }
  }

  let wristContext: WristSingularityContext | undefined
  if (wristFallbackPath && poses.length > 0) {
    wristContext = {
      escapeDirection: getSinglePointWristEscapeDirection(toFlange(poses[0]), initialJoints, model),
      escapeDone: false,
      escapePose: null,
    }
  }
  for (let waypointIndex = 0; waypointIndex < poses.length; waypointIndex += 1) {
    const wasWristEscaped = wristContext?.escapeDone ?? false
    const pose = poses[waypointIndex]
    const solved = resolveJointSolution(
      toFlange(pose),
      previousJoints,
      model,
      jointRanges,
      solverConfig,
      continuityLimitDeg,
      wristContext,
    )
    if ('joints' in solved && solved.wristContext) {
      wristContext = solved.wristContext
      if (!appliedSingularityMode) appliedSingularityMode = 'wrist'
    }
    if ('failure' in solved) {
      const nearWristSingularity = isNearWristSingularity(model, previousJoints)
      const mappedFailure = mapJointSolutionFailure(
        solved.failure,
        wristFallbackPath,
        nearWristSingularity,
      )
      const detail = solved.detail
      if (solved.failure === 'joint-limit') {
        return withWaypointDiagnostic('joint-limit', detail, waypointIndex)
      }
      return withWaypointDiagnostic(mappedFailure, detail, waypointIndex)
    }
    const maxJointStep = Math.max(
      ...solved.joints.map((value, index) => Math.abs(value - previousJoints[index])),
    )
    const escapedOnThisWaypoint = !wasWristEscaped && solved.wristContext?.escapeDone === true
    if (maxJointStep > MAX_CARTESIAN_JOINT_STEP_DEG && !escapedOnThisWaypoint) {
      const wristReconfiguration =
        wristFallbackPath && isWristReconfiguration(model, previousJoints, solved.joints)
      return withWaypointDiagnostic(
        wristReconfiguration ? 'wrist-reconfiguration' : 'joint-step',
        buildJointStepDetail(
          previousJoints,
          solved.joints,
          jointRanges,
          wristReconfiguration ? [3, 5] : undefined,
        ),
        waypointIndex,
      )
    }
    waypoints.push(solved.joints)
    previousJoints = solved.joints
  }
  return { ok: true, waypoints, appliedSingularityMode }
}
