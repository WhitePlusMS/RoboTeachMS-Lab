import type { MotionPlanningRequest } from '@/robot-motion-core/index.ts'
import type { JointAngles } from '@/robotics/model/index.ts'
import { abbConfigurationFromJoints } from '@/robot-models/abb-irb1200/index.ts'
import type { RapidMotionInstruction, RapidSourceRange } from '@/rapid/language/index.ts'
import type { SingAreaMode } from '../data/index.ts'
import {
  coreConfigurationPolicy,
  coreRequest,
  coreSingularity,
  coreToolFromRapid,
  coreWorkObjectFromRapid,
  poseDataFromRobTarget,
} from './core-motion.ts'
import { validateMotionInput, type MotionPlanError } from './motion-input.ts'

export type RapidMotionPlayback = 'eased' | 'trajectory'

export type RapidMotionRequestResult =
  | {
      readonly ok: true
      readonly request: MotionPlanningRequest
      readonly playback: RapidMotionPlayback
    }
  | { readonly ok: false; readonly error: MotionPlanError }

function sourceError(message: string, sourceRange: RapidSourceRange): MotionPlanError {
  return { kind: 'invalid-data', message: `${message}（第 ${sourceRange.start.line} 行）` }
}

/** 将结构化 RAPID 运动转换为唯一 Core request；不做 IK、路径或时间计算。 */
export function buildRapidMotionRequest(
  instruction: RapidMotionInstruction,
  singArea: SingAreaMode,
  currentJoints: JointAngles,
): RapidMotionRequestResult {
  const inputError = validateMotionInput(
    instruction.target,
    instruction.speed,
    instruction.tool,
    instruction.wobj,
    instruction.zone,
  )
  if (inputError) return { ok: false, error: inputError }
  if (instruction.kind === 'movec') {
    const circleError = validateMotionInput(
      instruction.cirPoint,
      instruction.speed,
      instruction.tool,
      instruction.wobj,
      instruction.zone,
    )
    if (circleError) return { ok: false, error: circleError }
  }

  const configuration = abbConfigurationFromJoints(currentJoints)
  if (!configuration) {
    return { ok: false, error: sourceError('当前关节无法推导 ABB robconf', instruction.sourceRange) }
  }
  const currentConfiguration = {
    cf1: configuration[0],
    cf4: configuration[1],
    cf6: configuration[2],
    cfx: configuration[3],
  }
  const targetConfiguration = instruction.target.robconf.every((value) => value === 0)
    ? { kind: 'nearest-valid' as const }
    : coreConfigurationPolicy(
        instruction.target,
        instruction.kind === 'movej' ? instruction.confJ ?? 'on' : instruction.confL ?? 'on',
        currentConfiguration,
      )
  const targetPose = poseDataFromRobTarget(instruction.target)
  const common = {
    targetTcpPose: targetPose,
    tool: coreToolFromRapid(instruction.tool),
    workObject: coreWorkObjectFromRapid(instruction.wobj),
    speedMmPerSec: instruction.speed.v_tcp,
    zone: instruction.zone.finep ? ('fine' as const) : ('fly-by' as const),
    configurationPolicy: targetConfiguration,
    singularityPolicy: coreSingularity(singArea),
  }
  const intent: MotionPlanningRequest['intent'] =
    instruction.kind === 'movej'
      ? { kind: 'cartesian-target', ...common }
      : instruction.kind === 'movel'
        ? { kind: 'linear-path', ...common }
        : {
            kind: 'circular-path',
            ...common,
            viaTcpPose: poseDataFromRobTarget(instruction.cirPoint),
          }
  return {
    ok: true,
    request: coreRequest(currentJoints, intent),
    playback: instruction.kind === 'movej' ? 'eased' : 'trajectory',
  }
}
