import { solveIK } from '../robotics/ik-solver.ts'
import type { MotionResult } from '../robotics/motion-runner.ts'
import type { RobotModel } from '../robotics/robot-model.ts'
import type { SixAxisJointRanges } from '../robotics/robot-profile.ts'
import type { JointAngles, Pose } from '../robotics/types.ts'
import {
  isJointAtLimit,
  simulateDurationMs,
  validateMotionInput,
  type MotionPlanError,
} from './plan-shared.ts'
import { robTargetToFlangePose } from './coordinate-transform.ts'
import type { StructuredMoveJ } from './rapid-types.ts'

export type MoveJPlanResult =
  | { ok: true; joints: JointAngles; durationMs: number }
  | { ok: false; error: MotionPlanError }

/** MoveJ 执行注入的运动执行 seam；规划层不自行操作 RAF 或插值关节。 */
export interface MoveJExecutionSeam {
  model: RobotModel
  currentJoints: () => JointAngles
  jointRanges: SixAxisJointRanges
  runEased: (joints: JointAngles, durationMs: number) => Promise<MotionResult>
}

export type MoveJOutcome =
  | { ok: true; result: MotionResult }
  | { ok: false; error: MotionPlanError }

/**
 * 生成有限、确定性、受关节范围约束的备用 IK 初值：由当前关节姿态派生各构型翻转
 * （腕部翻转、J1 肩部镜像、肩肘翻转），钳位到关节范围并去重。数量有固定上限，
 * 不做随机搜索或无界循环，且不含当前初值本身。
 *
 * 经验上数值 IK 的收敛盆地很窄，大幅 J1 回放时当前初值常落入错误分支；将当前
 * 姿态按物理构型翻转得到的初值能落在正确解的盆地内。
 */
function buildAlternateIKSeeds(
  currentJoints: JointAngles,
  jointRanges: SixAxisJointRanges,
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
    [currentJoints[0], currentJoints[1], currentJoints[2], currentJoints[3] + 180, -currentJoints[4], currentJoints[5] + 180],
    // J1 肩部镜像（+180 回绕）。
    [wrap(currentJoints[0] + 180), currentJoints[1], currentJoints[2], currentJoints[3], currentJoints[4], currentJoints[5]],
    // J1 肩部镜像（-180 回绕）。
    [wrap(currentJoints[0] - 180), currentJoints[1], currentJoints[2], currentJoints[3], currentJoints[4], currentJoints[5]],
    // J1 镜像 + 腕部翻转。
    [wrap(currentJoints[0] + 180), currentJoints[1], currentJoints[2], currentJoints[3] + 180, -currentJoints[4], currentJoints[5] + 180],
    // 肩肘翻转（J2/J3 取负）。
    [currentJoints[0], -currentJoints[1], -currentJoints[2], currentJoints[3], currentJoints[4], currentJoints[5]],
    // 肩肘翻转 + 腕部翻转。
    [currentJoints[0], -currentJoints[1], -currentJoints[2], currentJoints[3] + 180, -currentJoints[4], currentJoints[5] + 180],
  ]
    .map(clamp)
    // 去重：初始 seed 与当前初值重复、或翻转后互相重复的丢弃。
    .filter((seed, index, all) => {
      if (seed.every((value, i) => value === currentJoints[i])) return false
      return all.findIndex((other) => other.every((value, i) => value === seed[i])) === index
    })
  return raw
}

/**
 * 按各轴关节范围归一化后的距离，用于在多个候选解中选出离当前姿态最近的解。
 * 各轴单独按关节跨度归一化，避免大跨度轴（如 J6）主导距离。
 */
function normalizedJointDistance(
  a: JointAngles,
  b: JointAngles,
  jointRanges: SixAxisJointRanges,
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
 * 校验并规划单条结构化 MoveJ：复用现有 IK 与 ABB RobotModel 生成关节目标。
 * 纯函数，不操作 RAF 或关节；规划错误不会启动任何请求帧，也不会改变机器人关节。
 *
 * IK 默认以当前关节姿态为初值；只有当前初值失败后才尝试有限、确定性的备用初值，
 * 并在多个成功解中选择离当前姿态最近的解（大幅 J1 回放因此可靠）。
 *
 * 时长使用明确的仿真近似：TCP 起点到目标 TCP 距离 / v_tcp，再换算为毫秒。
 * 这不是对 ABB 控制器真实关节速度规划的复现。
 */
export function planMoveJ(
  movej: StructuredMoveJ,
  model: RobotModel,
  currentJoints: JointAngles,
  jointRanges: SixAxisJointRanges,
): MoveJPlanResult {
  const dataConfigError = validateMotionInput(
    movej.target,
    movej.speed,
    movej.tool,
    movej.wobj,
    movej.zone,
  )
  if (dataConfigError) return { ok: false, error: dataConfigError }

  // 目标法兰位姿：robtarget(Obj) → uframe·oframe → 逆(tool.tframe) → 法兰；IK 以法蓝为目标。
  const targetPose = robTargetToFlangePose(movej.target, movej.wobj, movej.tool)
  const solution = resolveJointSolution(targetPose, currentJoints, model, jointRanges)
  if ('failure' in solution) {
    const error: MotionPlanError =
      solution.failure === 'joint-limit'
        ? {
            kind: 'joint-limit',
            message: `目标关节解接近关节范围边界 [${jointRanges.map(([min, max]) => `${min}~${max}`).join(', ')}]`,
          }
        : { kind: 'unreachable', message: '目标姿态不可达或逆解未收敛' }
    return { ok: false, error }
  }

  // 仿真时长近似：TCP 距离 / v_tcp，转毫秒并保证正的有限值。
  const durationMs = simulateDurationMs(model, currentJoints, movej.target.trans, movej.speed.v_tcp)
  if (durationMs === null) {
    return { ok: false, error: { kind: 'unreachable', message: '机器人模型不可用或正解失败' } }
  }
  return { ok: true, joints: solution.joints, durationMs }
}

/**
 * 求解一个到达 targetPose 的关节解：
 * 先以当前关节姿态为主初值，成功且不夹边则立即返回（贴近目标时不执行多余候选搜索）；
 * 主初值无效后才扫描有限、确定性的备用初值，在多个候选中选择离当前姿态最近的解。
 * 返回成功解，或带失败原因的标记（主初值夹边 vs 真正不可达），避免调用方重复逆解。
 */
function resolveJointSolution(
  targetPose: Pose,
  currentJoints: JointAngles,
  model: RobotModel,
  jointRanges: SixAxisJointRanges,
): { joints: JointAngles } | { failure: 'joint-limit' | 'unreachable' } {
  const primary = solveIK(targetPose, currentJoints, model, {}, jointRanges)
  if (primary && !isJointAtLimit(primary, jointRanges)) return { joints: primary }

  // 主初值无效（不可达或夹边）后，才扫描确定性备用初值；过滤掉夹臂的解。
  const alternatives: JointAngles[] = []
  for (const seed of buildAlternateIKSeeds(currentJoints, jointRanges)) {
    const candidate = solveIK(targetPose, seed, model, {}, jointRanges)
    if (candidate && !isJointAtLimit(candidate, jointRanges)) alternatives.push(candidate)
  }
  if (alternatives.length === 0) {
    // 主初值到达物理极限而备用无有效解 → 保持 joint-limit 语义；否则不可达。
    return { failure: primary ? 'joint-limit' : 'unreachable' }
  }

  // 多个候选成功时，选择离当前姿态最近、且按首见顺序稳定的解。
  let best = alternatives[0]
  let bestDistance = normalizedJointDistance(best, currentJoints, jointRanges)
  for (let index = 1; index < alternatives.length; index += 1) {
    const candidate = alternatives[index]
    const distance = normalizedJointDistance(candidate, currentJoints, jointRanges)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return { joints: best }
}


/**
 * 规划成功后只通过注入的缓动入口提交关节目标，并把 MotionRunner 的
 * completed/stopped 结果原样返回给调用者；规划错误不触发任何运动。
 */
export async function executeMoveJ(
  movej: StructuredMoveJ,
  seam: MoveJExecutionSeam,
): Promise<MoveJOutcome> {
  const plan = planMoveJ(movej, seam.model, seam.currentJoints(), seam.jointRanges)
  if (!plan.ok) return { ok: false, error: plan.error }
  const result = await seam.runEased(plan.joints, plan.durationMs)
  return { ok: true, result }
}
