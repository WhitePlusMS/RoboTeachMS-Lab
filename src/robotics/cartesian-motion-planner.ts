import type { RobotProfile } from './robot-profile.ts'
import type { JointAngles, Pose } from './types.ts'
import { planCartesianPath, type CartesianPathResult } from './cartesian-path-planner.ts'
import {
  mat3Mul,
  rotationDistanceRad,
  rotationMatrixToEulerZYX,
} from './math/rotation3d.ts'

/** 手动笛卡尔目标规划 seam；实现可以是同步测试 adapter 或 Worker adapter。 */
export type CartesianTargetPlanner = (
  targetPose: Pose,
  initialJoints: JointAngles,
  options?: CartesianTargetPlanningOptions,
) => CartesianPathResult

/** 手动笛卡尔规划策略；腕部姿态放宽只允许由机械零位邻域自动触发。 */
export interface CartesianTargetPlanningOptions {
  /** 允许平移按钮自动进入受限局部腕部姿态过渡；具体资格由规划器判定。 */
  allowWristEntry?: boolean
}

const WRIST_TRANSITION_J5_WINDOW_DEG = 10
const WRIST_TRANSITION_J5_MIN_DEG = 1
const WRIST_TRANSITION_BOUNDARY_DEG = 180
const WRIST_TRANSITION_MAX_ORIENTATION_DEG = 2
const WRIST_TRANSITION_OFFSETS_DEG = [0.5, 1, 1.5, 2] as const

function axisRotation(axis: 0 | 1 | 2, angleRad: number): number[][] {
  const cosine = Math.cos(angleRad)
  const sine = Math.sin(angleRad)
  if (axis === 0) return [[1, 0, 0], [0, cosine, -sine], [0, sine, cosine]]
  if (axis === 1) return [[cosine, 0, sine], [0, 1, 0], [-sine, 0, cosine]]
  return [[cosine, -sine, 0], [sine, cosine, 0], [0, 0, 1]]
}

/**
 * 识别“严格姿态已经把腕部推向边界”的点动起点。
 * 这不是普通 J5 奇异判定：必须同时满足 J5 低角度和 J4/J6 大范围边界，
 * 避免把普通工作区的姿态失败误切到 Wrist。
 */
function isNearWristTransitionBoundary(
  joints: JointAngles,
  model: RobotProfile['model'],
): boolean {
  if (!model.isWristSingularity) return false
  const absJ5 = Math.abs(joints[4])
  const wristNearZero =
    absJ5 > WRIST_TRANSITION_J5_MIN_DEG && absJ5 <= WRIST_TRANSITION_J5_WINDOW_DEG
  const wristAxisNearBoundary =
    Math.abs(joints[3]) >= WRIST_TRANSITION_BOUNDARY_DEG ||
    Math.abs(joints[5]) >= WRIST_TRANSITION_BOUNDARY_DEG
  return wristNearZero && wristAxisNearBoundary
}

function transitionTargetOrientation(targetPose: Pose, axis: 0 | 1 | 2, offsetDeg: number): Pose {
  const rotation = mat3Mul(
    axisRotation(axis, (offsetDeg * Math.PI) / 180),
    targetPose.rotation,
  )
  return {
    ...targetPose,
    euler: rotationMatrixToEulerZYX(rotation),
    rotation,
  }
}

interface WristTransitionCost {
  /** 路径中 J4/J6 的最大绝对角度；优先远离机械限位。 */
  maxAbsoluteWristDeg: number
  /** 相对会话起点的最大腕轴位移；用于相同安全余量下的连续性排序。 */
  maxWristDisplacementDeg: number
  /** 腕轴累计变化量；最后用于消除等价候选的抖动。 */
  wristVariationDeg: number
  /** 只有前面指标相同才比较姿态偏移量。 */
  orientationOffsetDeg: number
}

function wristTransitionCost(
  initialJoints: JointAngles,
  result: Extract<CartesianPathResult, { ok: true }>,
  orientationOffsetDeg: number,
): WristTransitionCost {
  let maxAbsoluteWristDeg = 0
  let maxWristDisplacementDeg = 0
  let wristVariationDeg = 0
  let previous = initialJoints
  for (const joints of result.waypoints) {
    maxAbsoluteWristDeg = Math.max(maxAbsoluteWristDeg, Math.abs(joints[3]), Math.abs(joints[5]))
    maxWristDisplacementDeg = Math.max(
      maxWristDisplacementDeg,
      Math.abs(joints[3] - initialJoints[3]),
      Math.abs(joints[5] - initialJoints[5]),
    )
    wristVariationDeg += Math.abs(joints[3] - previous[3]) + Math.abs(joints[5] - previous[5])
    previous = joints
  }
  return {
    maxAbsoluteWristDeg,
    maxWristDisplacementDeg,
    wristVariationDeg,
    orientationOffsetDeg: Math.abs(orientationOffsetDeg),
  }
}

function isBetterWristTransitionCost(
  candidate: WristTransitionCost,
  current: WristTransitionCost | null,
): boolean {
  if (current === null) return true
  if (candidate.maxAbsoluteWristDeg !== current.maxAbsoluteWristDeg) {
    return candidate.maxAbsoluteWristDeg < current.maxAbsoluteWristDeg
  }
  if (candidate.maxWristDisplacementDeg !== current.maxWristDisplacementDeg) {
    return candidate.maxWristDisplacementDeg < current.maxWristDisplacementDeg
  }
  if (candidate.wristVariationDeg !== current.wristVariationDeg) {
    return candidate.wristVariationDeg < current.wristVariationDeg
  }
  return candidate.orientationOffsetDeg < current.orientationOffsetDeg
}

/**
 * 在严格路径失败后，尝试有限的终点姿态过渡。
 * 姿态偏差上限是产品约束，不是通用 IK 容差；候选成功后才标记为 Wrist。
 */
function planLocalWristTransition(
  targetPose: Pose,
  initialJoints: JointAngles,
  profile: RobotProfile,
): CartesianPathResult | null {
  let best: {
    result: Extract<CartesianPathResult, { ok: true }>
    cost: WristTransitionCost
  } | null = null
  for (const offsetDeg of WRIST_TRANSITION_OFFSETS_DEG) {
    for (const axis of [0, 1, 2] as const) {
      for (const direction of [-1, 1] as const) {
        const candidateTarget = transitionTargetOrientation(
          targetPose,
          axis,
          direction * offsetDeg,
        )
        const planned = planCartesianPath(
          candidateTarget,
          initialJoints,
          profile.model,
          profile.jointRanges,
        )
        if (!planned.ok) continue
        const endpoint = planned.waypoints.at(-1)
        if (!endpoint) continue
        const endpointPose = profile.model.forwardKinematics(endpoint)
        if (!endpointPose) continue
        const orientationErrorDeg =
          (rotationDistanceRad(targetPose.rotation, endpointPose.rotation) * 180) / Math.PI
        if (orientationErrorDeg > WRIST_TRANSITION_MAX_ORIENTATION_DEG + 1e-6) continue
        const cost = wristTransitionCost(initialJoints, planned, offsetDeg)
        if (best === null || isBetterWristTransitionCost(cost, best.cost)) {
          best = { result: planned, cost }
        }
      }
    }
  }
  return best ? { ...best.result, appliedSingularityMode: 'wrist' } : null
}

/** 统一手动笛卡尔策略：严格姿态优先，仅在受控腕部窗口内局部过渡。 */
export function planCartesianTarget(
  targetPose: Pose,
  initialJoints: JointAngles,
  profile: RobotProfile,
  options: CartesianTargetPlanningOptions = {},
): CartesianPathResult {
  const strict = planCartesianPath(
    targetPose,
    initialJoints,
    profile.model,
    profile.jointRanges,
  )
  // ABB 的 SingArea\Wrist 不是通用的“不可达重试”。只有起始关节已经处于
  // 机械零位腕部邻域时，严格姿态 IK 失败才允许局部放宽姿态；普通工作区
  // 仍保持严格 6D 位姿约束。
  const mechanicalZeroWristPath =
    profile.model.isMechanicalZeroSingularityNeighborhood?.(initialJoints) ?? false
  const startPose = profile.model.forwardKinematics(initialJoints)
  const hasTranslationDelta =
    startPose !== null &&
    Math.hypot(
      targetPose.position[0] - startPose.position[0],
      targetPose.position[1] - startPose.position[1],
      targetPose.position[2] - startPose.position[2],
    ) > 1e-6
  if (strict.ok || options.allowWristEntry === false || !hasTranslationDelta) return strict
  if (
    !strict.ok &&
    strict.failure === 'joint-step' &&
    isNearWristTransitionBoundary(initialJoints, profile.model)
  ) {
    const transitioned = planLocalWristTransition(targetPose, initialJoints, profile)
    if (transitioned) return transitioned
  }
  if (!mechanicalZeroWristPath) return strict
  return planCartesianPath(
    targetPose,
    initialJoints,
    profile.model,
    profile.jointRanges,
  )
}
