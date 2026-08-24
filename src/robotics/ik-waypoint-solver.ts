import { DEFAULT_IK_CONFIG, solveIK } from './ik-solver.ts'
import {
  buildIKCandidateCatalog,
  isCandidateAtJointLimit,
  JOINT_LIMIT_EPS_DEG,
  selectBestIKCandidate,
  type IKCandidateRecord,
} from './ik-candidate-catalog.ts'
import {
  MAX_CARTESIAN_JOINT_STEP_DEG,
  planStrictCandidateGraph,
} from './cartesian-candidate-graph.ts'
import { rotationDistanceRad } from './math/rotation3d.ts'
import type { RobotModel } from './robot-model.ts'
import type { IKSolverConfig, JointAngles, Pose } from './types.ts'

/** 相邻关节步长上限（度）：连续笛卡尔路径（MoveL/MoveC）逐点求解的构型跳变护栏。 */
export const MAX_JOINT_STEP_DEG = MAX_CARTESIAN_JOINT_STEP_DEG

/**
 * 机械零位第一次脱离腕部奇异时的 J5 目标偏置（度）。
 * 只作为解析逃离支路上 DLS 位置精化的初值偏置，不改变普通工作区的严格姿态规划。
 */
const WRIST_ESCAPE_J5_DEG = 2
/** 局部 SingArea\Wrist 允许的最大 TCP 姿态误差；位置仍使用严格 IK 容差。 */
const WRIST_ORIENTATION_TOLERANCE_RAD = (2 * Math.PI) / 180
/** wrist 逃离精化中的 J4 连续性正则；避免 DLS 在位置冗余下跳到另一腕部构型。 */
const WRIST_J4_CONTINUITY_WEIGHT = 100
/** 已应用的腕部奇异回退模式；当前仅 'wrist'。 */
export type AppliedSingularityMode = 'wrist'

/** 共享的笛卡尔路径失败原因；上层可据此给出可操作的诊断提示。 */
export type WaypointFailureReason =
  | 'wrist-singularity'
  | 'wrist-reconfiguration'
  | 'joint-limit'
  | 'joint-step'
  | 'ik-not-converged'

/**
 * 腕部奇异处理在单点 IK 入口内的可复用上下文。
 * 由路径规划器在 waypoint 之间维护，保证逃离方向、姿态窗口等状态连续。
 */
export interface WristSingularityContext {
  /** 第一次脱离 J5≈0 时选择的目标 J5 侧。 */
  escapeDirection: -1 | 1
  /** 是否已经真正离开腕部奇异面。 */
  escapeDone: boolean
  /**
   * 成功脱离后沿用的姿态窗口；后续 waypoint 在此窗口内保持 TCP 位置，
   * 姿态由脱离后的实际法兰位姿固定，避免反复切回严格目标。
   */
  escapePose: Pick<Pose, 'euler' | 'rotation'> | null
}

/** 单个 waypoint 失败时的关节级诊断；角度单位为度，轴索引从 0 开始。 */
export interface JointFailureDetail {
  axisIndex: number
  previousAngleDeg: number
  attemptedAngleDeg?: number
  deltaDeg?: number
  limitRangeDeg?: readonly [number, number]
}

/** 路径失败诊断；waypointIndex 对用户展示时从 1 开始。 */
export interface WaypointFailureDiagnostic extends JointFailureDetail {
  waypointIndex: number
}

export type WaypointSolveResult =
  | {
      ok: true
      waypoints: JointAngles[]
      appliedSingularityMode: AppliedSingularityMode | null
    }
  | {
      ok: false
      failure: WaypointFailureReason
      diagnostic?: WaypointFailureDiagnostic
    }

/** IK 解是否被夹在任一关节范围边界（启发式，用于判别 joint-limit）。 */
export function isJointAtLimit(
  joints: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
): boolean {
  return isCandidateAtJointLimit(joints, jointRanges)
}

type JointSolutionFailureReason = 'joint-limit' | 'unreachable' | 'joint-step'

type JointSolutionFailure = {
  failure: JointSolutionFailureReason
  detail?: JointFailureDetail
}

type JointSolutionResult =
  | { joints: JointAngles; wristContext?: WristSingularityContext }
  | JointSolutionFailure

/** 找出最能解释失败的关节轴；优先选择最大步长，避免把 J1 的小误差误报为腕部故障。 */
function buildJointStepDetail(
  previous: JointAngles,
  attempted: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
  preferredAxes?: readonly number[],
): JointFailureDetail {
  const axes = preferredAxes && preferredAxes.length > 0
    ? preferredAxes
    : attempted.map((_value, index) => index)
  let axisIndex = axes[0]
  let deltaDeg = Math.abs(attempted[axisIndex] - previous[axisIndex])
  for (const index of axes.slice(1)) {
    const candidateDelta = Math.abs(attempted[index] - previous[index])
    if (candidateDelta > deltaDeg) {
      axisIndex = index
      deltaDeg = candidateDelta
    }
  }
  return {
    axisIndex,
    previousAngleDeg: previous[axisIndex],
    attemptedAngleDeg: attempted[axisIndex],
    deltaDeg,
    limitRangeDeg: jointRanges[axisIndex],
  }
}

/** 从贴近范围边界的候选中指出实际触及限位的轴。 */
function buildJointLimitDetail(
  previous: JointAngles,
  attempted: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
): JointFailureDetail {
  const axisIndex = attempted.findIndex((value, index) => {
    const [min, max] = jointRanges[index]
    return value <= min + JOINT_LIMIT_EPS_DEG || value >= max - JOINT_LIMIT_EPS_DEG
  })
  const selectedAxis = axisIndex >= 0 ? axisIndex : 0
  return {
    axisIndex: selectedAxis,
    previousAngleDeg: previous[selectedAxis],
    attemptedAngleDeg: attempted[selectedAxis],
    deltaDeg: Math.abs(attempted[selectedAxis] - previous[selectedAxis]),
    limitRangeDeg: jointRanges[selectedAxis],
  }
}

function resolveAnalyticJointSolution(
  targetPose: Pose,
  referenceJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  solverConfig: Partial<IKSolverConfig>,
  continuityLimitDeg: number | undefined,
): JointSolutionResult | undefined {
  if (!model.solveAllIK || solverConfig.positionOnly || solverConfig.lockedJointTargetsDeg) {
    return undefined
  }
  const config = { ...DEFAULT_IK_CONFIG, ...solverConfig }
  const candidates = buildIKCandidateCatalog(targetPose, referenceJoints, model, jointRanges)
  if (candidates.length === 0) return { failure: 'unreachable' }
  // `isLeastSquares` 只是解析器对数值残差的分类标记；是否能执行必须由本次
  // 规划的真实位置/旋转角容差决定，不能因为 1e-8 的内部标记阈值提前拒绝合法候选。
  const residualCandidates = candidates.filter(
    (candidate) =>
      candidate.positionErrorMm <= config.posTolerance &&
      candidate.orientationErrorRad <= config.oriTolerance,
  )
  if (residualCandidates.length === 0) return { failure: 'unreachable' }
  const bestCandidate = selectBestIKCandidate(residualCandidates, {
    positionTolerance: config.posTolerance,
    orientationTolerance: config.oriTolerance,
    maxJointStepDeg: continuityLimitDeg,
    rejectAtJointLimit: true,
    referenceConfiguration: model.deriveConfiguration?.(referenceJoints) ?? undefined,
  })
  if (!bestCandidate?.normalizedJoints) {
    const normalizedCandidates = residualCandidates
      .map((candidate) => candidate.normalizedJoints)
      .filter((candidate): candidate is JointAngles => candidate !== null)
    const continuousCandidate = normalizedCandidates.find(
      (candidate) =>
        !isJointAtLimit(candidate, jointRanges) &&
        continuityLimitDeg !== undefined &&
        Math.max(...candidate.map((value, index) => Math.abs(value - referenceJoints[index]))) >
          continuityLimitDeg,
    )
    if (continuousCandidate) {
      return {
        failure: 'joint-step',
        detail: buildJointStepDetail(
          referenceJoints,
          continuousCandidate,
          jointRanges,
          isNearWristSingularity(model, referenceJoints) ? [3, 5] : undefined,
        ),
      }
    }
    const limitedCandidate = normalizedCandidates.find((candidate) =>
      isJointAtLimit(candidate, jointRanges),
    )
    return limitedCandidate
      ? { failure: 'joint-limit', detail: buildJointLimitDetail(referenceJoints, limitedCandidate, jointRanges) }
      : { failure: 'joint-limit' }
  }
  const best = bestCandidate.normalizedJoints
  const isReferenceEquivalent = best.every(
    (value, index) => Math.abs(value - referenceJoints[index]) <= 1e-9,
  )
  return { joints: isReferenceEquivalent ? [...referenceJoints] as JointAngles : best }
}

/** ABB 腕部奇异的关节空间近似：J5 接近 0° 时轴 4 与轴 6 共线。 */
function isNearWristSingularity(model: RobotModel, joints: JointAngles): boolean {
  return model.isWristSingularity?.(joints) ?? false
}

/**
 * J5 位于腕部奇异面时，完整姿态的数值逆解可能把 J4/J6 重新分配到另一构型。
 * 这种相邻 waypoint 跳变不是普通步长过大，而是 ABB 所说的 wrist re-configuration。
 */
function isWristReconfiguration(
  model: RobotModel,
  previous: JointAngles,
  next: JointAngles,
): boolean {
  const wristStep = Math.max(Math.abs(next[3] - previous[3]), Math.abs(next[5] - previous[5]))
  return (
    wristStep > MAX_JOINT_STEP_DEG &&
    (isNearWristSingularity(model, previous) || isNearWristSingularity(model, next))
  )
}

/**
 * 腕部奇异逃离的解析支路选择：在统一候选目录中选出落在目标 J5 侧、姿态偏差在
 * SingArea\Wrist 窗口内、连续性合法且离参考姿态最近的表示。
 *
 * 解析 IK 是构型事实的唯一来源；这里不做位置残差硬过滤——逃离候选允许的姿态
 * 偏差会以 d6·sin(θ) 量级体现为位置残差，位置精度由调用方在同一解析支路上
 * 用 DLS 局部精化恢复。找不到合法候选时返回 null，由调用方按失败处理。
 */
function selectWristEscapeCandidate(
  targetPose: Pose,
  referenceJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  escapeDirection: -1 | 1,
  continuityLimitDeg?: number,
): IKCandidateRecord | null {
  const candidates = buildIKCandidateCatalog(targetPose, referenceJoints, model, jointRanges)
  const valid = candidates.filter((candidate) => {
    if (candidate.normalizedJoints === null) return false
    if (!candidate.withinJointRanges || candidate.atJointLimit) return false
    if (candidate.orientationErrorRad > WRIST_ORIENTATION_TOLERANCE_RAD) return false
    const j5 = candidate.normalizedJoints[4]
    // J5 恰为 0 时仍处于奇异面上，两侧皆可接受，由连续性距离决定。
    if (j5 !== 0 && Math.sign(j5) !== escapeDirection) return false
    if (continuityLimitDeg !== undefined && candidate.maxJointDeltaDeg > continuityLimitDeg) {
      return false
    }
    return true
  })
  let best: IKCandidateRecord | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of valid) {
    const distance = normalizedJointDistance(
      candidate.normalizedJoints as JointAngles,
      referenceJoints,
      jointRanges,
    )
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/**
 * 生成有限、确定性、受关节范围约束的备用 IK 初值：由当前关节姿态派生各构型翻转
 * （腕部翻转、J1 肩部镜像、肩肘翻转），钳位到关节范围并去重。数量有固定上限，
 * 不做随机搜索或无界循环，且不含当前初值本身。
 *
 * 经验上数值 IK 的收敛盆地很窄，大幅运动/圆弧连续位姿时当前初值常落入错误分支；
 * 将当前姿态按物理构型翻转得到的初值能落在正确解的盆地内。MoveJ/MoveL/MoveC 共用。
 */
export function buildAlternateIKSeeds(
  currentJoints: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
): JointAngles[] {
  const j1Range = jointRanges[0]
  // 把角度按 [min,max] 范围回绕到合法区间（用于 ±180° 肩部镜像）。
  const wrap = (value: number): number => {
    const span = j1Range[1] - j1Range[0]
    let out = value
    while (out > j1Range[1]) out -= span
    while (out < j1Range[0]) out += span
    return out
  }
  // 统一钳位到关节范围；solveIK 内部也会钳位，这里显式保证初值受约束。
  const clamp = (values: number[]) =>
    values.map((value, index) => {
      const [min, max] = jointRanges[index]
      return Math.max(min, Math.min(max, value))
    }) as JointAngles

  const raw = [
    // 腕部翻转（J4/J6 +180、J5 取负）。
    [
      currentJoints[0],
      currentJoints[1],
      currentJoints[2],
      currentJoints[3] + 180,
      -currentJoints[4],
      currentJoints[5] + 180,
    ],
    // J1 肩部镜像（+180 回绕）。
    [
      wrap(currentJoints[0] + 180),
      currentJoints[1],
      currentJoints[2],
      currentJoints[3],
      currentJoints[4],
      currentJoints[5],
    ],
    // J1 肩部镜像（-180 回绕）。
    [
      wrap(currentJoints[0] - 180),
      currentJoints[1],
      currentJoints[2],
      currentJoints[3],
      currentJoints[4],
      currentJoints[5],
    ],
    // J1 镜像 + 腕部翻转。
    [
      wrap(currentJoints[0] + 180),
      currentJoints[1],
      currentJoints[2],
      currentJoints[3] + 180,
      -currentJoints[4],
      currentJoints[5] + 180,
    ],
    // 肩肘翻转（J2/J3 取负）。
    [
      currentJoints[0],
      -currentJoints[1],
      -currentJoints[2],
      currentJoints[3],
      currentJoints[4],
      currentJoints[5],
    ],
    // 肩肘翻转 + 腕部翻转。
    [
      currentJoints[0],
      -currentJoints[1],
      -currentJoints[2],
      currentJoints[3] + 180,
      -currentJoints[4],
      currentJoints[5] + 180,
    ],
  ]
    .map(clamp)
    // 去重：初始 seed 与当前初值重复、或翻转后互相重复的丢弃。
    .filter((seed, index, all) => {
      if (seed.every((value, i) => value === currentJoints[i])) return false
      return all.findIndex((other) => other.every((value, i) => value === seed[i])) === index
    })
  return raw
}

/** 按各轴关节范围归一化后的距离，用于在多个候选解中选出离参考关节姿态最近的解。 */
function normalizedJointDistance(
  a: JointAngles,
  b: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
): number {
  let sum = 0
  for (let index = 0; index < a.length; index += 1) {
    const [min, max] = jointRanges[index]
    const delta = (a[index] - b[index]) / (max - min)
    sum += delta * delta
  }
  return Math.sqrt(sum)
}

function withWaypointDiagnostic(
  failure: WaypointFailureReason,
  detail: JointFailureDetail | undefined,
  waypointIndex: number,
): WaypointSolveResult {
  if (!detail) return { ok: false, failure }
  return {
    ok: false,
    failure,
    diagnostic: { ...detail, waypointIndex: waypointIndex + 1 },
  }
}

function mapJointSolutionFailure(
  failure: JointSolutionFailureReason,
  mechanicalZeroWristPath: boolean,
  nearWristSingularity: boolean,
): WaypointFailureReason {
  if (failure === 'joint-limit') return 'joint-limit'
  if (failure === 'joint-step') {
    return mechanicalZeroWristPath && nearWristSingularity
      ? 'wrist-reconfiguration'
      : 'joint-step'
  }
  return mechanicalZeroWristPath && nearWristSingularity
    ? 'wrist-singularity'
    : 'ik-not-converged'
}

/**
 * 末端拖拽操作轴的轻量笛卡尔目标求解。
 *
 * 操作轴每个 pointer frame 只需要求一个目标点，不应像 MoveL 一样生成数百个空间 waypoint；
 * 但它仍必须和 Jog 共用同一套解析候选、残差验收、J4/J6 连续性代价、相邻步长和软限位规则。
 * 因此这里复用一层 `planStrictCandidateGraph`，而不是再走单点数值 IK + 备用 seed 的另一套
 * 分支选择。目标跨越超过一帧可承受的关节步长时返回 null，由操作轴回弹到最近有效姿态，
 * 不允许拖拽过程悄悄切换到另一条构型支路。
 */
export function solveGizmoTarget(
  targetPose: Pose,
  referenceJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  solverConfig: Partial<IKSolverConfig> = {},
): JointAngles | null {
  const graph = planStrictCandidateGraph(
    [targetPose],
    referenceJoints,
    model,
    jointRanges,
    (pose) => pose,
    // 单帧拖拽不使用 MoveL 的 5°硬拒绝；候选连续性代价和软限位仍保持统一。
    { solverConfig, maxJointStepDeg: null },
  )
  if (!graph.ok || graph.waypoints.length === 0) return null
  return graph.waypoints[0]
}

/** 根据单点目标相对当前 TCP 的位移方向选择 J5 脱离方向。 */
function getSinglePointWristEscapeDirection(
  targetPose: Pose,
  referenceJoints: JointAngles,
  model: RobotModel,
): -1 | 1 {
  const startPose = model.forwardKinematics(referenceJoints)
  if (!startPose) return 1
  let dominantDelta = 0
  let dominantAxis = -1
  for (let index = 0; index < 3; index += 1) {
    const delta = targetPose.position[index] - startPose.position[index]
    if (Math.abs(delta) > Math.abs(dominantDelta)) {
      dominantDelta = delta
      dominantAxis = index
    }
  }
  // ABB 机械零位沿 Y 脱离时，Y 正负两侧都优先进入同一正 J5 腕部侧。
  if (dominantAxis === 1) return 1
  return dominantDelta < 0 ? -1 : 1
}

/**
 * 求解一个到达 targetPose 的关节解：先以参考姿态为主初值，成功且不夹边则立即返回；
 * 主初值无效后才扫描有限、确定性的备用初值，在多个候选中选择离参考姿态最近的解。
 * 返回成功解，或带失败原因的标记（主初值夹边 vs 真正不可达）。
 *
 * 该多初值策略显著提升大幅运动与圆弧连续位姿的逆解鲁棒性（MoveJ/MoveL/MoveC 共用），
 * 避免单一连续性初值在收敛盆地窄时陷于局部最小。
 *
 * `solverConfig` 可调 IK 精度（缺省 `{}` 取 solveIK 的 DEFAULT_IK_CONFIG）；MoveL
 * 传送更紧的定位精度，MoveJ/MoveC 用缺省值。
 *
 * `wristContext`（票据 02）：把原本只在 `solvePoseWaypoints` 中实现的腕部奇异回退
 * 下沉到单点 IK 入口。路径规划器在机械零位腕部路径起点创建 `WristSingularityContext`
 * 并在相邻 waypoint 之间传递；MoveJ / Gizmo 等单点调用不传上下文时不触发回退，避免
 * 把关节空间运动错误降级为 position-only。
 */
export function resolveJointSolution(
  targetPose: Pose,
  referenceJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  solverConfig: Partial<IKSolverConfig> = {},
  continuityLimitDeg?: number,
  wristContext?: WristSingularityContext,
): JointSolutionResult {
  // wrist 回退仅在被显式传递的上下文中激活：路径规划器在机械零位腕部路径起点创建
  // wristContext 并在相邻 waypoint 之间传递；MoveJ / Gizmo 等单点调用不传上下文，
  // 因此不会自动把关节空间运动降级为 position-only。
  const wristModeActive = wristContext !== undefined
  const context: WristSingularityContext = wristModeActive
    ? (wristContext ?? {
        escapeDirection: getSinglePointWristEscapeDirection(targetPose, referenceJoints, model),
        escapeDone: false,
        escapePose: null,
      })
    : { escapeDirection: 1, escapeDone: false, escapePose: null }

  // 一旦成功脱离奇异点，后续 waypoint 沿用当时的实际姿态窗口，保持 TCP 直线。
  const effectivePose = context.escapePose
    ? {
        ...targetPose,
        euler: [...context.escapePose.euler] as Pose['euler'],
        rotation: context.escapePose.rotation.map((row) => [...row]),
      }
    : targetPose

  const strictSolved = resolveJointSolutionStrict(
    effectivePose,
    referenceJoints,
    model,
    jointRanges,
    solverConfig,
    continuityLimitDeg,
  )

  // 非 wrist 模式直接返回严格解。
  if (!wristModeActive) return strictSolved

  const nearWristSingularity = isNearWristSingularity(model, referenceJoints)
  const wristFallbackNeeded =
    ('failure' in strictSolved && nearWristSingularity) ||
    ('joints' in strictSolved &&
      isWristReconfiguration(model, referenceJoints, strictSolved.joints))

  if (!wristFallbackNeeded) {
    if ('joints' in strictSolved && context.escapeDone) {
      return { joints: strictSolved.joints, wristContext: context }
    }
    return strictSolved
  }

  // 腕部逃离的唯一决策入口：解析候选目录选出 J5 侧与 J4 连续的支路，
  // DLS 只在该支路上做位置精化（解析法对允许姿态偏差的逃离点没有精确解）。
  const escapeCandidate = selectWristEscapeCandidate(
    effectivePose,
    referenceJoints,
    model,
    jointRanges,
    context.escapeDirection,
    continuityLimitDeg,
  )

  if (escapeCandidate === null) {
    return {
      failure: 'joint-step',
      detail: 'detail' in strictSolved ? strictSolved.detail : undefined,
    }
  }

  const config = { ...DEFAULT_IK_CONFIG, ...solverConfig }
  let escapeJoints = escapeCandidate.normalizedJoints as JointAngles
  if (escapeCandidate.positionErrorMm > config.posTolerance) {
    // 解析候选确定了构型分支；把 J5 推到逃离侧后由 DLS 恢复位置精度，
    // J4 连续性正则防止精化过程跳到另一腕部构型。
    const escapeSeed = [...escapeJoints] as JointAngles
    const [minJ5, maxJ5] = jointRanges[4]
    escapeSeed[4] = Math.max(
      minJ5,
      Math.min(maxJ5, context.escapeDirection * WRIST_ESCAPE_J5_DEG),
    )
    const refined = solveIK(
      effectivePose,
      escapeSeed,
      model,
      {
        ...solverConfig,
        positionOnly: true,
        jointContinuityReferenceDeg: escapeJoints,
        jointContinuityWeights: [0, 0, 0, WRIST_J4_CONTINUITY_WEIGHT, 0, 0],
      },
      jointRanges,
    )
    if (
      refined === null ||
      isJointAtLimit(refined, jointRanges) ||
      (continuityLimitDeg !== undefined &&
        Math.max(...refined.map((value, index) => Math.abs(value - referenceJoints[index]))) >
          continuityLimitDeg)
    ) {
      return {
        failure: 'joint-step',
        detail: 'detail' in strictSolved ? strictSolved.detail : undefined,
      }
    }
    escapeJoints = refined
  }

  const actualFlangePose = model.forwardKinematics(escapeJoints)
  const targetFlangePose = effectivePose
  const orientationErrorRad = actualFlangePose
    ? rotationDistanceRad(targetFlangePose.rotation, actualFlangePose.rotation)
    : Number.POSITIVE_INFINITY
  if (orientationErrorRad > WRIST_ORIENTATION_TOLERANCE_RAD) {
    return {
      failure: 'joint-step',
      detail: 'detail' in strictSolved ? strictSolved.detail : undefined,
    }
  }

  // 第一次回退必须真正离开 J5≈0；离开后后续 waypoint 恢复严格姿态。
  context.escapeDone = !isNearWristSingularity(model, escapeJoints)
  if (context.escapeDone && actualFlangePose) {
    context.escapePose = {
      euler: [...actualFlangePose.euler],
      rotation: actualFlangePose.rotation.map((row) => [...row]),
    }
  }
  return { joints: escapeJoints, wristContext: context }
}

/**
 * 严格姿态单点求解：解析法优先，失败后用 DLS + 备用初值。
 * 这是原 `resolveJointSolution` 的核心逻辑，被下沉后的入口复用。
 */
function resolveJointSolutionStrict(
  targetPose: Pose,
  referenceJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  solverConfig: Partial<IKSolverConfig> = {},
  continuityLimitDeg?: number,
): JointSolutionResult {
  const analytic = resolveAnalyticJointSolution(
    targetPose,
    referenceJoints,
    model,
    jointRanges,
    solverConfig,
    continuityLimitDeg,
  )
  if (analytic !== undefined) return analytic
  // 解析法不可用（无 solveAllIK、positionOnly 或锁定关节）时自然走数值 DLS。
  const primary = solveIK(targetPose, referenceJoints, model, solverConfig, jointRanges)
  const isContinuous = (joints: JointAngles): boolean =>
    continuityLimitDeg === undefined ||
    Math.max(...joints.map((value, index) => Math.abs(value - referenceJoints[index]))) <= continuityLimitDeg

  if (primary && !isJointAtLimit(primary, jointRanges) && isContinuous(primary)) {
    return { joints: primary }
  }

  const alternatives: JointAngles[] = []
  for (const seed of buildAlternateIKSeeds(referenceJoints, jointRanges)) {
    const candidate = solveIK(targetPose, seed, model, solverConfig, jointRanges)
    if (candidate && !isJointAtLimit(candidate, jointRanges) && isContinuous(candidate)) {
      alternatives.push(candidate)
    }
  }
  if (alternatives.length === 0) {
    if (continuityLimitDeg !== undefined && primary && !isJointAtLimit(primary, jointRanges)) {
      return {
        failure: 'joint-step',
        detail: buildJointStepDetail(referenceJoints, primary, jointRanges),
      }
    }
    if (primary) {
      return {
        failure: 'joint-limit',
        detail: buildJointLimitDetail(referenceJoints, primary, jointRanges),
      }
    }
    return { failure: 'unreachable' }
  }

  let best = alternatives[0]
  let bestDistance = normalizedJointDistance(best, referenceJoints, jointRanges)
  for (let index = 1; index < alternatives.length; index += 1) {
    const candidate = alternatives[index]
    const distance = normalizedJointDistance(candidate, referenceJoints, jointRanges)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return { joints: best }
}

/**
 * 逐点把一串 TCP 位姿求解为关节 waypoint（MoveL 与 MoveC 共用）：
 * 每个 waypoint 经 `toFlange` 转成法兰位姿送 IK，以上一关节解为参考初值；
 * 并做构型跳变（相邻步长）护栏。失败时返回结构化原因，避免上层把腕部奇异、关节
 * 限位和普通数值不收敛混成同一条“不可达”消息。
 *
 * 逆解用共享的多初值策略（主初值 + 确定性构型翻转备用初值，选离参考最近的解），
 * 避免单一连续性初值在圆弧这类连续位姿上陷入狭窄收敛盆地而误判不可达。
 *
 * 腕部奇异处理已下沉到 `resolveJointSolution`；本函数只负责维护 waypoint 之间的
 * `WristSingularityContext`。严格路径优先使用全局候选图规划；机械零位腕部路径直接
 * 走局部求解，由 `resolveJointSolution` 算法决定是否启用 wrist 回退。
 */
export function solvePoseWaypoints(
  poses: readonly Pose[],
  initialJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  toFlange: (pose: Pose) => Pose,
  solverConfig: Partial<IKSolverConfig> = {},
): WaypointSolveResult {
  const waypoints: JointAngles[] = []
  let previousJoints = [...initialJoints] as JointAngles
  let appliedSingularityMode: AppliedSingularityMode | null = null
  // 机械零位专属诊断和自动 wrist 回退共用同一个路径级资格。
  // 路径开始后固定此资格，避免普通工作区仅因 J5≈0 或中途经过奇异面就误报重构。
  const isMechanicalZeroWristPath =
    model.isMechanicalZeroSingularityNeighborhood?.(initialJoints) ?? false
  // 只有机械零位腕部特例需要相邻步长护栏；普通严格路径保持原有解析分支选择，
  // 避免仅为诊断而改变非奇异工作区的运动构型。
  const continuityLimitDeg = isMechanicalZeroWristPath ? MAX_JOINT_STEP_DEG : undefined

  // 非机械零位的严格解析路径先使用全局候选图，避免逐 waypoint 最近分支把任一腕部推向
  // 等价构型；机械零位腕部路径直接走局部求解，并预创建 wristContext 供单点 IK 使用。
  if (!isMechanicalZeroWristPath && model.solveAllIK) {
    const graph = planStrictCandidateGraph(
      poses,
      initialJoints,
      model,
      jointRanges,
      toFlange,
      { solverConfig },
    )
    if (graph.ok) {
      return {
        ok: true,
        waypoints: graph.waypoints,
        appliedSingularityMode: null,
      }
    }
  }

  let wristContext: WristSingularityContext | undefined
  if (isMechanicalZeroWristPath && poses.length > 0) {
    wristContext = {
      escapeDirection: getSinglePointWristEscapeDirection(
        toFlange(poses[0]),
        initialJoints,
        model,
      ),
      escapeDone: false,
      escapePose: null,
    }
  }
  for (let waypointIndex = 0; waypointIndex < poses.length; waypointIndex += 1) {
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
        isMechanicalZeroWristPath,
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
    if (maxJointStep > MAX_JOINT_STEP_DEG) {
      const wristReconfiguration =
        isMechanicalZeroWristPath &&
        isWristReconfiguration(model, previousJoints, solved.joints)
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
