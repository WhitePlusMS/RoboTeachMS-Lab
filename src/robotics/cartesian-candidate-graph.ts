import { DEFAULT_IK_CONFIG } from './ik-solver.ts'
import { buildIKCandidateCatalog, type IKCandidateRecord } from './ik-candidate-catalog.ts'
import type { RobotModel } from './robot-model.ts'
import type { IKSolverConfig, JointAngles, Pose } from './types.ts'

export interface CandidateGraphOptions {
  solverConfig?: Partial<IKSolverConfig>
  /** J4/J6 的边代价权重；只影响分支选择，不锁死任何关节。 */
  wristContinuityWeight?: number
}

export type CandidateGraphResult =
  | { ok: true; waypoints: JointAngles[]; cost: number }
  | { ok: false; failure: 'unreachable' | 'joint-limit' | 'joint-step' }

const DEFAULT_WRIST_CONTINUITY_WEIGHT = 4
/** 所有 Cartesian waypoint 共用的相邻关节硬步长上限。 */
export const MAX_CARTESIAN_JOINT_STEP_DEG = 5

function edgeCost(
  previous: JointAngles,
  next: JointAngles,
  wristContinuityWeight: number,
): number {
  return next.reduce((sum, value, index) => {
    const delta = value - previous[index]
    const weight = index === 3 || index === 5 ? wristContinuityWeight : 1
    return sum + weight * delta * delta
  }, 0)
}

function exceedsJointStep(previous: JointAngles, next: JointAngles): boolean {
  return next.some(
    (value, index) => Math.abs(value - previous[index]) > MAX_CARTESIAN_JOINT_STEP_DEG,
  )
}

function validCandidates(
  catalog: readonly IKCandidateRecord[],
  config: IKSolverConfig,
): IKCandidateRecord[] {
  return catalog.filter(
    (candidate) =>
      candidate.normalizedJoints !== null &&
      candidate.withinJointRanges &&
      !candidate.atJointLimit &&
      candidate.positionErrorMm <= config.posTolerance &&
      candidate.orientationErrorRad <= config.oriTolerance,
  )
}

/**
 * 对一条严格笛卡尔路径执行候选层动态规划。
 * 每层保留全部合法解析分支，最终按整条路径的关节连续性代价回溯，避免
 * “当前 waypoint 最近”把下一 waypoint 推到 J4/J6 的另一等价构型。
 */
export function planStrictCandidateGraph(
  poses: readonly Pose[],
  initialJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  toFlange: (pose: Pose) => Pose,
  options: CandidateGraphOptions = {},
): CandidateGraphResult {
  if (poses.length === 0) return { ok: true, waypoints: [], cost: 0 }
  if (!model.solveAllIK) return { ok: false, failure: 'unreachable' }
  const config = { ...DEFAULT_IK_CONFIG, ...options.solverConfig }
  const wristContinuityWeight = options.wristContinuityWeight ?? DEFAULT_WRIST_CONTINUITY_WEIGHT
  const layers: JointAngles[][] = []
  let hasOutOfRangeCandidate = false

  for (const pose of poses) {
    const catalog = buildIKCandidateCatalog(toFlange(pose), initialJoints, model, jointRanges)
    hasOutOfRangeCandidate ||= catalog.some((candidate) => !candidate.withinJointRanges)
    const candidates = validCandidates(catalog, config)
      .map((candidate) => candidate.normalizedJoints)
      .filter((candidate): candidate is JointAngles => candidate !== null)
    if (candidates.length === 0) {
      return { ok: false, failure: hasOutOfRangeCandidate ? 'joint-limit' : 'unreachable' }
    }
    layers.push(candidates)
  }

  const costs: number[][] = []
  const previousIndices: number[][] = []
  costs.push(
    layers[0].map((candidate) =>
      exceedsJointStep(initialJoints, candidate)
        ? Number.POSITIVE_INFINITY
        : edgeCost(initialJoints, candidate, wristContinuityWeight),
    ),
  )
  previousIndices.push(layers[0].map(() => -1))
  if (costs[0].every((cost) => !Number.isFinite(cost))) return { ok: false, failure: 'joint-step' }

  for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) {
    const currentCosts: number[] = []
    const currentPrevious: number[] = []
    for (const candidate of layers[layerIndex]) {
      let bestCost = Number.POSITIVE_INFINITY
      let bestPrevious = -1
      for (let previousIndex = 0; previousIndex < layers[layerIndex - 1].length; previousIndex += 1) {
        const previous = layers[layerIndex - 1][previousIndex]
        if (!Number.isFinite(costs[layerIndex - 1][previousIndex]) || exceedsJointStep(previous, candidate)) {
          continue
        }
        const cost = costs[layerIndex - 1][previousIndex] +
          edgeCost(previous, candidate, wristContinuityWeight)
        if (cost < bestCost) {
          bestCost = cost
          bestPrevious = previousIndex
        }
      }
      currentCosts.push(bestCost)
      currentPrevious.push(bestPrevious)
    }
    costs.push(currentCosts)
    previousIndices.push(currentPrevious)
    if (currentCosts.every((cost) => !Number.isFinite(cost))) {
      return { ok: false, failure: 'joint-step' }
    }
  }

  const lastLayer = costs[costs.length - 1]
  let lastIndex = 0
  for (let index = 1; index < lastLayer.length; index += 1) {
    if (lastLayer[index] < lastLayer[lastIndex]) lastIndex = index
  }
  const waypoints = new Array<JointAngles>(layers.length)
  for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
    waypoints[layerIndex] = layers[layerIndex][lastIndex]
    lastIndex = previousIndices[layerIndex][lastIndex]
  }
  if (
    waypoints[0].every((value, index) => Math.abs(value - initialJoints[index]) <= 1e-9)
  ) {
    waypoints[0] = [...initialJoints] as JointAngles
  }
  return { ok: true, waypoints, cost: lastLayer.find((value) => value === Math.min(...lastLayer)) ?? 0 }
}
