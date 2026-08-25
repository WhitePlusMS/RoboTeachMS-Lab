import type { MotionResult } from '@/robotics/motion/runner.ts'
import type { RobotModel } from '@/robotics/model/robot-model.ts'
import type { SixAxisJointRanges } from '@/robotics/model/robot-profile.ts'
import type { JointAngles } from '@/robotics/model/types.ts'
import { simulateDurationMs, validateMotionInput, type MotionPlanError } from './plan-shared.ts'
import { resolveJointSolution, type IKSolverConfig } from '@/robotics/inverse-kinematics/index.ts'
import { robTargetToFlangePose } from './coordinate-transform.ts'
import type { StructuredMoveJ } from './rapid-types.ts'

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
  jointRanges: SixAxisJointRanges,
  solverConfig: Partial<IKSolverConfig> = {},
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
  const solution = resolveJointSolution(targetPose, currentJoints, model, jointRanges, solverConfig)
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
