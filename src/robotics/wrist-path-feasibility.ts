import { DEFAULT_IK_CONFIG } from './ik-solver.ts'
import { buildIKCandidateCatalog, type IKCandidateRecord } from './ik-candidate-catalog.ts'
import type { RobotModel } from './robot-model.ts'
import type { IKSolverConfig, JointAngles, Pose } from './types.ts'

/**
 * 整条笛卡尔路径的腕部支路约束。该模块只做离线/测试诊断，不改变实际规划器的选支路策略。
 */
export interface WristPathFeasibilityOptions {
  solverConfig?: Partial<IKSolverConfig>
  /** 相邻 waypoint 的六轴最大允许步长（度）。 */
  maxJointStepDeg?: number
  /** J5 进入该窗口即视为腕部奇异，单位为度。 */
  wristSingularityThresholdDeg?: number
  /** 是否排除贴近关节软限位的候选。与严格候选图默认行为一致。 */
  rejectAtJointLimit?: boolean
}

export type WristPathSide = 'all' | 'initial-side'

export interface WristPathMetrics {
  waypointCount: number
  maxWristAbsoluteDeg: number
  maxWristDeltaFromInitialDeg: number
  maxJ4AbsoluteDeg: number
  maxJ6AbsoluteDeg: number
  maxJ4DeltaFromInitialDeg: number
  maxJ6DeltaFromInitialDeg: number
  totalWristTravelDeg: number
  minAbsJ5Deg: number
  maxJointStepDeg: number
  maxJointStepWaypointIndex: number | null
  finalJoints: JointAngles
}

export interface WristPathEvaluation {
  pathFound: boolean
  failure: 'no-candidates' | 'joint-step' | null
  firstFailureWaypointIndex: number | null
  candidateCountPerWaypoint: number[]
  metrics: WristPathMetrics | null
  /** 供诊断测试进一步检查；不用于 UI 或运动执行。 */
  waypoints: JointAngles[] | null
}

export interface WristPathFeasibilityReport {
  waypointCount: number
  strictCandidateCountPerWaypoint: number[]
  /** 所有严格姿态候选，不限制 J5 侧。 */
  strictAll: WristPathEvaluation
  /** 严格姿态，且 J5 始终留在初始侧并远离奇异窗口。 */
  strictInitialJ5Side: WristPathEvaluation
  /** 在同一约束下分别最小化三种腕部指标。 */
  optimized: {
    minMaxAbsolute: WristPathEvaluation
    minMaxDeltaFromInitial: WristPathEvaluation
    minTotalTravel: WristPathEvaluation
  }
  initialJoints: JointAngles
  thresholds: {
    positionToleranceMm: number
    orientationToleranceRad: number
    maxJointStepDeg: number
    wristSingularityThresholdDeg: number
  }
}

type Objective = 'max-absolute' | 'max-delta' | 'total-travel'

interface PathState {
  joints: JointAngles
  maxWristAbsoluteDeg: number
  maxWristDeltaFromInitialDeg: number
  totalWristTravelDeg: number
  previousIndex: number
}

const DEFAULT_MAX_JOINT_STEP_DEG = 5
const DEFAULT_WRIST_SINGULARITY_THRESHOLD_DEG = 1

function cloneJoints(joints: JointAngles): JointAngles {
  return [...joints] as JointAngles
}

function maxWristAbsolute(joints: JointAngles): number {
  return Math.max(Math.abs(joints[3]), Math.abs(joints[5]))
}

function wristDeltaFromInitial(joints: JointAngles, initial: JointAngles): number {
  return Math.max(Math.abs(joints[3] - initial[3]), Math.abs(joints[5] - initial[5]))
}

function wristTravel(previous: JointAngles, next: JointAngles): number {
  return Math.abs(next[3] - previous[3]) + Math.abs(next[5] - previous[5])
}

function exceedsJointStep(
  previous: JointAngles,
  next: JointAngles,
  maxJointStepDeg: number,
): boolean {
  return next.some((value, index) => Math.abs(value - previous[index]) > maxJointStepDeg)
}

function buildMetrics(initialJoints: JointAngles, waypoints: readonly JointAngles[]): WristPathMetrics {
  let previous = initialJoints
  let maxWristAbsoluteDeg = maxWristAbsolute(initialJoints)
  let maxWristDeltaFromInitialDeg = 0
  let maxJ4AbsoluteDeg = Math.abs(initialJoints[3])
  let maxJ6AbsoluteDeg = Math.abs(initialJoints[5])
  let maxJ4DeltaFromInitialDeg = 0
  let maxJ6DeltaFromInitialDeg = 0
  let totalWristTravelDeg = 0
  let minAbsJ5Deg = Math.abs(initialJoints[4])
  let maxJointStepDeg = 0
  let maxJointStepWaypointIndex: number | null = null

  waypoints.forEach((joints, index) => {
    const step = Math.max(...joints.map((value, axis) => Math.abs(value - previous[axis])))
    if (step > maxJointStepDeg) {
      maxJointStepDeg = step
      maxJointStepWaypointIndex = index + 1
    }
    const absJ4 = Math.abs(joints[3])
    const absJ6 = Math.abs(joints[5])
    const deltaJ4 = Math.abs(joints[3] - initialJoints[3])
    const deltaJ6 = Math.abs(joints[5] - initialJoints[5])
    maxJ4AbsoluteDeg = Math.max(maxJ4AbsoluteDeg, absJ4)
    maxJ6AbsoluteDeg = Math.max(maxJ6AbsoluteDeg, absJ6)
    maxJ4DeltaFromInitialDeg = Math.max(maxJ4DeltaFromInitialDeg, deltaJ4)
    maxJ6DeltaFromInitialDeg = Math.max(maxJ6DeltaFromInitialDeg, deltaJ6)
    maxWristAbsoluteDeg = Math.max(maxWristAbsoluteDeg, absJ4, absJ6)
    maxWristDeltaFromInitialDeg = Math.max(maxWristDeltaFromInitialDeg, deltaJ4, deltaJ6)
    totalWristTravelDeg += wristTravel(previous, joints)
    minAbsJ5Deg = Math.min(minAbsJ5Deg, Math.abs(joints[4]))
    previous = joints
  })

  return {
    waypointCount: waypoints.length,
    maxWristAbsoluteDeg,
    maxWristDeltaFromInitialDeg,
    maxJ4AbsoluteDeg,
    maxJ6AbsoluteDeg,
    maxJ4DeltaFromInitialDeg,
    maxJ6DeltaFromInitialDeg,
    totalWristTravelDeg,
    minAbsJ5Deg,
    maxJointStepDeg,
    maxJointStepWaypointIndex,
    finalJoints: cloneJoints(waypoints[waypoints.length - 1] ?? initialJoints),
  }
}

function objectiveValue(state: PathState, objective: Objective): number {
  if (objective === 'max-absolute') return state.maxWristAbsoluteDeg
  if (objective === 'max-delta') return state.maxWristDeltaFromInitialDeg
  return state.totalWristTravelDeg
}

function isBetterState(candidate: PathState, current: PathState, objective: Objective): boolean {
  const candidateValue = objectiveValue(candidate, objective)
  const currentValue = objectiveValue(current, objective)
  if (candidateValue < currentValue - 1e-9) return true
  if (candidateValue > currentValue + 1e-9) return false
  if (candidate.maxWristDeltaFromInitialDeg < current.maxWristDeltaFromInitialDeg - 1e-9) return true
  if (candidate.maxWristDeltaFromInitialDeg > current.maxWristDeltaFromInitialDeg + 1e-9) return false
  if (candidate.totalWristTravelDeg < current.totalWristTravelDeg - 1e-9) return true
  return false
}

function buildState(
  previous: PathState | null,
  initialJoints: JointAngles,
  joints: JointAngles,
  previousIndex: number,
): PathState {
  const previousJoints = previous?.joints ?? initialJoints
  return {
    joints: cloneJoints(joints),
    maxWristAbsoluteDeg: Math.max(
      previous?.maxWristAbsoluteDeg ?? maxWristAbsolute(initialJoints),
      maxWristAbsolute(joints),
    ),
    maxWristDeltaFromInitialDeg: Math.max(
      previous?.maxWristDeltaFromInitialDeg ?? 0,
      wristDeltaFromInitial(joints, initialJoints),
    ),
    totalWristTravelDeg: (previous?.totalWristTravelDeg ?? 0) + wristTravel(previousJoints, joints),
    previousIndex,
  }
}

function filterCandidates(
  catalog: readonly IKCandidateRecord[],
  config: IKSolverConfig,
  side: WristPathSide,
  initialJ5Deg: number,
  singularityThresholdDeg: number,
  rejectAtJointLimit: boolean,
): JointAngles[] {
  const initialSign = Math.sign(initialJ5Deg) || 1
  return catalog
    .filter((candidate) => {
      if (!candidate.normalizedJoints || !candidate.withinJointRanges) return false
      if (rejectAtJointLimit && candidate.atJointLimit) return false
      if (candidate.positionErrorMm > config.posTolerance || candidate.orientationErrorRad > config.oriTolerance) {
        return false
      }
      if (side === 'all') return true
      const j5 = candidate.normalizedJoints[4]
      return Math.abs(j5) > singularityThresholdDeg && Math.sign(j5) === initialSign
    })
    .map((candidate) => cloneJoints(candidate.normalizedJoints as JointAngles))
}

function emptyEvaluation(
  candidateCountPerWaypoint: number[],
  failure: 'no-candidates' | 'joint-step',
  firstFailureWaypointIndex: number,
): WristPathEvaluation {
  return {
    pathFound: false,
    failure,
    firstFailureWaypointIndex,
    candidateCountPerWaypoint,
    metrics: null,
    waypoints: null,
  }
}

function optimizePath(
  layers: readonly (readonly JointAngles[])[],
  initialJoints: JointAngles,
  maxJointStepDeg: number,
  objective: Objective,
): WristPathEvaluation {
  if (layers.length === 0) {
    return {
      pathFound: true,
      failure: null,
      firstFailureWaypointIndex: null,
      candidateCountPerWaypoint: [],
      metrics: buildMetrics(initialJoints, []),
      waypoints: [],
    }
  }

  const candidateCountPerWaypoint = layers.map((layer) => layer.length)
  if (layers.some((layer) => layer.length === 0)) {
    const index = layers.findIndex((layer) => layer.length === 0)
    return emptyEvaluation(candidateCountPerWaypoint, 'no-candidates', index + 1)
  }

  const stateLayers: PathState[][] = []
  const firstStates: PathState[] = []
  for (const candidate of layers[0]) {
    if (!exceedsJointStep(initialJoints, candidate, maxJointStepDeg)) {
      firstStates.push(buildState(null, initialJoints, candidate, -1))
    }
  }
  stateLayers.push(firstStates)
  if (firstStates.length === 0) {
    return emptyEvaluation(candidateCountPerWaypoint, 'joint-step', 1)
  }

  for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) {
    const previousStates = stateLayers[layerIndex - 1]
    const currentStates: PathState[] = []
    for (const candidate of layers[layerIndex]) {
      let best: PathState | null = null
      for (let previousIndex = 0; previousIndex < previousStates.length; previousIndex += 1) {
        const previous = previousStates[previousIndex]
        if (exceedsJointStep(previous.joints, candidate, maxJointStepDeg)) continue
        const next = buildState(previous, initialJoints, candidate, previousIndex)
        if (best === null || isBetterState(next, best, objective)) best = next
      }
      if (best !== null) currentStates.push(best)
    }
    stateLayers.push(currentStates)
    if (currentStates.length === 0) {
      return emptyEvaluation(candidateCountPerWaypoint, 'joint-step', layerIndex + 1)
    }
  }

  const lastStates = stateLayers[stateLayers.length - 1]
  let bestIndex = 0
  for (let index = 1; index < lastStates.length; index += 1) {
    if (isBetterState(lastStates[index], lastStates[bestIndex], objective)) bestIndex = index
  }

  const waypoints = new Array<JointAngles>(layers.length)
  for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    const state = stateLayers[layerIndex][bestIndex]
    waypoints[layerIndex] = cloneJoints(state.joints)
    bestIndex = state.previousIndex
  }
  return {
    pathFound: true,
    failure: null,
    firstFailureWaypointIndex: null,
    candidateCountPerWaypoint,
    metrics: buildMetrics(initialJoints, waypoints),
    waypoints,
  }
}

/**
 * 枚举整条路径的严格 IK 候选，并在指定 J5 侧和相邻步长约束下分别优化腕部指标。
 *
 * 这不是新的运动模式：它只回答“是否存在一条满足约束的连续支路”。
 * `strictInitialJ5Side` 的结论最接近 ABB 线性 Jog 的保守语义：从当前 J5 侧出发，
 * 不主动穿过 J5=0 奇异窗口，也不允许离散构型跳变。
 */
export function analyzeWristPathFeasibility(
  poses: readonly Pose[],
  initialJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  toFlange: (pose: Pose) => Pose = (pose) => pose,
  options: WristPathFeasibilityOptions = {},
): WristPathFeasibilityReport {
  const solverConfig = { ...DEFAULT_IK_CONFIG, ...options.solverConfig }
  const maxJointStepDeg = options.maxJointStepDeg ?? DEFAULT_MAX_JOINT_STEP_DEG
  const wristSingularityThresholdDeg =
    options.wristSingularityThresholdDeg ?? DEFAULT_WRIST_SINGULARITY_THRESHOLD_DEG
  const rejectAtJointLimit = options.rejectAtJointLimit ?? true
  const catalogs = poses.map((pose) =>
    buildIKCandidateCatalog(toFlange(pose), initialJoints, model, jointRanges),
  )
  const strictCandidateCountPerWaypoint = catalogs.map((catalog) =>
    filterCandidates(
      catalog,
      solverConfig,
      'all',
      initialJoints[4],
      wristSingularityThresholdDeg,
      rejectAtJointLimit,
    ).length,
  )
  const strictAllLayers = catalogs.map((catalog) =>
    filterCandidates(
      catalog,
      solverConfig,
      'all',
      initialJoints[4],
      wristSingularityThresholdDeg,
      rejectAtJointLimit,
    ),
  )
  const strictInitialJ5Layers = catalogs.map((catalog) =>
    filterCandidates(
      catalog,
      solverConfig,
      'initial-side',
      initialJoints[4],
      wristSingularityThresholdDeg,
      rejectAtJointLimit,
    ),
  )
  const strictAll = optimizePath(strictAllLayers, initialJoints, maxJointStepDeg, 'max-delta')
  const strictInitialJ5Side = optimizePath(
    strictInitialJ5Layers,
    initialJoints,
    maxJointStepDeg,
    'max-delta',
  )

  const optimized = {
    minMaxAbsolute: optimizePath(
      strictInitialJ5Layers,
      initialJoints,
      maxJointStepDeg,
      'max-absolute',
    ),
    minMaxDeltaFromInitial: optimizePath(
      strictInitialJ5Layers,
      initialJoints,
      maxJointStepDeg,
      'max-delta',
    ),
    minTotalTravel: optimizePath(
      strictInitialJ5Layers,
      initialJoints,
      maxJointStepDeg,
      'total-travel',
    ),
  }

  return {
    waypointCount: poses.length,
    strictCandidateCountPerWaypoint,
    strictAll,
    strictInitialJ5Side,
    optimized,
    initialJoints: cloneJoints(initialJoints),
    thresholds: {
      positionToleranceMm: solverConfig.posTolerance,
      orientationToleranceRad: solverConfig.oriTolerance,
      maxJointStepDeg,
      wristSingularityThresholdDeg,
    },
  }
}
