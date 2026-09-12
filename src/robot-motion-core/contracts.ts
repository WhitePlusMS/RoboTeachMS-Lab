export type JointVector6 = readonly [number, number, number, number, number, number]
export type PositionMm = readonly [number, number, number]
export type QuaternionWxyz = readonly [number, number, number, number]

export interface PoseData {
  readonly positionMm: PositionMm
  readonly quaternionWxyz: QuaternionWxyz
}
export type RigidFrameData = PoseData
export interface ToolData {
  readonly robhold: true
  readonly tcpInFlange: RigidFrameData
}
export interface WorkObjectData {
  readonly robhold: false
  readonly userFrame: RigidFrameData
  readonly objectFrame: RigidFrameData
  readonly ufprog: true
  readonly ufmec: ''
}
export interface ABBConfigurationData {
  readonly cf1: number
  readonly cf4: number
  readonly cf6: number
  readonly cfx: number
}
export type ConfigurationPolicy =
  | { readonly kind: 'nearest-valid' }
  | { readonly kind: 'current-main'; readonly currentMain: ABBConfigurationData }
  | { readonly kind: 'required'; readonly target: ABBConfigurationData }
export type SingularityPolicy = 'strict' | 'wrist-interpolation'
export interface JointTargetIntent {
  readonly kind: 'joint-target'
  readonly targetJointsDeg: JointVector6
}
export interface PoseJointTargetIntent {
  readonly kind: 'pose-joint-target'
  readonly targetTcpPose: PoseData
  readonly tool: ToolData
  readonly workObject: WorkObjectData
  readonly configurationPolicy: ConfigurationPolicy
  readonly singularityPolicy: SingularityPolicy
  readonly zone: 'fine' | 'fly-by'
  readonly speedMmPerSec?: number
  readonly speedOriDegPerSec?: number
}
export interface LinearPathIntent {
  readonly kind: 'linear-path'
  readonly targetTcpPose: PoseData
  readonly tool: ToolData
  readonly workObject: WorkObjectData
  readonly speedMmPerSec: number
  readonly speedOriDegPerSec?: number
  readonly zone: 'fine' | 'fly-by'
  readonly configurationPolicy: ConfigurationPolicy
  readonly singularityPolicy: SingularityPolicy
}
export interface CircularPathIntent {
  readonly kind: 'circular-path'
  readonly viaTcpPose: PoseData
  readonly targetTcpPose: PoseData
  readonly tool: ToolData
  readonly workObject: WorkObjectData
  readonly speedMmPerSec: number
  readonly speedOriDegPerSec?: number
  readonly zone: 'fine' | 'fly-by'
  readonly configurationPolicy: ConfigurationPolicy
  readonly singularityPolicy: SingularityPolicy
}
export type MotionIntent =
  JointTargetIntent | PoseJointTargetIntent | LinearPathIntent | CircularPathIntent
export interface MotionPlanningRequest {
  readonly schemaVersion: 1
  readonly robot: { readonly modelId: string; readonly modelRevision: string }
  readonly state: { readonly jointsDeg: JointVector6 }
  readonly intent: MotionIntent
}
export type MotionErrorCategory =
  'invalid-request' | 'unsupported-model' | 'planning-failure' | 'unsupported-capability'
export type MotionErrorCode =
  | 'invalid-request'
  | 'unsupported-model'
  | 'unsupported-capability'
  | 'unreachable'
  | 'configuration-unreachable'
  | 'wrist-singularity'
  | 'joint-limit'
  | 'path-discontinuity'
export interface MotionError {
  readonly code: MotionErrorCode
  readonly category: MotionErrorCategory
  readonly details: Readonly<Record<string, string | number | boolean | null>>
}
export interface MotionPlanWaypoint {
  readonly timeMs: number
  readonly jointsDeg: JointVector6
}
export interface MotionPlanningResultOk {
  readonly ok: true
  readonly waypoints: readonly MotionPlanWaypoint[]
  readonly end: { readonly jointsDeg: JointVector6; readonly configuration?: ABBConfigurationData }
  readonly validation: {
    readonly tcpResidualMm?: number
    readonly orientationResidualDeg?: number
    readonly relaxedConstraints?: readonly string[]
  }
}
export interface MotionPlanningResultError {
  readonly ok: false
  readonly error: MotionError
}
export type MotionPlanningResult = MotionPlanningResultOk | MotionPlanningResultError
