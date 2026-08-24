import type { RobotModel } from './robot-model.ts'
import type { ABBConfiguration, IKCandidate, JointAngles, Pose } from './types.ts'

const RANGE_EPSILON_DEG = 1e-7
/** 候选接近关节限位的统一软边界，单位为度。 */
export const JOINT_LIMIT_EPS_DEG = 0.5

/** 解析候选经过统一归一化后的完整记录；目录不负责选择最终构型。 */
export interface IKCandidateRecord extends IKCandidate {
  /** 解析分支的 ABB 构型参数 [cf1, cf4, cf6, cfx]；供构型一致性筛选直接使用。 */
  configuration?: ABBConfiguration
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
  /**
   * 当前姿态的 ABB 构型 [cf1, cf4, cf6, cfx]。提供时优先选择与该构型完全一致
   * 的候选（真实控制器语义：未声明 SingArea 时运动不改变构型）；仅当没有任何
   * 合法候选能保持构型时才退回到全局最近候选。
   */
  referenceConfiguration?: ABBConfiguration
}

/**
 * 枚举解析候选在关节范围内的全部等价角度表示。
 *
 * 不能在这里只保留离固定 reference 最近的一份表示：例如 J4 的 92° 与
 * -268°、J6 的 -92° 与 268° 在姿态上等价，但路径层可能需要其中不同的
 * 圈数才能与上一 waypoint 连续。候选目录只负责保留合法表示，最终选择交给
 * 当前关节参考或整条路径候选图。
 */
function enumerateRangeRepresentations(
  candidate: JointAngles,
  ranges: readonly (readonly [number, number])[] | undefined,
): JointAngles[] {
  if (!ranges) return [[...candidate] as JointAngles]
  const perAxis: number[][] = []
  for (let index = 0; index < candidate.length; index += 1) {
    const range = ranges[index]
    if (!range) return []
    const [min, max] = range
    const firstTurns = Math.ceil((min - candidate[index]) / 360 - RANGE_EPSILON_DEG)
    const lastTurns = Math.floor((max - candidate[index]) / 360 + RANGE_EPSILON_DEG)
    const values: number[] = []
    for (let turns = firstTurns; turns <= lastTurns; turns += 1) {
      const value = candidate[index] + turns * 360
      if (value >= min - RANGE_EPSILON_DEG && value <= max + RANGE_EPSILON_DEG) {
        values.push(value)
      }
    }
    if (values.length === 0) return []
    perAxis.push(values)
  }
  let representations: JointAngles[] = [[] as unknown as JointAngles]
  for (const values of perAxis) {
    const next: JointAngles[] = []
    for (const prefix of representations) {
      for (const value of values) {
        next.push([...prefix, value] as unknown as JointAngles)
      }
    }
    representations = next
  }
  return representations
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
  return model.solveAllIK(targetPose, referenceJoints).flatMap<IKCandidateRecord>(
    (candidate): IKCandidateRecord[] => {
    const representations = enumerateRangeRepresentations(candidate.joints, jointRanges)
    if (representations.length === 0) {
      const deltas = candidate.joints.map((value, index) =>
        Math.abs(value - referenceJoints[index]),
      )
      return [{
        ...candidate,
        normalizedJoints: null,
        withinJointRanges: false,
        atJointLimit: false,
        maxJointDeltaDeg: Math.max(...deltas),
        distanceFromReferenceDeg: Math.hypot(...deltas),
      }]
    }
    return representations.map((representation) => {
      const deltas = representation.map((value, index) =>
        Math.abs(value - referenceJoints[index]),
      )
      return {
        ...candidate,
        normalizedJoints: representation,
        withinJointRanges: true,
        atJointLimit:
          jointRanges !== undefined
            ? isCandidateAtJointLimit(representation, jointRanges)
            : false,
        maxJointDeltaDeg: Math.max(...deltas),
        distanceFromReferenceDeg: Math.hypot(...deltas),
      }
    })
    },
  )
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
  // ABB 构型语义：能在当前 [cf1, cf4, cf6, cfx] 下到达时，不允许跳到别的分支，
  // 即使异构型候选离参考姿态更近。
  const referenceConfiguration = options.referenceConfiguration
  const pool = referenceConfiguration
    ? valid.filter(
        (candidate) =>
          candidate.configuration !== undefined &&
          candidate.configuration.every((value, index) => value === referenceConfiguration[index]),
      )
    : []
  const selectable = pool.length > 0 ? pool : valid
  return selectable.reduce<IKCandidateRecord | null>(
    (best, candidate) =>
      best === null || candidate.distanceFromReferenceDeg < best.distanceFromReferenceDeg
        ? candidate
        : best,
    null,
  )
}
