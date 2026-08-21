import type { MotionResult } from '@/robotics/motion-runner.ts'
import type { RobotModel } from '@/robotics/robot-model.ts'
import type { SixAxisJointRanges } from '@/robotics/robot-profile.ts'
import type { JointAngles } from '@/robotics/types.ts'
import { executeMoveJ } from './movej-planner.ts'
import { executeMoveL } from './movel-planner.ts'
import { executeMoveC } from './movec-planner.ts'
import type { InstructionOutcome } from './program-executor.ts'
import type { RapidMotionInstruction } from './rapid-parser.ts'
import type { SingAreaMode } from './rapid-types.ts'

/** RAPID 运动执行所需的唯一外部 seam；J/L/C 共用同一组运行时依赖。 */
export interface RapidMotionExecutionContext {
  model: RobotModel
  currentJoints: () => JointAngles
  jointRanges: SixAxisJointRanges
  runEased: (target: JointAngles, durationMs: number) => Promise<MotionResult>
  runTrajectory: (
    waypoints: readonly JointAngles[],
    durationMs: number,
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
