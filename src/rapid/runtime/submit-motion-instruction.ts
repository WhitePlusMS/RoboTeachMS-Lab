import type { RobotProfile } from '@/robot-geometry/robot-types.ts'
import type { JointAngles } from '@/robot-geometry/robot-types.ts'
import type { MotionPlanningRequest } from '@/robot-motion-core/index.ts'
import type { InstructionOutcome } from './program-executor.ts'
import type { RapidMotionInstruction } from '../language/index.ts'
import type { SingAreaMode } from '../data/index.ts'
import { buildRapidMotionRequest } from '../motion/rapid-motion-request.ts'

/** RAPID 运动提交 seam；规划和播放都由宿主 MotionCoordinator 完成。 */
export interface RapidMotionExecutionContext {
  profile: RobotProfile
  currentJoints: () => JointAngles
  submit: (
    request: MotionPlanningRequest,
    playback: 'eased' | 'trajectory',
  ) => Promise<InstructionOutcome>
}

/**
 * 统一结构化 RAPID 运动分派：规划错误和 MotionRunner 结果原样返回，
 * ProgramSession 不再重复声明三套执行 seam。
 */
export async function submitMotionInstruction(
  instruction: RapidMotionInstruction,
  singArea: SingAreaMode,
  context: RapidMotionExecutionContext,
): Promise<InstructionOutcome> {
  const planned = buildRapidMotionRequest(
    instruction,
    singArea,
    context.currentJoints(),
    context.profile,
  )
  if (!planned.ok) return { ok: false, error: planned.error }
  return context.submit(planned.request, planned.playback)
}
