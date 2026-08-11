import { quaternionToRotationMatrix, rotationMatrixToEulerZYX } from '../robot/math/rotation3d'
import type { JointAngles, Pose } from '../robot/types'
import {
  isDefaultTool0,
  isDefaultWobj0,
  type RobTarget,
  type SpeedData,
  type ToolData,
  type WobjData,
  type ZoneData,
} from './rapid-types'

/**
 * 规划错误种类：这些是规划错误，不是 MotionRunner 的 completed/stopped 结果。
 * MoveJ 与 MoveL 规划层共享同一套错误语义。
 */
export type MotionPlanErrorKind =
  | 'invalid-data'
  | 'unsupported-option'
  | 'unreachable'
  | 'joint-limit'

export interface MotionPlanError {
  kind: MotionPlanErrorKind
  message: string
}

/** 判定 IK 解是否被夹在关节范围边界（度）；该启发用于区分 joint-limit。 */
const JOINT_LIMIT_EPS_DEG = 0.5

function allFinite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value))
}

function validateTargetData(target: RobTarget): MotionPlanError | null {
  if (
    !allFinite(...target.trans) ||
    !allFinite(...target.rot) ||
    !allFinite(...target.robconf) ||
    !allFinite(...target.extax)
  ) {
    return { kind: 'invalid-data', message: 'robtarget 的 trans/rot/robconf/extax 包含非有限数值' }
  }
  const quaternionLength = Math.hypot(...target.rot)
  // 零长度或非有限四元数无法归一化，必须在调用 IK 前拒绝。
  if (!Number.isFinite(quaternionLength) || quaternionLength === 0) {
    return { kind: 'invalid-data', message: 'robtarget.rot 四元数长度为零，无法归一化' }
  }
  return null
}

function validateSpeed(speed: SpeedData): MotionPlanError | null {
  if (!allFinite(speed.v_tcp, speed.v_ori, speed.v_leax, speed.v_reax)) {
    return { kind: 'invalid-data', message: 'speeddata 的 v_tcp/v_ori/v_leax/v_reax 包含非有限数值' }
  }
  if (speed.v_tcp <= 0) {
    return { kind: 'invalid-data', message: 'speeddata.v_tcp 必须为正（mm/s）' }
  }
  return null
}

/** 首期只支持默认 tool0、默认 wobj0、fine 与非外部轴目标；不支持的配置必须明确拒绝。 */
function checkSupportedConfiguration(
  tool: ToolData,
  wobj: WobjData,
  zone: ZoneData,
  extax: RobTarget['extax'],
): MotionPlanError | null {
  if (!isDefaultTool0(tool)) {
    return { kind: 'unsupported-option', message: '不支持用户工具，仅支持默认 tool0' }
  }
  if (!isDefaultWobj0(wobj)) {
    return { kind: 'unsupported-option', message: '不支持用户工件坐标，仅支持默认 wobj0' }
  }
  if (zone.finep !== true) {
    return { kind: 'unsupported-option', message: 'zone.finep 必须为 true（首期不支持 zone 过渡）' }
  }
  if (extax.some((value) => value !== 0)) {
    return { kind: 'unsupported-option', message: '不支持外部轴，robtarget.extax 必须全零' }
  }
  return null
}

/** 统一的数据与配置校验：先数据后配置，任一失败即返回对应规划错误。 */
export function validateMotionInput(
  target: RobTarget,
  speed: SpeedData,
  tool: ToolData,
  wobj: WobjData,
  zone: ZoneData,
): MotionPlanError | null {
  return (
    validateTargetData(target) ??
    validateSpeed(speed) ??
    checkSupportedConfiguration(tool, wobj, zone, target.extax)
  )
}

/** 把 robtarget.trans/rot 归一化并转换为 Pose（旋转矩阵为姿态误差唯一来源）。 */
export function robTargetToPose(target: RobTarget): Pose {
  const rotorLength = Math.hypot(...target.rot)
  const normalizedRot = target.rot.map((value) => value / rotorLength) as [
    number,
    number,
    number,
    number,
  ]
  const rotation = quaternionToRotationMatrix(normalizedRot)
  return {
    position: [...target.trans],
    euler: rotationMatrixToEulerZYX(rotation),
    rotation,
  }
}

/** IK 解是否被夹在任一关节范围边界（启发式，用于判别 joint-limit）。 */
export function isJointAtLimit(
  joints: JointAngles,
  jointRanges: readonly (readonly [number, number])[],
): boolean {
  return joints.some((value, index) => {
    const [min, max] = jointRanges[index]
    return value <= min + JOINT_LIMIT_EPS_DEG || value >= max - JOINT_LIMIT_EPS_DEG
  })
}
