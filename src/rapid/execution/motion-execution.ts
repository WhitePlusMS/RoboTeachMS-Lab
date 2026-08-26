import type { MotionResult } from '@/robotics/motion/runner.ts'
import type { MotionPlanningResultOk } from '@/robot-motion-core/index.ts'
import type { RobotModel } from '@/robotics/model/robot-model.ts'
import type { SixAxisJointRanges } from '@/robotics/model/robot-profile.ts'
import type { JointAngles } from '@/robotics/model/index.ts'
import { executeMoveJ } from '../planning/movej-planner.ts'
import { executeMoveL } from '../planning/movel-planner.ts'
import { executeMoveC } from '../planning/movec-planner.ts'
import type { InstructionOutcome } from './program-executor.ts'
import type { RapidMotionInstruction } from '../language/index.ts'
import type { SingAreaMode } from '../data/index.ts'

/** RAPID 运动执行所需的唯一外部 seam；J/L/C 共用同一组运行时依赖。 */
export interface RapidMotionExecutionContext {
  model: RobotModel
  currentJoints: () => JointAngles
  jointRanges: SixAxisJointRanges
  runEased: (target: JointAngles, durationMs: number) => Promise<MotionResult>
  runTrajectory: (
    waypoints: readonly JointAngles[],
    durationMs: number,
    corePlan?: MotionPlanningResultOk,
  ) => Promise<MotionResult>
}

/**
 * 统一结构化 RAPID 运动分派：规划错误和 MotionRunner 结果原样返回，
 * ProgramController 不再重复声明三套执行 seam。
 */
export async function executeRapidMotion(
  instruction: RapidMotionInstruction,
  singArea: SingAreaMode,
  context: RapidMotionExecutionContext,
): Promise<InstructionOutcome> {
  if (instruction.kind === 'movej') {
    return executeMoveJ(instruction, {
      model: context.model,
      currentJoints: context.currentJoints,
      jointRanges: context.jointRanges,
      runEased: context.runEased,
    })
  }
  if (instruction.kind === 'movel') {
    return executeMoveL({ ...instruction, singArea }, {
      model: context.model,
      currentJoints: context.currentJoints,
      jointRanges: context.jointRanges,
      runTrajectory: context.runTrajectory,
    })
  }
  return executeMoveC({ ...instruction, singArea }, {
    model: context.model,
    currentJoints: context.currentJoints,
    jointRanges: context.jointRanges,
    runTrajectory: context.runTrajectory,
  })
}
