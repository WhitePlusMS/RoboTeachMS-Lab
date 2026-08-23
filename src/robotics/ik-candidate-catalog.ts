import type { RobotModel } from './robot-model.ts'
import type { IKCandidate, JointAngles, Pose } from './types.ts'

const NORMALIZATION_TURNS = [-2, -1, 0, 1, 2] as const
const RANGE_EPSILON_DEG = 1e-7
/** 候选接近关节限位的统一软边界，单位为度。 */
export const JOINT_LIMIT_EPS_DEG = 0.5

/** 解析候选经过统一归一化后的完整记录；目录不负责选择最终构型。 */
export interface IKCandidateRecord extends IKCandidate {
  /** 将 ±360° 等价表示恢复到关节范围且尽量贴近参考姿态后的关节值。 */
  normalizedJoints: JointAngles | null
  /** 所有轴都能在给定限位内表示时为 true。 */
  withinJointRanges: boolean
  /** 是否至少有一轴贴近软限位边界。 */
  atJointLimit: boolean
  /** 与本次参考关节的最大轴差，单位为度。 */
  maxJointDeltaDeg: number
  /** 六轴欧氏连续性距离，单位为度。 */
  distanceFromReferenceDeg: number
}

export interface IKCandidateSelectionOptions {
  positionTolerance: number
  orientationTolerance: number
  maxJointStepDeg?: number
  rejectAtJointLimit?: boolean
}

function normalizeToRanges(
  candidate: JointAngles,
  reference: JointAngles,
  ranges: readonly (readonly [number, number])[] | undefined,
): JointAngles | null {
  if (!ranges) return [...candidate] as JointAngles
  const normalized = [...candidate] as JointAngles
  for (let index = 0; index < normalized.length; index += 1) {
    const range = ranges[index]
    if (!range) return null
    const [min, max] = range
    const values = NORMALIZATION_TURNS
      .map((turns) => candidate[index] + turns * 360)
      .filter((value) => value >= min - RANGE_EPSILON_DEG && value <= max + RANGE_EPSILON_DEG)
    if (values.length === 0) return null
    values.sort((left, right) =>
      Math.abs(left - reference[index]) - Math.abs(right - reference[index]),
    )
    normalized[index] = values[0]
  }
  return normalized
}

/** 判定候选是否触及任一模型关节限位，供路径规划器统一使用。 */
export function isCandidateAtJointLimit(
  joints: JointAngles,
  ranges: readonly (readonly [number, number])[],
): boolean {
  return joints.some((value, index) => {
    const range = ranges[index]
    if (!range) return true
    const [min, max] = range
    return value <= min + JOINT_LIMIT_EPS_DEG || value >= max - JOINT_LIMIT_EPS_DEG
  })
}

/**
 * 构建一次目标位姿的完整候选目录。
 *
 * 解析模型只负责产生分支；这里统一完成角度归一化和连续性元数据，调用方
 * 再依据自己的路径策略做残差、限位和构型选择，避免 IK 入口各自维护一套筛选。
 */
export function buildIKCandidateCatalog(
  targetPose: Pose,
  referenceJoints: JointAngles,
  model: RobotModel,
  jointRanges?: readonly (readonly [number, number])[],
): IKCandidateRecord[] {
  if (!model.solveAllIK) return []
  return model.solveAllIK(targetPose, referenceJoints).map((candidate) => {
    const normalizedJoints = normalizeToRanges(candidate.joints, referenceJoints, jointRanges)
    const withinJointRanges = normalizedJoints !== null
    const candidateJoints = normalizedJoints ?? candidate.joints
    const deltas = candidateJoints.map((value, index) =>
      Math.abs(value - referenceJoints[index]),
    )
    return {
      ...candidate,
      normalizedJoints,
      withinJointRanges,
      atJointLimit:
        normalizedJoints !== null && jointRanges !== undefined
          ? isCandidateAtJointLimit(normalizedJoints, jointRanges)
          : false,
      maxJointDeltaDeg: Math.max(...deltas),
      distanceFromReferenceDeg: Math.hypot(...deltas),
    }
  })
}

/** 从候选目录统一选择离参考姿态最近的合法候选；不改变目录顺序或原始记录。 */
export function selectBestIKCandidate(
  catalog: readonly IKCandidateRecord[],
  options: IKCandidateSelectionOptions,
): IKCandidateRecord | null {
  const valid = catalog.filter(
    (candidate) =>
      candidate.normalizedJoints !== null &&
      candidate.withinJointRanges &&
      (options.rejectAtJointLimit !== true || !candidate.atJointLimit) &&
      candidate.positionErrorMm <= options.positionTolerance &&
      candidate.orientationErrorRad <= options.orientationTolerance &&
      (options.maxJointStepDeg === undefined || candidate.maxJointDeltaDeg <= options.maxJointStepDeg),
  )
  return valid.reduce<IKCandidateRecord | null>(
    (best, candidate) =>
      best === null || candidate.distanceFromReferenceDeg < best.distanceFromReferenceDeg
        ? candidate
        : best,
    null,
  )
}
