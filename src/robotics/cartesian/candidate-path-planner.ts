import { DEFAULT_IK_CONFIG } from '../inverse-kinematics/numerical-ik.ts'
import {
  buildIKCandidateCatalog,
  type IKCandidateRecord,
} from '../inverse-kinematics/candidate-catalog.ts'
import type { RobotModel } from '../model/robot-model.ts'
import type { JointAngles, Pose } from '../model/joint-pose.ts'
import type { IKSolverConfig, RobotConfiguration } from '../inverse-kinematics/types.ts'
import type { WaypointFailureDiagnostic } from '../inverse-kinematics/waypoint-types.ts'

export interface CandidateGraphOptions {
  solverConfig?: Partial<IKSolverConfig>
  /** J4/J6 的边代价权重；只影响分支选择，不锁死任何关节。 */
  wristContinuityWeight?: number
  /**
   * 相邻 waypoint 的硬步长上限；未提供时沿用笛卡尔路径默认 5°。
   * 传 `null` 表示单目标轻量求解不做硬步长拒绝，只保留连续性代价。
   */
  maxJointStepDeg?: number | null
  /** 默认保持起始关节的型号构型；显式轨迹重放可关闭。 */
  preserveConfiguration?: boolean
}

export type CandidateGraphResult =
  | { ok: true; waypoints: JointAngles[]; cost: number }
  | {
      ok: false
      failure: 'unreachable' | 'joint-limit' | 'joint-step'
      diagnostic?: WaypointFailureDiagnostic
    }

const DEFAULT_WRIST_CONTINUITY_WEIGHT = 4
/** 所有 Cartesian waypoint 共用的相邻关节硬步长上限。 */
export const MAX_CARTESIAN_JOINT_STEP_DEG = 5
/** 自适应加密允许处理的最大单步偏差；超过此值按构型跳变报告失败。 */
export const MAX_ADAPTIVE_JOINT_STEP_DEG = MAX_CARTESIAN_JOINT_STEP_DEG * 2

function edgeCost(previous: JointAngles, next: JointAngles, wristContinuityWeight: number): number {
  return next.reduce((sum, value, index) => {
    const delta = value - previous[index]
    const weight = index === 3 || index === 5 ? wristContinuityWeight : 1
    return sum + weight * delta * delta
  }, 0)
}

function exceedsJointStep(
  previous: JointAngles,
  next: JointAngles,
  maxJointStepDeg: number | null,
): boolean {
  if (maxJointStepDeg === null) return false
  return next.some((value, index) => Math.abs(value - previous[index]) > maxJointStepDeg)
}

function buildStepDiagnostic(
  previous: JointAngles,
  attempted: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
  waypointIndex: number,
): WaypointFailureDiagnostic {
  let axisIndex = 0
  let deltaDeg = Math.abs(attempted[0] - previous[0])
  for (let index = 1; index < attempted.length; index += 1) {
    const candidateDelta = Math.abs(attempted[index] - previous[index])
    if (candidateDelta > deltaDeg) {
      axisIndex = index
      deltaDeg = candidateDelta
    }
  }
  return {
    waypointIndex,
    axisIndex,
    previousAngleDeg: previous[axisIndex],
    attemptedAngleDeg: attempted[axisIndex],
    deltaDeg,
    limitRangeDeg: jointRanges[axisIndex],
  }
}

function buildLimitDiagnostic(
  catalog: readonly IKCandidateRecord[],
  previousJoints: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
  waypointIndex: number,
): WaypointFailureDiagnostic | undefined {
  const candidate = catalog
    .filter((entry) => entry.normalizedJoints !== null)
    .sort((left, right) => {
      if (left.atJointLimit !== right.atJointLimit) return left.atJointLimit ? -1 : 1
      return left.maxJointDeltaDeg - right.maxJointDeltaDeg
    })[0]
  if (!candidate) return undefined

  const attempted = candidate.normalizedJoints ?? candidate.joints
  let axisIndex = 0
  let severity = Number.NEGATIVE_INFINITY
  for (let index = 0; index < attempted.length; index += 1) {
    const range = jointRanges[index]
    const value = attempted[index]
    const currentSeverity = range
      ? value < range[0]
        ? range[0] - value
        : value > range[1]
          ? value - range[1]
          : Math.min(value - range[0], range[1] - value) < 0.5
            ? 0.5
            : 0
      : 0
    if (currentSeverity > severity) {
      severity = currentSeverity
      axisIndex = index
    }
  }
  const deltaDeg = Math.abs(attempted[axisIndex] - previousJoints[axisIndex])
  return {
    waypointIndex,
    axisIndex,
    previousAngleDeg: previousJoints[axisIndex],
    attemptedAngleDeg: attempted[axisIndex],
    deltaDeg,
    limitRangeDeg: jointRanges[axisIndex],
  }
}

function validCandidates(
  catalog: readonly IKCandidateRecord[],
  config: IKSolverConfig,
  referenceConfiguration?: RobotConfiguration,
): IKCandidateRecord[] {
  return catalog.filter(
    (candidate) =>
      candidate.normalizedJoints !== null &&
      candidate.withinJointRanges &&
      !candidate.atJointLimit &&
      candidate.positionErrorMm <= config.posTolerance &&
      candidate.orientationErrorRad <= config.oriTolerance &&
      (referenceConfiguration === undefined ||
        (candidate.configuration !== undefined &&
          candidate.configuration.every(
            (value, index) => value === referenceConfiguration[index],
          ))),
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
  const maxJointStepDeg =
    options.maxJointStepDeg === undefined ? MAX_CARTESIAN_JOINT_STEP_DEG : options.maxJointStepDeg
  const referenceConfiguration =
    options.preserveConfiguration === false
      ? undefined
      : (model.deriveConfiguration?.(initialJoints) ?? undefined)
  const layers: JointAngles[][] = []
  let hasOutOfRangeCandidate = false

  for (let poseIndex = 0; poseIndex < poses.length; poseIndex += 1) {
    const pose = poses[poseIndex]
    const catalog = buildIKCandidateCatalog(toFlange(pose), initialJoints, model, jointRanges)
    hasOutOfRangeCandidate ||= catalog.some((candidate) => !candidate.withinJointRanges)
    const candidates = validCandidates(catalog, config, referenceConfiguration)
      .map((candidate) => candidate.normalizedJoints)
      .filter((candidate): candidate is JointAngles => candidate !== null)
    if (candidates.length === 0) {
      const hasSameGeometryOnAnotherConfiguration =
        referenceConfiguration !== undefined &&
        catalog.some(
          (candidate) =>
            candidate.normalizedJoints !== null &&
            candidate.withinJointRanges &&
            !candidate.atJointLimit &&
            candidate.positionErrorMm <= config.posTolerance &&
            candidate.orientationErrorRad <= config.oriTolerance,
        )
      return {
        ok: false,
        failure:
          hasSameGeometryOnAnotherConfiguration || !hasOutOfRangeCandidate
            ? 'unreachable'
            : 'joint-limit',
        diagnostic: hasOutOfRangeCandidate
          ? hasSameGeometryOnAnotherConfiguration
            ? undefined
            : buildLimitDiagnostic(
                catalog,
                poseIndex === 0 ? initialJoints : layers[poseIndex - 1][0],
                jointRanges,
                poseIndex + 1,
              )
          : undefined,
      }
    }
    layers.push(candidates)
  }

  const costs: number[][] = []
  const previousIndices: number[][] = []
  costs.push(
    layers[0].map((candidate) =>
      exceedsJointStep(initialJoints, candidate, maxJointStepDeg)
        ? Number.POSITIVE_INFINITY
        : edgeCost(initialJoints, candidate, wristContinuityWeight),
    ),
  )
  previousIndices.push(layers[0].map(() => -1))
  if (costs[0].every((cost) => !Number.isFinite(cost))) {
    const attempted = layers[0].reduce((best, candidate) =>
      Math.max(...candidate.map((value, index) => Math.abs(value - initialJoints[index]))) <
      Math.max(...best.map((value, index) => Math.abs(value - initialJoints[index])))
        ? candidate
        : best,
    )
    return {
      ok: false,
      failure: 'joint-step',
      diagnostic: buildStepDiagnostic(initialJoints, attempted, jointRanges, 1),
    }
  }

  for (let layerIndex = 1; layerIndex < layers.length; layerIndex += 1) {
    const currentCosts: number[] = []
    const currentPrevious: number[] = []
    for (const candidate of layers[layerIndex]) {
      let bestCost = Number.POSITIVE_INFINITY
      let bestPrevious = -1
      for (
        let previousIndex = 0;
        previousIndex < layers[layerIndex - 1].length;
        previousIndex += 1
      ) {
        const previous = layers[layerIndex - 1][previousIndex]
        if (
          !Number.isFinite(costs[layerIndex - 1][previousIndex]) ||
          exceedsJointStep(previous, candidate, maxJointStepDeg)
        ) {
          continue
        }
        const cost =
          costs[layerIndex - 1][previousIndex] +
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
      const candidate = layers[layerIndex][0]
      const previous = layers[layerIndex - 1][currentPrevious[0] >= 0 ? currentPrevious[0] : 0]
      return {
        ok: false,
        failure: 'joint-step',
        diagnostic: buildStepDiagnostic(previous, candidate, jointRanges, layerIndex + 1),
      }
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
  if (waypoints[0].every((value, index) => Math.abs(value - initialJoints[index]) <= 1e-9)) {
    waypoints[0] = [...initialJoints] as JointAngles
  }
  return {
    ok: true,
    waypoints,
    cost: lastLayer.find((value) => value === Math.min(...lastLayer)) ?? 0,
  }
}
