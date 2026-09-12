import { planStrictCandidateGraph } from './ik-path-search.ts'
import { MAX_CARTESIAN_JOINT_STEP_DEG } from './path-limits.ts'
import type { RobotModel } from '@/robot-geometry/robot-types.ts'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import type { IKSolverConfig } from '@/robot-geometry/ik/ik-types.ts'
import {
  getSinglePointWristEscapeDirection,
  isNearWristSingularity,
  isWristReconfiguration,
  mapJointSolutionFailure,
  resolveJointSolution,
  withWaypointDiagnostic,
} from './waypoint-ik.ts'
import { buildStepFailureDetail } from './waypoint-diagnostics.ts'
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
  // 局部回退路径使用相邻步长护栏；严格路径在全局候选图中应用相同步长约束。
  const continuityLimitDeg = wristFallbackPath ? MAX_CARTESIAN_JOINT_STEP_DEG : undefined

  // 严格解析路径使用全局候选图；显式授权的腕部路径使用带上下文的局部求解。
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
        buildStepFailureDetail(
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
