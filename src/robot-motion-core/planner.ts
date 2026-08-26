import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/index.ts'
import { planCartesianPath } from '@/robotics/cartesian/path-planner.ts'
import { solvePoseWaypoints } from '@/robotics/cartesian/solution/waypoint-solver.ts'
import { sampleArcPoses } from './arc-geometry.ts'
import type { JointAngles, Pose } from '@/robotics/model/index.ts'
import { quaternionToRotationMatrix, rotationDistanceRad, rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'

export const ABB_IRB1200_MODEL_REVISION = 'dh-standard-v1'
export type JointVector6 = readonly [number, number, number, number, number, number]
export type PositionMm = readonly [number, number, number]
export type QuaternionWxyz = readonly [number, number, number, number]

export interface PoseData { readonly positionMm: PositionMm; readonly quaternionWxyz: QuaternionWxyz }
export type RigidFrameData = PoseData
export interface ToolData { readonly robhold: true; readonly tcpInFlange: RigidFrameData }
export interface WorkObjectData {
  readonly robhold: false
  readonly userFrame: RigidFrameData
  readonly objectFrame: RigidFrameData
  readonly ufprog: true
  readonly ufmec: ''
}
export interface ABBConfigurationData { readonly cf1: number; readonly cf4: number; readonly cf6: number; readonly cfx: number }
export type ConfigurationPolicy =
  | { readonly kind: 'nearest-valid' }
  | { readonly kind: 'current-main'; readonly currentMain: ABBConfigurationData }
  | { readonly kind: 'required'; readonly target: ABBConfigurationData }
export type SingularityPolicy = 'strict' | 'wrist-interpolation'
export interface JointTargetIntent { readonly kind: 'joint-target'; readonly targetJointsDeg: JointVector6 }
export interface CartesianTargetIntent {
  readonly kind: 'cartesian-target'; readonly targetTcpPose: PoseData; readonly tool: ToolData; readonly workObject: WorkObjectData
  readonly configurationPolicy: ConfigurationPolicy; readonly singularityPolicy: SingularityPolicy
}
export interface LinearPathIntent {
  readonly kind: 'linear-path'; readonly targetTcpPose: PoseData; readonly tool: ToolData; readonly workObject: WorkObjectData
  readonly speedMmPerSec: number; readonly zone: 'fine' | 'fly-by'; readonly configurationPolicy: ConfigurationPolicy; readonly singularityPolicy: SingularityPolicy
}
export interface CircularPathIntent {
  readonly kind: 'circular-path'; readonly viaTcpPose: PoseData; readonly targetTcpPose: PoseData; readonly tool: ToolData; readonly workObject: WorkObjectData
  readonly speedMmPerSec: number; readonly zone: 'fine' | 'fly-by'; readonly configurationPolicy: ConfigurationPolicy; readonly singularityPolicy: SingularityPolicy
}
export interface DegenerateIkIntent {
  readonly kind: 'degenerate-ik'; readonly targetTcpPose: PoseData; readonly constraint: 'position-priority' | 'locked-joints' | 'numerical-only'; readonly lockedJointsDeg?: JointVector6
}
export type MotionIntent = JointTargetIntent | CartesianTargetIntent | LinearPathIntent | CircularPathIntent | DegenerateIkIntent
export interface MotionPlanningRequest {
  readonly schemaVersion: 1
  readonly robot: { readonly modelId: string; readonly modelRevision: string }
  readonly state: { readonly jointsDeg: JointVector6 }
  readonly intent: MotionIntent
}
export type MotionErrorCategory = 'invalid-request' | 'unsupported-model' | 'planning-failure' | 'unsupported-capability'
export type MotionErrorCode = 'invalid-request' | 'unsupported-model' | 'unsupported-capability' | 'unreachable' | 'configuration-unreachable' | 'wrist-singularity' | 'joint-limit' | 'path-discontinuity'
export interface MotionError { readonly code: MotionErrorCode; readonly category: MotionErrorCategory; readonly details: Readonly<Record<string, string | number | boolean | null>> }
export interface MotionPlanWaypoint { readonly timeMs: number; readonly jointsDeg: JointVector6 }
export interface MotionPlanningResultOk {
  readonly ok: true; readonly waypoints: readonly MotionPlanWaypoint[]
  readonly end: { readonly jointsDeg: JointVector6; readonly configuration?: ABBConfigurationData }
  readonly validation: { readonly tcpResidualMm?: number; readonly orientationResidualDeg?: number; readonly relaxedConstraints?: readonly string[] }
}
export interface MotionPlanningResultError { readonly ok: false; readonly error: MotionError }
export type MotionPlanningResult = MotionPlanningResultOk | MotionPlanningResultError

function invalidRequest(field: string, reason: string): MotionPlanningResultError {
  return { ok: false, error: { code: 'invalid-request', category: 'invalid-request', details: { field, reason } } }
}
function isSixFinite(values: readonly number[]): values is JointVector6 { return values.length === 6 && values.every((value) => Number.isFinite(value)) }
function isPoseData(value: PoseData | undefined): value is PoseData {
  return Boolean(value && value.positionMm.length === 3 && value.quaternionWxyz.length === 4 && [...value.positionMm, ...value.quaternionWxyz].every(Number.isFinite) && Math.hypot(...value.quaternionWxyz) > 0)
}
function isFinitePositive(value: number): boolean { return Number.isFinite(value) && value > 0 }
function toPose(data: PoseData): Pose {
  const raw = [data.quaternionWxyz[1], data.quaternionWxyz[2], data.quaternionWxyz[3], data.quaternionWxyz[0]] as [number, number, number, number]
  const length = Math.hypot(...raw)
  const rotation = quaternionToRotationMatrix(raw.map((value) => value / length) as [number, number, number, number])
  return { position: [...data.positionMm] as Pose['position'], euler: [0, 0, 0], rotation }
}

type RigidMatrix = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
]

function frameMatrix(frame: RigidFrameData): RigidMatrix {
  const pose = toPose(frame)
  return [
    [pose.rotation[0][0], pose.rotation[0][1], pose.rotation[0][2], pose.position[0]],
    [pose.rotation[1][0], pose.rotation[1][1], pose.rotation[1][2], pose.position[1]],
    [pose.rotation[2][0], pose.rotation[2][1], pose.rotation[2][2], pose.position[2]],
    [0, 0, 0, 1],
  ]
}

function multiplyRigid(left: RigidMatrix, right: RigidMatrix): RigidMatrix {
  return Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) =>
      left[row][0] * right[0][column] +
      left[row][1] * right[1][column] +
      left[row][2] * right[2][column] +
      left[row][3] * right[3][column],
    ),
  ) as unknown as RigidMatrix
}

function inverseRigid(matrix: RigidMatrix): RigidMatrix {
  const rotation = [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ]
  const translation = [matrix[0][3], matrix[1][3], matrix[2][3]]
  const inverseTranslation = [
    -(rotation[0][0] * translation[0] + rotation[1][0] * translation[1] + rotation[2][0] * translation[2]),
    -(rotation[0][1] * translation[0] + rotation[1][1] * translation[1] + rotation[2][1] * translation[2]),
    -(rotation[0][2] * translation[0] + rotation[1][2] * translation[1] + rotation[2][2] * translation[2]),
  ]
  return [
    [rotation[0][0], rotation[1][0], rotation[2][0], inverseTranslation[0]],
    [rotation[0][1], rotation[1][1], rotation[2][1], inverseTranslation[1]],
    [rotation[0][2], rotation[1][2], rotation[2][2], inverseTranslation[2]],
    [0, 0, 0, 1],
  ]
}

function poseFromMatrix(matrix: RigidMatrix): Pose {
  return {
    position: [matrix[0][3], matrix[1][3], matrix[2][3]],
    euler: [0, 0, 0],
    rotation: [
      [matrix[0][0], matrix[0][1], matrix[0][2]],
      [matrix[1][0], matrix[1][1], matrix[1][2]],
      [matrix[2][0], matrix[2][1], matrix[2][2]],
    ],
  }
}

function poseToFrameData(pose: Pose): RigidFrameData {
  return fromPose(pose)
}

export function targetFlangePose(intent: CartesianTargetIntent | LinearPathIntent, target: PoseData): Pose {
  const targetMatrix = multiplyRigid(
    multiplyRigid(frameMatrix(intent.workObject?.userFrame ?? IDENTITY_FRAME), frameMatrix(intent.workObject?.objectFrame ?? IDENTITY_FRAME)),
    frameMatrix(target),
  )
  return poseFromMatrix(multiplyRigid(targetMatrix, inverseRigid(frameMatrix(intent.tool?.tcpInFlange ?? IDENTITY_FRAME))))
}

function targetWorldPose(intent: CartesianTargetIntent | LinearPathIntent | CircularPathIntent, target: PoseData): Pose {
  return poseFromMatrix(
    multiplyRigid(
      multiplyRigid(frameMatrix(intent.workObject.userFrame), frameMatrix(intent.workObject.objectFrame)),
      frameMatrix(target),
    ),
  )
}
export function fromPose(pose: Pose): PoseData {
  const q = rotationMatrixToQuaternion(pose.rotation)
  return { positionMm: [...pose.position] as PositionMm, quaternionWxyz: [q[3], q[0], q[1], q[2]] }
}

const IDENTITY_FRAME: RigidFrameData = {
  positionMm: [0, 0, 0],
  quaternionWxyz: [1, 0, 0, 0],
}

export function createCartesianTargetRequest(
  targetTcpPose: PoseData,
  stateJointsDeg: JointVector6,
  singularityPolicy: SingularityPolicy = 'strict',
): MotionPlanningRequest {
  return {
    schemaVersion: 1,
    robot: { modelId: ABB_IRB1200_PROFILE.id, modelRevision: ABB_IRB1200_MODEL_REVISION },
    state: { jointsDeg: [...stateJointsDeg] as JointVector6 },
    intent: {
      kind: 'cartesian-target',
      targetTcpPose,
      tool: { robhold: true, tcpInFlange: IDENTITY_FRAME },
      workObject: {
        robhold: false,
        userFrame: IDENTITY_FRAME,
        objectFrame: IDENTITY_FRAME,
        ufprog: true,
        ufmec: '',
      },
      configurationPolicy: { kind: 'nearest-valid' },
      singularityPolicy,
    },
  }
}
function validateFrame(frame: RigidFrameData | undefined, field: string): MotionPlanningResultError | null {
  return frame === undefined || isPoseData(frame) ? null : invalidRequest(field, 'expected-finite-rigid-frame')
}
function validateIntent(intent: MotionIntent): MotionPlanningResultError | null {
  if (!intent || typeof intent.kind !== 'string') return invalidRequest('intent', 'expected-discriminated-intent')
  if (intent.kind === 'joint-target') return isSixFinite(intent.targetJointsDeg) ? null : invalidRequest('intent.targetJointsDeg', 'expected-six-finite-numbers')
  if (intent.kind === 'degenerate-ik') {
    if (!isPoseData(intent.targetTcpPose)) return invalidRequest('intent.targetTcpPose', 'expected-finite-pose')
    return intent.constraint === 'locked-joints' && !isSixFinite(intent.lockedJointsDeg ?? []) ? invalidRequest('intent.lockedJointsDeg', 'expected-six-finite-numbers') : null
  }
  if (!isPoseData(intent.targetTcpPose)) return invalidRequest('intent.targetTcpPose', 'expected-finite-pose')
  if (intent.kind === 'circular-path' && !isPoseData(intent.viaTcpPose)) return invalidRequest('intent.viaTcpPose', 'expected-finite-pose')
  if ((intent.kind === 'linear-path' || intent.kind === 'circular-path') && !isFinitePositive(intent.speedMmPerSec)) return invalidRequest('intent.speedMmPerSec', 'expected-positive-finite-number')
  if ((intent.kind === 'linear-path' || intent.kind === 'circular-path') && intent.zone !== 'fine') return { ok: false, error: { code: 'unsupported-capability', category: 'unsupported-capability', details: { zone: intent.zone } } }
  if (!intent.tool || !intent.workObject) return invalidRequest('intent.tool/workObject', 'required-for-cartesian-intent')
  if (intent.configurationPolicy.kind === 'required' && !intent.configurationPolicy.target) return invalidRequest('intent.configurationPolicy.target', 'required')
  if (intent.configurationPolicy.kind === 'current-main' && !intent.configurationPolicy.currentMain) return invalidRequest('intent.configurationPolicy.currentMain', 'required')
  const toolError = validateFrame(intent.tool.tcpInFlange, 'intent.tool.tcpInFlange'); if (toolError) return toolError
  const userError = validateFrame(intent.workObject.userFrame, 'intent.workObject.userFrame'); if (userError) return userError
  return validateFrame(intent.workObject.objectFrame, 'intent.workObject.objectFrame')
}
function validateRequest(request: MotionPlanningRequest): MotionPlanningResultError | null {
  if (!request || typeof request !== 'object') return invalidRequest('request', 'expected-object')
  if (request.schemaVersion !== 1) return invalidRequest('schemaVersion', 'unsupported-version')
  if (!request.robot || typeof request.robot.modelId !== 'string' || request.robot.modelId.length === 0) return invalidRequest('robot.modelId', 'expected-non-empty-string')
  if (typeof request.robot.modelRevision !== 'string' || request.robot.modelRevision.length === 0) return invalidRequest('robot.modelRevision', 'expected-non-empty-string')
  if (!request.state || !isSixFinite(request.state.jointsDeg)) return invalidRequest('state.jointsDeg', 'expected-six-finite-numbers')
  return validateIntent(request.intent)
}
function withinRanges(joints: JointVector6): number | null {
  const index = joints.findIndex((value, axis) => value < ABB_IRB1200_PROFILE.jointRanges[axis][0] || value > ABB_IRB1200_PROFILE.jointRanges[axis][1])
  return index >= 0 ? index : null
}
function configurationData(joints: JointAngles): ABBConfigurationData | undefined {
  const config = ABB_IRB1200_PROFILE.model.deriveConfiguration?.(joints)
  return config && config.length >= 4 ? { cf1: config[0], cf4: config[1], cf6: config[2], cfx: config[3] } : undefined
}
function configurationMatches(configuration: ABBConfigurationData | undefined, policy: ConfigurationPolicy): boolean {
  const expected = policy.kind === 'required' ? policy.target : policy.kind === 'current-main' ? policy.currentMain : undefined
  return expected === undefined || Boolean(configuration && configuration.cf1 === expected.cf1 && configuration.cf4 === expected.cf4 && configuration.cf6 === expected.cf6 && configuration.cfx === expected.cfx)
}
function mapPathFailure(failure: string): MotionPlanningResultError {
  const code: MotionErrorCode = failure === 'joint-limit' ? 'joint-limit' : failure === 'joint-step' || failure === 'wrist-reconfiguration' ? 'path-discontinuity' : failure === 'wrist-singularity' ? 'wrist-singularity' : 'unreachable'
  return { ok: false, error: { code, category: 'planning-failure', details: { failure } } }
}
function makePlan(waypoints: readonly JointAngles[], initial: JointVector6, targetPose?: Pose, relaxedConstraints?: readonly string[]): MotionPlanningResultOk {
  const all = [[...initial] as JointVector6, ...waypoints.map((joints) => [...joints] as JointVector6)]
  const unique = all.filter((point, index) => index === 0 || point.some((value, axis) => value !== all[index - 1][axis]))
  const timed = unique.map((joints, index) => ({ timeMs: index, jointsDeg: joints }))
  const end = timed.at(-1)?.jointsDeg ?? initial
  const endPose = ABB_IRB1200_PROFILE.model.forwardKinematics(end as JointAngles)
  const tcpResidualMm = targetPose && endPose ? Math.hypot(...targetPose.position.map((value, axis) => value - endPose.position[axis])) : undefined
  const orientationResidualDeg = targetPose && endPose ? rotationDistanceRad(targetPose.rotation, endPose.rotation) * 180 / Math.PI : undefined
  const configuration = configurationData(end as JointAngles)
  return { ok: true, waypoints: timed, end: { jointsDeg: end, ...(configuration ? { configuration } : {}) }, validation: { tcpResidualMm, orientationResidualDeg, relaxedConstraints } }
}
function planJointTarget(state: JointVector6, intent: JointTargetIntent): MotionPlanningResult {
  const axisIndex = withinRanges(intent.targetJointsDeg)
  return axisIndex === null ? makePlan([intent.targetJointsDeg as JointAngles], state) : { ok: false, error: { code: 'joint-limit', category: 'planning-failure', details: { axisIndex } } }
}
function planCartesianTarget(state: JointVector6, intent: CartesianTargetIntent): MotionPlanningResult {
  const target = targetFlangePose(intent, intent.targetTcpPose)
  const result = planCartesianPath(target, state as JointAngles, ABB_IRB1200_PROFILE.model, ABB_IRB1200_PROFILE.jointRanges, { allowWristFallback: intent.singularityPolicy === 'wrist-interpolation', preserveConfiguration: intent.configurationPolicy.kind === 'current-main' })
  if (!result.ok) return mapPathFailure(result.failure)
  const end = result.waypoints.at(-1)
  return !end || !configurationMatches(configurationData(end), intent.configurationPolicy) ? { ok: false, error: { code: 'configuration-unreachable', category: 'planning-failure', details: { policy: intent.configurationPolicy.kind } } } : makePlan(result.waypoints, state, target, result.appliedSingularityMode ? ['orientation'] : undefined)
}
function planLinearPath(state: JointVector6, intent: LinearPathIntent): MotionPlanningResult {
  const target = targetWorldPose(intent, intent.targetTcpPose)
  const startFlange = ABB_IRB1200_PROFILE.model.forwardKinematics(state as JointAngles)
  if (!startFlange) return { ok: false, error: { code: 'unreachable', category: 'planning-failure', details: { reason: 'start-forward-kinematics' } } }
  const startTcp = poseFromMatrix(multiplyRigid(frameMatrix(poseToFrameData(startFlange)), frameMatrix(intent.tool.tcpInFlange)))
  const result = planCartesianPath(target, state as JointAngles, ABB_IRB1200_PROFILE.model, ABB_IRB1200_PROFILE.jointRanges, { tcpStart: startTcp, toFlange: (tcp) => poseFromMatrix(multiplyRigid(frameMatrix(poseToFrameData(tcp)), inverseRigid(frameMatrix(intent.tool.tcpInFlange)))), allowWristFallback: intent.singularityPolicy === 'wrist-interpolation', preserveConfiguration: intent.configurationPolicy.kind === 'current-main' })
  if (!result.ok) return mapPathFailure(result.failure)
  const end = result.waypoints.at(-1)
  if (!end || !configurationMatches(configurationData(end), intent.configurationPolicy)) return { ok: false, error: { code: 'configuration-unreachable', category: 'planning-failure', details: { policy: intent.configurationPolicy.kind } } }
  const plan = makePlan(result.waypoints, state, target, result.appliedSingularityMode ? ['orientation'] : undefined)
  const duration = Math.max(1, Math.round(1000 * Math.max(1, result.waypoints.length) / intent.speedMmPerSec))
  return { ...plan, waypoints: plan.waypoints.map((point, index) => ({ ...point, timeMs: Math.round(duration * index / Math.max(1, plan.waypoints.length - 1)) })) }
}
function planCircularPath(state: JointVector6, intent: CircularPathIntent): MotionPlanningResult {
  const via = targetWorldPose(intent, intent.viaTcpPose); const target = targetWorldPose(intent, intent.targetTcpPose)
  const startFlange = ABB_IRB1200_PROFILE.model.forwardKinematics(state as JointAngles)
  if (!startFlange) return { ok: false, error: { code: 'unreachable', category: 'planning-failure', details: { reason: 'start-forward-kinematics' } } }
  const startTcp = poseFromMatrix(multiplyRigid(frameMatrix(poseToFrameData(startFlange)), frameMatrix(intent.tool.tcpInFlange)))
  const q0 = rotationMatrixToQuaternion(startTcp.rotation)
  const q2 = rotationMatrixToQuaternion(target.rotation)
  const distance = Math.hypot(...target.position.map((value, axis) => value - startTcp.position[axis]))
  const poses = sampleArcPoses(startTcp.position, via.position, target.position, q0, q2, Math.min(64, Math.max(8, Math.ceil(distance / 4))))
  if (!poses) return { ok: false, error: { code: 'unreachable', category: 'planning-failure', details: { reason: 'degenerate-arc' } } }
  const targetFlange = poseFromMatrix(multiplyRigid(frameMatrix(poseToFrameData(target)), inverseRigid(frameMatrix(intent.tool.tcpInFlange))))
  const result = solvePoseWaypoints(poses, state as JointAngles, ABB_IRB1200_PROFILE.model, ABB_IRB1200_PROFILE.jointRanges, (pose) => poseFromMatrix(multiplyRigid(frameMatrix(poseToFrameData(pose)), inverseRigid(frameMatrix(intent.tool.tcpInFlange)))), { preserveConfiguration: intent.configurationPolicy.kind === 'current-main' }, { allowWristFallback: intent.singularityPolicy === 'wrist-interpolation' })
  if (!result.ok) return mapPathFailure(result.failure)
  const end = result.waypoints.at(-1)
  if (!end || !configurationMatches(configurationData(end), intent.configurationPolicy)) return { ok: false, error: { code: 'configuration-unreachable', category: 'planning-failure', details: { policy: intent.configurationPolicy.kind } } }
  const plan = makePlan(result.waypoints, state, targetFlange)
  const duration = Math.max(1, Math.round(1000 * Math.max(1, result.waypoints.length) / intent.speedMmPerSec))
  return { ...plan, waypoints: plan.waypoints.map((point, index) => ({ ...point, timeMs: Math.round(duration * index / Math.max(1, plan.waypoints.length - 1)) })) }
}
export function planMotion(request: MotionPlanningRequest): MotionPlanningResult {
  const validationError = validateRequest(request); if (validationError) return validationError
  if (request.robot.modelId !== ABB_IRB1200_PROFILE.id || request.robot.modelRevision !== ABB_IRB1200_MODEL_REVISION) return { ok: false, error: { code: 'unsupported-model', category: 'unsupported-model', details: { modelId: request.robot.modelId, modelRevision: request.robot.modelRevision } } }
  switch (request.intent.kind) {
    case 'joint-target': return planJointTarget(request.state.jointsDeg, request.intent)
    case 'cartesian-target': return planCartesianTarget(request.state.jointsDeg, request.intent)
    case 'linear-path': return planLinearPath(request.state.jointsDeg, request.intent)
    case 'circular-path': return planCircularPath(request.state.jointsDeg, request.intent)
    case 'degenerate-ik': return { ok: false, error: { code: 'unsupported-capability', category: 'unsupported-capability', details: { intent: request.intent.kind } } }
  }
}
