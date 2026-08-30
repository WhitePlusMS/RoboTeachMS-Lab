import { JOINT_LIMIT_EPS_DEG, type IKCandidateRecord } from '@/robot-geometry/numerical-ik/candidate-catalog.ts'
import type { JointAngles } from '@/robot-geometry/model/joint-pose.ts'
import type { JointFailureDetail, WaypointFailureDiagnostic } from './waypoint-types.ts'

/**
 * 步长诊断的选轴策略：找出最能解释 joint-step 失败的关节轴。
 * - 'max-delta'：扫描全部六轴，选步长最大的轴（候选图 DP 路径原有行为）。
 * - 'preferred-axes'：只在 `preferredAxes` 指定的轴中选步长最大的，未提供时退化为 'max-delta'
 *   （逐点腕部逃离路径原有行为，用于避免把 J1 的小误差误报为腕部故障）。
 * 两条求解路径各自的调用方式逐字保留，本模块只收拢重复实现，不统一选轴口径。
 */
export function selectStepFailureAxis(
  previous: JointAngles,
  attempted: JointAngles,
  preferredAxes?: readonly number[],
): { axisIndex: number; deltaDeg: number } {
  const axes = preferredAxes && preferredAxes.length > 0 ? preferredAxes : attempted.map((_value, index) => index)
  let axisIndex = axes[0]
  let deltaDeg = Math.abs(attempted[axisIndex] - previous[axisIndex])
  for (const index of axes.slice(1)) {
    const candidateDelta = Math.abs(attempted[index] - previous[index])
    if (candidateDelta > deltaDeg) {
      axisIndex = index
      deltaDeg = candidateDelta
    }
  }
  return { axisIndex, deltaDeg }
}

/** 步长失败诊断：previous/attempted 为同一关节向量，按 `selectStepFailureAxis` 选轴后打包成关节级诊断。 */
export function buildStepFailureDetail(
  previous: JointAngles,
  attempted: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
  preferredAxes?: readonly number[],
): JointFailureDetail {
  const { axisIndex, deltaDeg } = selectStepFailureAxis(previous, attempted, preferredAxes)
  return {
    axisIndex,
    previousAngleDeg: previous[axisIndex],
    attemptedAngleDeg: attempted[axisIndex],
    deltaDeg,
    limitRangeDeg: jointRanges[axisIndex],
  }
}

/**
 * 限位诊断的选轴策略：从单个已知关节解 `attempted` 中找出真正触及限位的轴。
 * 找第一个落在 `[min+eps, max-eps]` 之外的轴（逐点腕部逃离路径原有行为）；
 * 未命中时退回轴 0，保持“总能给出一个轴”的既有契约。
 */
export function selectNearestLimitAxis(
  attempted: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
  eps = JOINT_LIMIT_EPS_DEG,
): number {
  const axisIndex = attempted.findIndex((value, index) => {
    const [min, max] = jointRanges[index]
    return value <= min + eps || value >= max - eps
  })
  return axisIndex >= 0 ? axisIndex : 0
}

/** 限位诊断：previous/attempted 为同一关节向量，按 `selectNearestLimitAxis` 选轴后打包成关节级诊断。 */
export function buildJointLimitFailureDetail(
  previous: JointAngles,
  attempted: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
): JointFailureDetail {
  const axisIndex = selectNearestLimitAxis(attempted, jointRanges)
  return {
    axisIndex,
    previousAngleDeg: previous[axisIndex],
    attemptedAngleDeg: attempted[axisIndex],
    deltaDeg: Math.abs(attempted[axisIndex] - previous[axisIndex]),
    limitRangeDeg: jointRanges[axisIndex],
  }
}

/**
 * 候选图 DP 路径专用的限位诊断：从候选目录里按“先看是否夹限位、再比最大步长”排序取最优候选，
 * 再在该候选的六个轴中按越界严重度（真正越界的距离，贴近边界的记 0.5）选出归咎轴。
 * 与 `buildJointLimitFailureDetail`（逐点路径的“第一个贴近边界的轴”）是两种不同的选轴口径，
 * 各自对应不同求解策略下已验证过的诊断行为，本次收拢只消除重复实现，不改变归咎轴逻辑。
 */
export function buildCandidateLimitFailureDetail(
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
  return {
    waypointIndex,
    axisIndex,
    previousAngleDeg: previousJoints[axisIndex],
    attemptedAngleDeg: attempted[axisIndex],
    deltaDeg: Math.abs(attempted[axisIndex] - previousJoints[axisIndex]),
    limitRangeDeg: jointRanges[axisIndex],
  }
}
