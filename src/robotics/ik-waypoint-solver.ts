import { DEFAULT_IK_CONFIG, solveIK } from './ik-solver.ts'
import {
  buildIKCandidateCatalog,
  isCandidateAtJointLimit,
  JOINT_LIMIT_EPS_DEG,
  selectBestIKCandidate,
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
 * 该偏置只作为 position-only IK 的初值，不会改变普通工作区的严格姿态规划。
 */
const WRIST_ESCAPE_J5_DEG = 2
/** 局部 SingArea\Wrist 允许的最大 TCP 姿态误差；位置仍使用严格 IK 容差。 */
const WRIST_ORIENTATION_TOLERANCE_RAD = (2 * Math.PI) / 180
/** wrist 回退中的 J4 连续性正则；仅作用于机械零位的 position-only 求解。 */
const WRIST_J4_CONTINUITY_WEIGHT = 100
/** 腕部姿态策略：strict 保持完整位姿；wrist 只在受控奇异路径允许姿态误差。 */
export type CartesianOrientationMode = 'strict' | 'wrist'
export type AppliedSingularityMode = Exclude<CartesianOrientationMode, 'strict'>

/** 共享的笛卡尔路径失败原因；上层可据此给出可操作的诊断提示。 */
export type WaypointFailureReason =
  | 'wrist-singularity'
  | 'wrist-reconfiguration'
  | 'joint-limit'
  | 'joint-step'
  | 'ik-not-converged'

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

type JointSolutionResult = { joints: JointAngles } | JointSolutionFailure

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

/** 从当前关节生成一次有方向的腕部脱离初值，避免 position-only IK 继续停在 J5=0。 */
function buildWristEscapeReference(
  currentJoints: JointAngles,
  direction: -1 | 1,
  jointRanges: readonly (readonly [number, number])[],
): JointAngles {
  const reference = [...currentJoints] as JointAngles
  const [minJ5, maxJ5] = jointRanges[4]
  reference[4] = Math.max(
    minJ5,
    Math.min(maxJ5, direction * WRIST_ESCAPE_J5_DEG),
  )
  return reference
}

/** 根据首个 TCP waypoint 的位移方向选择 J5 脱离方向；纯姿态目标默认取正向。 */
function getWristEscapeDirection(
  poses: readonly Pose[],
  initialJoints: JointAngles,
  model: RobotModel,
): -1 | 1 {
  if (poses.length === 0) return 1
  const startPose = model.forwardKinematics(initialJoints)
  if (!startPose) return 1
  let dominantDelta = 0
  let dominantAxis = -1
  for (let index = 0; index < 3; index += 1) {
    const delta = poses[0].position[index] - startPose.position[index]
    if (Math.abs(delta) > Math.abs(dominantDelta)) {
      dominantDelta = delta
      dominantAxis = index
    }
  }
  // ABB 机械零位沿 Y 脱离时，Y 正负两侧都优先进入同一正 J5 腕部侧。
  // 负 Y 若按位移符号选择负 J5，后续保持 TCP 直线会被带入 J4/J6 翻腕分支；
  // 这里不是锁定 J4，而是只决定第一次脱离奇异点时的腕部拓扑，后续关节仍由
  // 严格位姿 IK 连续求解。X/Z 脱离仍保持原来的方向规则。
  if (dominantAxis === 1) return 1
  return dominantDelta < 0 ? -1 : 1
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
      : 'ik-not-converged'
  }
  return mechanicalZeroWristPath && nearWristSingularity
    ? 'wrist-singularity'
    : 'ik-not-converged'
}

/**
 * 末端拖拽操作轴的 IK 求解：以当前关节为主初值，失败后再扫备用初值；与 `resolveJointSolution`
 * 的唯一区别是**不拒绝落在关节范围边界的解**。
 *
 * gizmo 的拖拽在运动学位姿上连续、但可能在关节边界/奇异附近（尤其旋转时手腕极限），单初值
 * DLS 常在某一关节贴边时陷入窄收敛盆地而误判不可达；翻转构型初值多数能把解带回可达分支。
 * 相比 MoveJ/L/C 规划（必须拒绝贴边解以保持段间连续），末端拖拽本来就允许停在边界上，因此
 * 这里的多初值策略接受贴边解，选中所有可达候选中离当前关节最近的解，避免可直接到达的旋转
 * 被误报「末端位置不可达」而回弹。
 */
export function solveGizmoTarget(
  targetPose: Pose,
  referenceJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  solverConfig: Partial<IKSolverConfig> = {},
): JointAngles | null {
  const primary = solveIK(targetPose, referenceJoints, model, solverConfig, jointRanges)
  if (primary) return primary

  let best: JointAngles | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const seed of buildAlternateIKSeeds(referenceJoints, jointRanges)) {
    const candidate = solveIK(targetPose, seed, model, solverConfig, jointRanges)
    if (!candidate) continue
    const distance = normalizedJointDistance(candidate, referenceJoints, jointRanges)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
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
 */
export function resolveJointSolution(
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
 */
export function solvePoseWaypoints(
  poses: readonly Pose[],
  initialJoints: JointAngles,
  model: RobotModel,
  jointRanges: readonly (readonly [number, number])[],
  toFlange: (pose: Pose) => Pose,
  solverConfig: Partial<IKSolverConfig> = {},
  orientationMode: CartesianOrientationMode = 'strict',
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
  const wristFallbackAllowed =
    orientationMode === 'wrist' &&
    isMechanicalZeroWristPath

  // 所有严格解析路径先使用全局候选图，避免逐 waypoint 最近分支把任一腕部推向
  // 等价构型；图规划失败时继续走现有局部求解，以保留结构化失败诊断。
  if (orientationMode === 'strict' && model.solveAllIK) {
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
  const wristEscapeDirection = getWristEscapeDirection(poses, initialJoints, model)
  let wristEscapeDone = false
  let wristEscapePose: Pick<Pose, 'euler' | 'rotation'> | null = null
  for (let waypointIndex = 0; waypointIndex < poses.length; waypointIndex += 1) {
    const pose = poses[waypointIndex]
    // 机械零位 Wrist 的局部通行窗口沿用脱离后的姿态；窗口结束后由路径规划器
    // 恢复严格目标，避免把 SingArea\Wrist 误扩展到普通工作区。
    const effectivePose = wristEscapePose
      ? {
          ...pose,
          euler: [...wristEscapePose.euler] as Pose['euler'],
          rotation: wristEscapePose.rotation.map((row) => [...row]),
        }
      : pose
    const strictSolved = resolveJointSolution(
      toFlange(effectivePose),
      previousJoints,
      model,
      jointRanges,
      solverConfig,
      continuityLimitDeg,
    )
    let solved = strictSolved
    // SingArea\\Wrist 只在机械零位按需回退，普通工作区始终保持严格姿态。
    const wristFallbackNeeded =
      wristFallbackAllowed &&
      (('failure' in strictSolved && isNearWristSingularity(model, previousJoints)) ||
        ('joints' in strictSolved &&
          isWristReconfiguration(model, previousJoints, strictSolved.joints)))
    if (wristFallbackNeeded) {
      const wristReference =
        !wristEscapeDone
          ? buildWristEscapeReference(previousJoints, wristEscapeDirection, jointRanges)
          : previousJoints
      const wristSolved = resolveJointSolution(
        toFlange(effectivePose),
        wristReference,
        model,
        jointRanges,
        {
          ...solverConfig,
          positionOnly: true,
          // 机械零位 wrist 用 wristReference 脱离奇异点，并对 J4 增加连续性软约束，
          // 避免 position-only 求解器随机跳到另一腕部构型。
          jointContinuityReferenceDeg: previousJoints,
          jointContinuityWeights: [0, 0, 0, WRIST_J4_CONTINUITY_WEIGHT, 0, 0],
        },
        continuityLimitDeg,
      )
      if ('joints' in wristSolved) {
        const actualFlangePose = model.forwardKinematics(wristSolved.joints)
        const targetFlangePose = toFlange(effectivePose)
        const orientationErrorRad = actualFlangePose
          ? rotationDistanceRad(targetFlangePose.rotation, actualFlangePose.rotation)
          : Number.POSITIVE_INFINITY
        if (orientationErrorRad <= WRIST_ORIENTATION_TOLERANCE_RAD) {
          solved = wristSolved
          appliedSingularityMode = 'wrist'
          // 第一次回退必须真正离开 J5≈0；离开后后续 waypoint 恢复严格姿态。
          wristEscapeDone = !isNearWristSingularity(model, wristSolved.joints)
          if (wristEscapeDone && actualFlangePose) {
            wristEscapePose = {
              euler: [...actualFlangePose.euler],
              rotation: actualFlangePose.rotation.map((row) => [...row]),
            }
          }
        } else {
          solved = {
            failure: 'joint-step',
            detail: 'detail' in strictSolved ? strictSolved.detail : undefined,
          }
        }
      } else {
        solved = wristSolved
      }
    }
    if ('failure' in solved) {
      const nearWristSingularity = isNearWristSingularity(model, previousJoints)
      const mappedFailure = mapJointSolutionFailure(
        solved.failure,
        isMechanicalZeroWristPath,
        nearWristSingularity,
      )
      const detail =
        mappedFailure === 'wrist-reconfiguration' && 'joints' in strictSolved
          ? buildJointStepDetail(previousJoints, strictSolved.joints, jointRanges, [3, 5])
          : solved.detail ??
            ('joints' in strictSolved
              ? buildJointStepDetail(previousJoints, strictSolved.joints, jointRanges)
              : undefined)
      if (solved.failure === 'joint-limit') {
        return withWaypointDiagnostic('joint-limit', detail, waypointIndex)
      }
      if (solved.failure === 'joint-step') {
        return withWaypointDiagnostic(
          mappedFailure,
          detail,
          waypointIndex,
        )
      }
      return withWaypointDiagnostic(
        mappedFailure,
        detail,
        waypointIndex,
      )
    }
    const maxJointStep = Math.max(
      ...solved.joints.map((value, index) => Math.abs(value - previousJoints[index])),
    )
    if (maxJointStep > MAX_JOINT_STEP_DEG) {
      const wristReconfiguration =
        isMechanicalZeroWristPath &&
        isWristReconfiguration(model, previousJoints, solved.joints)
      return withWaypointDiagnostic(
        wristReconfiguration ? 'wrist-reconfiguration' : 'ik-not-converged',
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
