import type {
  JointVector6,
  PoseData,
  RigidFrameData,
  ABBConfigurationData,
  MotionIntent,
  MotionPlanningRequest,
  MotionPlanningResultError,
} from './contracts.ts'

/** 核心请求校验；在任何 FK/IK 计算前拒绝非法数据。 */

function invalidRequest(field: string, reason: string): MotionPlanningResultError {
  return {
    ok: false,
    error: { code: 'invalid-request', category: 'invalid-request', details: { field, reason } },
  }
}

function isSixFinite(values: unknown): values is JointVector6 {
  return (
    Array.isArray(values) &&
    values.length === 6 &&
    values.every((value) => typeof value === 'number' && Number.isFinite(value))
  )
}

function isPoseData(value: unknown): value is PoseData {
  if (!value || typeof value !== 'object') return false
  const pose = value as { positionMm?: unknown; quaternionWxyz?: unknown }
  if (!Array.isArray(pose.positionMm) || !Array.isArray(pose.quaternionWxyz)) return false
  return (
    pose.positionMm.length === 3 &&
    pose.quaternionWxyz.length === 4 &&
    [...pose.positionMm, ...pose.quaternionWxyz].every(
      (item) => typeof item === 'number' && Number.isFinite(item),
    ) &&
    Math.hypot(...(pose.quaternionWxyz as number[])) > 0
  )
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function isConfigurationData(value: unknown): value is ABBConfigurationData {
  if (!value || typeof value !== 'object') return false
  const configuration = value as Partial<ABBConfigurationData>
  return [configuration.cf1, configuration.cf4, configuration.cf6, configuration.cfx].every(
    (item) => typeof item === 'number' && Number.isFinite(item),
  )
}

function validateFrame(
  frame: RigidFrameData | undefined,
  field: string,
): MotionPlanningResultError | null {
  return isPoseData(frame) ? null : invalidRequest(field, 'expected-finite-rigid-frame')
}

function validateIntent(intent: MotionIntent): MotionPlanningResultError | null {
  if (!intent || typeof intent.kind !== 'string')
    return invalidRequest('intent', 'expected-discriminated-intent')
  if (intent.kind === 'joint-target')
    return isSixFinite(intent.targetJointsDeg)
      ? null
      : invalidRequest('intent.targetJointsDeg', 'expected-six-finite-numbers')
  if (
    intent.kind !== 'pose-joint-target' &&
    intent.kind !== 'linear-path' &&
    intent.kind !== 'circular-path'
  )
    return invalidRequest('intent.kind', 'unsupported-intent')
  if (!isPoseData(intent.targetTcpPose))
    return invalidRequest('intent.targetTcpPose', 'expected-finite-pose')
  if (intent.kind === 'circular-path' && !isPoseData(intent.viaTcpPose))
    return invalidRequest('intent.viaTcpPose', 'expected-finite-pose')
  if (
    (intent.kind === 'linear-path' || intent.kind === 'circular-path') &&
    !isFinitePositive(intent.speedMmPerSec)
  )
    return invalidRequest('intent.speedMmPerSec', 'expected-positive-finite-number')
  if (!['strict', 'wrist-interpolation'].includes(intent.singularityPolicy))
    return invalidRequest('intent.singularityPolicy', 'unsupported-policy')
  if (intent.speedOriDegPerSec !== undefined && !isFinitePositive(intent.speedOriDegPerSec))
    return invalidRequest('intent.speedOriDegPerSec', 'expected-positive-finite-number')
  if (intent.zone !== 'fine')
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        category: 'unsupported-capability',
        details: { zone: intent.zone },
      },
    }
  if (
    intent.kind === 'pose-joint-target' &&
    intent.speedMmPerSec !== undefined &&
    !isFinitePositive(intent.speedMmPerSec)
  )
    return invalidRequest('intent.speedMmPerSec', 'expected-positive-finite-number')
  if (!intent.tool || !intent.workObject)
    return invalidRequest('intent.tool/workObject', 'required-for-cartesian-intent')
  if (!intent.configurationPolicy || typeof intent.configurationPolicy.kind !== 'string')
    return invalidRequest('intent.configurationPolicy', 'expected-policy')
  if (!['nearest-valid', 'current-main', 'required'].includes(intent.configurationPolicy.kind))
    return invalidRequest('intent.configurationPolicy.kind', 'unsupported-policy')
  if (intent.tool.robhold !== true)
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        category: 'unsupported-capability',
        details: { field: 'intent.tool.robhold' },
      },
    }
  if (
    intent.workObject.robhold !== false ||
    intent.workObject.ufprog !== true ||
    intent.workObject.ufmec !== ''
  )
    return {
      ok: false,
      error: {
        code: 'unsupported-capability',
        category: 'unsupported-capability',
        details: { field: 'intent.workObject' },
      },
    }
  if (
    intent.configurationPolicy.kind === 'required' &&
    !isConfigurationData(intent.configurationPolicy.target)
  )
    return invalidRequest('intent.configurationPolicy.target', 'expected-finite-configuration')
  if (
    intent.configurationPolicy.kind === 'current-main' &&
    !isConfigurationData(intent.configurationPolicy.currentMain)
  )
    return invalidRequest('intent.configurationPolicy.currentMain', 'expected-finite-configuration')
  const toolError = validateFrame(intent.tool.tcpInFlange, 'intent.tool.tcpInFlange')
  if (toolError) return toolError
  const userError = validateFrame(intent.workObject.userFrame, 'intent.workObject.userFrame')
  if (userError) return userError
  return validateFrame(intent.workObject.objectFrame, 'intent.workObject.objectFrame')
}

export function validateRequest(request: MotionPlanningRequest): MotionPlanningResultError | null {
  if (!request || typeof request !== 'object') return invalidRequest('request', 'expected-object')
  if (request.schemaVersion !== 1) return invalidRequest('schemaVersion', 'unsupported-version')
  if (
    !request.robot ||
    typeof request.robot.modelId !== 'string' ||
    request.robot.modelId.length === 0
  )
    return invalidRequest('robot.modelId', 'expected-non-empty-string')
  if (typeof request.robot.modelRevision !== 'string' || request.robot.modelRevision.length === 0)
    return invalidRequest('robot.modelRevision', 'expected-non-empty-string')
  if (!request.state || !isSixFinite(request.state.jointsDeg))
    return invalidRequest('state.jointsDeg', 'expected-six-finite-numbers')
  return validateIntent(request.intent)
}
