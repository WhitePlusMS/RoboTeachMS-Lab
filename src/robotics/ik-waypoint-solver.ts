import { solveIK } from './ik-solver.ts'
import type { RobotModel } from './robot-model.ts'
import type { IKSolverConfig, JointAngles, Pose } from './types.ts'

/** 相邻关节步长上限（度）：连续笛卡尔路径（MoveL/MoveC）逐点求解的构型跳变护栏。 */
export const MAX_JOINT_STEP_DEG = 5

/**
 * 机械零位第一次脱离腕部奇异时的 J5 目标偏置（度）。
 * 该偏置只作为 position-only IK 的初值，不会改变普通工作区的严格姿态规划。
 */
const WRIST_ESCAPE_J5_DEG = 5

/** 腕部姿态策略：strict 保持完整位姿，wrist 仅在腕部奇异邻域允许姿态误差。 */
export type CartesianOrientationMode = 'strict' | 'wrist'

/** 共享的笛卡尔路径失败原因；上层可据此给出可操作的诊断提示。 */
export type WaypointFailureReason =
  | 'wrist-singularity'
  | 'wrist-reconfiguration'
  | 'joint-limit'
  | 'joint-step'
  | 'ik-not-converged'

export type WaypointSolveResult =
  | { ok: true; waypoints: JointAngles[]; usedWristFallback: boolean }
  | { ok: false; failure: WaypointFailureReason }

/** 判定 IK 解是否被夹在关节范围边界（度）；该启发用于区分 joint-limit。 */
const JOINT_LIMIT_EPS_DEG = 0.5

/** IK 解是否被夹在任一关节范围边界（启发式，用于判别 joint-limit）。 */
export function isJointAtLimit(
  joints: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
): boolean {
  return joints.some((value, index) => {
    const [min, max] = jointRanges[index]
    return value <= min + JOINT_LIMIT_EPS_DEG || value >= max - JOINT_LIMIT_EPS_DEG
  })
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
  for (let index = 0; index < 3; index += 1) {
    const delta = poses[0].position[index] - startPose.position[index]
    if (Math.abs(delta) > Math.abs(dominantDelta)) dominantDelta = delta
  }
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
): { joints: JointAngles } | { failure: 'joint-limit' | 'unreachable' | 'joint-step' } {
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
      return { failure: 'joint-step' }
    }
    return { failure: primary ? 'joint-limit' : 'unreachable' }
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
  let usedWristFallback = false
  // 机械零位专属诊断和自动 wrist 回退共用同一个路径级资格。
  // 路径开始后固定此资格，避免普通工作区仅因 J5≈0 或中途经过奇异面就误报重构。
  const isMechanicalZeroWristPath =
    model.isMechanicalZeroSingularityNeighborhood?.(initialJoints) ?? false
  // 只有机械零位专用路径才把相邻步长纳入候选筛选；普通工作姿态保持旧版
  // “主解优先、失败后再扫备用初值”的行为，避免新策略改变既有运动构型。
  const continuityLimitDeg = isMechanicalZeroWristPath ? MAX_JOINT_STEP_DEG : undefined
  const wristFallbackAllowed =
    orientationMode === 'wrist' &&
    isMechanicalZeroWristPath
  const wristEscapeDirection = getWristEscapeDirection(poses, initialJoints, model)
  let wristEscapeDone = false
  let wristEscapePose: Pick<Pose, 'euler' | 'rotation'> | null = null
  for (const pose of poses) {
    // 脱离奇异点后，沿用脱离后的实际腕部姿态作为本次局部路径的姿态目标。
    // 这对应 ABB“奇异点另一侧第一个目标修改姿态”的规则，避免下一 waypoint
    // 继续要求原姿态而再次触发 J4/J6 的大幅重分配。
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
    // SingArea\\Wrist 的语义是“先保持姿态，只有腕部无法连续分配时才允许误差”，
    // 不能把所有普通平移都降级成位置-only IK。
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
        { ...solverConfig, positionOnly: true },
      )
      if ('joints' in wristSolved) {
        usedWristFallback = true
        // 第一次回退必须真正离开 J5≈0；离开后后续 waypoint 恢复严格姿态。
        wristEscapeDone = !isNearWristSingularity(model, wristSolved.joints)
        if (wristEscapeDone) {
          const escapedPose = model.forwardKinematics(wristSolved.joints)
          if (escapedPose) {
            wristEscapePose = {
              euler: [...escapedPose.euler],
              rotation: escapedPose.rotation.map((row) => [...row]),
            }
          }
        }
      }
      solved = wristSolved
    }
    if ('failure' in solved) {
      if (solved.failure === 'joint-limit') {
        return { ok: false, failure: 'joint-limit' }
      }
      if (solved.failure === 'joint-step') {
        return {
          ok: false,
          failure:
            isMechanicalZeroWristPath && isNearWristSingularity(model, previousJoints)
              ? 'wrist-reconfiguration'
              : 'ik-not-converged',
        }
      }
      return {
        ok: false,
        failure: isMechanicalZeroWristPath && isNearWristSingularity(model, previousJoints)
          ? 'wrist-singularity'
          : 'ik-not-converged',
      }
    }
    const maxJointStep = Math.max(
      ...solved.joints.map((value, index) => Math.abs(value - previousJoints[index])),
    )
    if (maxJointStep > MAX_JOINT_STEP_DEG) {
      return {
        ok: false,
        failure:
          isMechanicalZeroWristPath &&
          isWristReconfiguration(model, previousJoints, solved.joints)
          ? 'wrist-reconfiguration'
          : 'ik-not-converged',
      }
    }
    waypoints.push(solved.joints)
    previousJoints = solved.joints
  }
  return { ok: true, waypoints, usedWristFallback }
}
