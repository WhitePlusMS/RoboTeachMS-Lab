import type {
  ABBConfigurationData,
  ConfigurationPolicy,
  MotionPlanningRequest,
  MotionPlanningResult,
  PoseData,
  SingularityPolicy,
  ToolData as CoreToolData,
  WorkObjectData,
} from '@/robot-motion-core/index.ts'
import type { JointAngles } from '@/robotics/model/index.ts'
import type { ConfigurationMonitoringMode } from '../data/index.ts'
import type { RobTarget, ToolData, WobjData } from '../data/index.ts'
import { quaternionToRotationMatrix, rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'
import type { Pose } from '@/robotics/model/index.ts'

export const ABB_MODEL_ID = 'abb-irb1200-5-0.9'
export const ABB_MODEL_REVISION = 'dh-standard-v1'

export function poseDataFromRapidPose(pose: { trans: readonly [number, number, number]; rot: readonly [number, number, number, number] }): PoseData {
  return { positionMm: [...pose.trans] as PoseData['positionMm'], quaternionWxyz: [...pose.rot] as PoseData['quaternionWxyz'] }
}

export function poseDataFromRobTarget(target: RobTarget): PoseData {
  return poseDataFromRapidPose(target)
}

export function poseDataFromPose(pose: Pose): PoseData {
  const quaternion = rotationMatrixToQuaternion(pose.rotation)
  return { positionMm: [...pose.position] as PoseData['positionMm'], quaternionWxyz: [quaternion[3], quaternion[0], quaternion[1], quaternion[2]] }
}

export function coreToolFromRapid(tool: ToolData): CoreToolData {
  return { robhold: true, tcpInFlange: poseDataFromRapidPose(tool.tframe) }
}

export function coreWorkObjectFromRapid(wobj: WobjData): WorkObjectData {
  return { robhold: false, userFrame: poseDataFromRapidPose(wobj.uframe), objectFrame: poseDataFromRapidPose(wobj.oframe), ufprog: true, ufmec: '' }
}

export function rapidConfiguration(target: RobTarget): ABBConfigurationData {
  return { cf1: target.robconf[0], cf4: target.robconf[1], cf6: target.robconf[2], cfx: target.robconf[3] }
}

export function coreConfigurationPolicy(
  target: RobTarget,
  monitoring: ConfigurationMonitoringMode,
  current: ABBConfigurationData,
): ConfigurationPolicy {
  return monitoring === 'on' ? { kind: 'required', target: rapidConfiguration(target) } : { kind: 'current-main', currentMain: current }
}

export function coreRequest(
  state: JointAngles,
  intent: MotionPlanningRequest['intent'],
): MotionPlanningRequest {
  return { schemaVersion: 1, robot: { modelId: ABB_MODEL_ID, modelRevision: ABB_MODEL_REVISION }, state: { jointsDeg: [...state] as MotionPlanningRequest['state']['jointsDeg'] }, intent }
}

export function coreSingularity(mode: 'off' | 'wrist'): SingularityPolicy {
  return mode === 'wrist' ? 'wrist-interpolation' : 'strict'
}

export function mapCoreFailure(result: MotionPlanningResult): { kind: 'invalid-data' | 'unsupported-option' | 'unreachable' | 'joint-limit' | 'wrist-singularity' | 'wrist-reconfiguration' | 'joint-step'; message: string } | null {
  if (result.ok) return null
  const message = `Core 运动规划失败：${result.error.code}`
  switch (result.error.code) {
    case 'invalid-request': return { kind: 'invalid-data', message }
    case 'unsupported-capability': return { kind: 'unsupported-option', message: result.error.details.zone ? '仅支持 fine 停点；非 fine fly-by zone 尚未支持' : message }
    case 'configuration-unreachable': return { kind: 'unsupported-option', message: '目标 robconf 与当前 ConfJ/ConfL 运行时构型策略不兼容' }
    case 'joint-limit': return { kind: 'joint-limit', message }
    case 'wrist-singularity': return { kind: 'wrist-singularity', message }
    case 'path-discontinuity': return { kind: 'joint-step', message }
    default: return { kind: 'unreachable', message }
  }
}

export function cloneCoreFrameToPose(data: PoseData): Pose {
  const raw = [data.quaternionWxyz[1], data.quaternionWxyz[2], data.quaternionWxyz[3], data.quaternionWxyz[0]] as [number, number, number, number]
  const rotation = quaternionToRotationMatrix(raw)
  return { position: [...data.positionMm] as Pose['position'], euler: [0, 0, 0], rotation }
}
