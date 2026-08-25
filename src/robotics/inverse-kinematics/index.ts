export { DEFAULT_IK_CONFIG, solveIK } from './numerical-ik.ts'
export { resolveJointSolution } from './joint-solution.ts'
export type {
  IKCandidate,
  IKLockedJointTargets,
  IKSolverConfig,
  RobotConfiguration,
} from './types.ts'
export type {
  JointSolutionResult,
  WaypointFailureDiagnostic,
  WaypointFailureReason,
  WaypointSolveOptions,
  WaypointSolveResult,
} from './waypoint-types.ts'
