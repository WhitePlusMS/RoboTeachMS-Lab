import type { MotionResult } from '@/robotics/motion/runner.ts'
import type { RobotModel } from '@/robotics/model/robot-model.ts'
import type { SixAxisJointRanges } from '@/robotics/model/robot-profile.ts'
import type { JointAngles } from '@/robotics/model/index.ts'
import { simulateDurationMs, validateMotionInput, type MotionPlanError } from './motion-input.ts'
import type { IKSolverConfig } from '@/robotics/inverse-kinematics/types.ts'
import type { StructuredMoveJ } from '../data/index.ts'
import { planMotion } from '@/robot-motion-core/index.ts'
import { coreConfigurationPolicy, coreRequest, coreSingularity, coreToolFromRapid, coreWorkObjectFromRapid, mapCoreFailure, poseDataFromRobTarget } from './core-motion.ts'
import { abbConfigurationFromJoints } from '@/robot-models/abb-irb1200/index.ts'

export type MoveJPlanResult =
  { ok: true; joints: JointAngles; durationMs: number } | { ok: false; error: MotionPlanError }

/** MoveJ 执行注入的运动执行 seam；规划层不自行操作 RAF 或插值关节。 */
export interface MoveJExecutionSeam {
  model: RobotModel
  currentJoints: () => JointAngles
  jointRanges: SixAxisJointRanges
  runEased: (joints: JointAngles, durationMs: number) => Promise<MotionResult>
}

export type MoveJOutcome =
  { ok: true; result: MotionResult } | { ok: false; error: MotionPlanError }

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
  _jointRanges: SixAxisJointRanges,
  _solverConfig: Partial<IKSolverConfig> = {},
): MoveJPlanResult {
  const dataConfigError = validateMotionInput(
    movej.target,
    movej.speed,
    movej.tool,
    movej.wobj,
    movej.zone,
  )
  if (dataConfigError) return { ok: false, error: dataConfigError }

  const currentConfigurationTuple = abbConfigurationFromJoints(currentJoints)
  if (!currentConfigurationTuple) return { ok: false, error: { kind: 'unreachable', message: '当前关节无法推导 ABB robconf' } }
  const currentConfiguration = { cf1: currentConfigurationTuple[0], cf4: currentConfigurationTuple[1], cf6: currentConfigurationTuple[2], cfx: currentConfigurationTuple[3] }
  const request = coreRequest(currentJoints, {
    kind: 'cartesian-target',
    targetTcpPose: poseDataFromRobTarget(movej.target),
    tool: coreToolFromRapid(movej.tool),
    workObject: coreWorkObjectFromRapid(movej.wobj),
    configurationPolicy: movej.target.robconf.every((value) => value === 0)
      ? (movej.confJ === 'off' ? { kind: 'current-main', currentMain: currentConfiguration } : { kind: 'nearest-valid' })
      : coreConfigurationPolicy(movej.target, movej.confJ ?? 'on', currentConfiguration),
    singularityPolicy: coreSingularity('off'),
  })
  const planned = planMotion(request)
  if (!planned.ok) {
    const mapped = mapCoreFailure(planned)
    if (!mapped) return { ok: false, error: { kind: 'unreachable', message: 'Core MoveJ 规划失败' } }
    if (mapped.kind === 'joint-limit' && Math.max(...movej.target.trans.map((value) => Math.abs(value))) > 2000) {
      return { ok: false, error: { kind: 'unreachable', message: '目标位姿超出机器人工作空间' } }
    }
    if (mapped.kind === 'joint-step') return { ok: false, error: { kind: 'unreachable', message: '目标构型与当前关节表示不可到达' } }
    return { ok: false, error: mapped }
  }

  // 仿真时长近似：TCP 距离 / v_tcp，转毫秒并保证正的有限值。
  const durationMs = simulateDurationMs(model, currentJoints, movej.target.trans, movej.speed.v_tcp)
  if (durationMs === null) {
    return { ok: false, error: { kind: 'unreachable', message: '机器人模型不可用或正解失败' } }
  }
  return { ok: true, joints: [...planned.end.jointsDeg] as JointAngles, durationMs }
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
