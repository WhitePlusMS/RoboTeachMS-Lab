import { solveIK } from './ik-solver.ts'
import type { RobotModel } from './robot-model.ts'
import type { IKSolverConfig, JointAngles, Pose } from './types.ts'

/** 相邻关节步长上限（度）：连续笛卡尔路径（MoveL/MoveC）逐点求解的构型跳变护栏。 */
export const MAX_JOINT_STEP_DEG = 5

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
): { joints: JointAngles } | { failure: 'joint-limit' | 'unreachable' } {
  const primary = solveIK(targetPose, referenceJoints, model, solverConfig, jointRanges)
  if (primary && !isJointAtLimit(primary, jointRanges)) return { joints: primary }

  const alternatives: JointAngles[] = []
  for (const seed of buildAlternateIKSeeds(referenceJoints, jointRanges)) {
    const candidate = solveIK(targetPose, seed, model, solverConfig, jointRanges)
    if (candidate && !isJointAtLimit(candidate, jointRanges)) alternatives.push(candidate)
  }
  if (alternatives.length === 0) {
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
 * 并做构型跳变（相邻步长）护栏。任何一点 IK 失败或跳变越界都返回 null。
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
): JointAngles[] | null {
  const waypoints: JointAngles[] = []
  let previousJoints = [...initialJoints] as JointAngles
  for (const pose of poses) {
    const solved = resolveJointSolution(
      toFlange(pose),
      previousJoints,
      model,
      jointRanges,
      solverConfig,
    )
    if ('failure' in solved) return null
    const maxJointStep = Math.max(
      ...solved.joints.map((value, index) => Math.abs(value - previousJoints[index])),
    )
    if (maxJointStep > MAX_JOINT_STEP_DEG) return null
    waypoints.push(solved.joints)
    previousJoints = solved.joints
  }
  return waypoints
}
