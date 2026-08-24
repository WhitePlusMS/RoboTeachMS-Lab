import {
  quaternionToRotationMatrix,
  rotationMatrixToEulerZYX,
} from '@/robotics/math/rotation3d.ts'
import type { RobotModel } from '@/robotics/robot-model.ts'
import type { JointAngles, Pose } from '@/robotics/types.ts'
import type { CartesianPathFailure } from '@/robotics/cartesian-path-planner.ts'
import {
  NO_EXTERNAL_AXIS,
  type RapidQuat,
  type RobTarget,
  type SpeedData,
  type ToolData,
  type WobjData,
  type ZoneData,
} from './rapid-types.ts'

/**
 * RAPID 四元数 [q1,q2,q3,q4]（q1=w）→ 机器人核心数学的 [x,y,z,w]。
 * 机器人的 rotation3d 只按投影内部约定工作；ABB 顺序在 seam 中显式转换，
 * 禁止让 quaternionToRotationMatrix 同时猜测两种顺序。
 */
export function rapidQuatToInternal(rot: RapidQuat): [number, number, number, number] {
  const [q1, q2, q3, q4] = rot
  return [q2, q3, q4, q1]
}

/** 机器人核心数学的 [x,y,z,w] → RAPID 四元数 [q1,q2,q3,q4]（q1=w）。供测试/构造 RAPID 数据使用。 */
export function internalQuatToRapid(quat: [number, number, number, number]): RapidQuat {
  const [x, y, z, w] = quat
  return [w, x, y, z]
}

/** 外部轴六项是否均为 ABB“未使用”常量（9E9），即目标不带外部轴。 */
function isNoExternalAxis(extax: RobTarget['extax']): boolean {
  return extax.every((value, index) => value === NO_EXTERNAL_AXIS[index])
}

/**
 * 规划错误种类：这些是规划错误，不是 MotionRunner 的 completed/stopped 结果。
 * MoveJ 与 MoveL 规划层共享同一套错误语义。
 */
export type MotionPlanErrorKind =
  | 'invalid-data'
  | 'unsupported-option'
  | 'unreachable'
  | 'joint-limit'
  | 'wrist-singularity'
  | 'wrist-reconfiguration'
  | 'joint-step'

/**
 * 运动规划失败的可选关节级上下文。
 *
 * waypoint 求解器内部使用 0 起始的轴索引；这里保持纯数据结构，避免
 * RAPID 规划层依赖 robotics 实现类型。日志层再把 axisIndex 映射为 J1..J6。
 */
export interface MotionPlanDiagnostic {
  waypointIndex?: number
  axisIndex?: number
  previousAngleDeg?: number
  attemptedAngleDeg?: number
  deltaDeg?: number
  limitRangeDeg?: readonly [number, number]
}

export interface MotionPlanError {
  kind: MotionPlanErrorKind
  message: string
  diagnostic?: MotionPlanDiagnostic
}

/** 把笛卡尔 waypoint 失败映射为 RAPID 运行时可定位的规划错误，禁止吞成普通 unreachable。 */
export function cartesianPathFailureToMotionError(
  failure: CartesianPathFailure,
  diagnostic?: MotionPlanDiagnostic,
): MotionPlanError {
  const withDiagnostic = (error: MotionPlanError): MotionPlanError =>
    diagnostic ? { ...error, diagnostic } : error

  switch (failure) {
    case 'wrist-singularity':
      return withDiagnostic({
        kind: 'wrist-singularity',
        message:
          '严格保持姿态的直线/圆弧运动不能通过腕部奇异（J5≈0°）；请修改奇异点另一侧第一个目标的姿态，启用 SingArea\\Wrist，或先用关节 Jog 脱离。',
      })
    case 'wrist-reconfiguration':
      return withDiagnostic({
        kind: 'wrist-reconfiguration',
        message:
          '目标将导致机器人构型重新配置；请修改奇异点另一侧第一个目标的姿态，启用 SingArea\\Wrist，或先用关节 Jog 脱离。',
      })
    case 'joint-step':
      return withDiagnostic({
        kind: 'joint-step',
        message: '路径相邻关节步长超过连续运动限制，已拒绝该路径点。',
      })
    case 'joint-limit':
      return withDiagnostic({ kind: 'joint-limit', message: '路径会触及关节限位，未执行。' })
    case 'ik-not-converged':
      return withDiagnostic({ kind: 'unreachable', message: '逆解未收敛，目标未执行。' })
  }
}

function allFinite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value))
}

/**
 * 第一层：tuple 运行时长度校验。畸形长度（trans/rot/robconf/extax/cog/aom，
 * 以及各 frame 的 rot）在索引访问前拒绝，防止后续读取 undefined。
 */
function validateTupleLengths(
  target: RobTarget,
  tool: ToolData,
  wobj: WobjData,
): MotionPlanError | null {
  if (target.trans.length !== 3)
    return { kind: 'invalid-data', message: 'robtarget.trans 长度必须为 3' }
  if (target.rot.length !== 4)
    return { kind: 'invalid-data', message: 'robtarget.rot 长度必须为 4' }
  if (target.robconf.length !== 4)
    return { kind: 'invalid-data', message: 'robtarget.robconf 长度必须为 4' }
  if (target.extax.length !== 6)
    return { kind: 'invalid-data', message: 'robtarget.extax 长度必须为 6' }
  if (tool.tframe.rot.length !== 4)
    return { kind: 'invalid-data', message: 'tooldata.tframe.rot 长度必须为 4' }
  if (tool.tload.cog.length !== 3)
    return { kind: 'invalid-data', message: 'loaddata.cog 长度必须为 3' }
  if (tool.tload.aom.length !== 4)
    return { kind: 'invalid-data', message: 'loaddata.aom 长度必须为 4' }
  if (wobj.uframe.rot.length !== 4)
    return { kind: 'invalid-data', message: 'wobjdata.uframe.rot 长度必须为 4' }
  if (wobj.oframe.rot.length !== 4)
    return { kind: 'invalid-data', message: 'wobjdata.oframe.rot 长度必须为 4' }
  return null
}

/** 第二层：所有数值字段必须有限（NaN/Infinity/-Infinity 都是非法数据）。 */
function validateNumericData(
  target: RobTarget,
  speed: SpeedData,
  tool: ToolData,
  wobj: WobjData,
  zone: ZoneData,
): MotionPlanError | null {
  const numbers = [
    ...target.trans,
    ...target.rot,
    ...target.robconf,
    ...target.extax,
    speed.v_tcp,
    speed.v_ori,
    speed.v_leax,
    speed.v_reax,
    zone.pzoneTcp,
    zone.pzoneOri,
    zone.pzoneEax,
    zone.zoneOri,
    zone.zoneLeax,
    zone.zoneReax,
    ...tool.tframe.trans,
    ...tool.tframe.rot,
    tool.tload.mass,
    ...tool.tload.cog,
    ...tool.tload.aom,
    tool.tload.ix,
    tool.tload.iy,
    tool.tload.iz,
    ...wobj.uframe.trans,
    ...wobj.uframe.rot,
    ...wobj.oframe.trans,
    ...wobj.oframe.rot,
  ]
  if (!allFinite(...numbers)) {
    return {
      kind: 'invalid-data',
      message: 'robtarget/speeddata/zonedata/tool/wobj 包含非有限数值',
    }
  }
  return null
}

/** 第三层：所有四元数必须非零且可归一化（零长度在调用 IK/路径规划前拒绝）。 */
function validateQuaternions(
  target: RobTarget,
  tool: ToolData,
  wobj: WobjData,
): MotionPlanError | null {
  const quats: Array<[string, number[]]> = [
    ['robtarget.rot', target.rot],
    ['tooldata.tframe.rot', tool.tframe.rot],
    ['loaddata.aom', tool.tload.aom],
    ['wobjdata.uframe.rot', wobj.uframe.rot],
    ['wobjdata.oframe.rot', wobj.oframe.rot],
  ]
  for (const [field, rot] of quats) {
    const length = Math.hypot(...rot)
    if (!Number.isFinite(length) || length === 0) {
      return { kind: 'invalid-data', message: `${field} 四元数长度为零，无法归一化` }
    }
  }
  return null
}

/** 第四层：speeddata 四个速度字段都必须为正且有限。 */
function validateSpeed(speed: SpeedData): MotionPlanError | null {
  if (speed.v_tcp <= 0 || speed.v_ori <= 0 || speed.v_leax <= 0 || speed.v_reax <= 0) {
    return { kind: 'invalid-data', message: 'speeddata 的 v_tcp/v_ori/v_leax/v_reax 必须均为正' }
  }
  return null
}

/**
 * 固定单机器人 MVP 只支持：机器人持工具（tool.robhold=TRUE）、固定工件坐标
 * （wobj.robhold=FALSE、ufprog=TRUE、ufmec=''）。此外仍只支持零 robconf 与非外部轴目标。
 * 越界的合法配置必须明确拒绝，且消息指出具体字段（票据 02 开放自定义 Tool/WObj 坐标求值）。
 */
function checkSupportedConfiguration(
  tool: ToolData,
  wobj: WobjData,
  target: RobTarget,
): MotionPlanError | null {
  if (tool.robhold !== true) {
    return {
      kind: 'unsupported-option',
      message: '暂不支持机器人不持工具（tooldata.robhold=FALSE）',
    }
  }
  if (wobj.robhold !== false) {
    return { kind: 'unsupported-option', message: '暂不支持机器人持工件（wobjdata.robhold=TRUE）' }
  }
  if (wobj.ufprog !== true) {
    return {
      kind: 'unsupported-option',
      message: '暂不支持可移动用户坐标系（wobjdata.ufprog=FALSE）',
    }
  }
  if (wobj.ufmec !== '') {
    return {
      kind: 'unsupported-option',
      message: '暂不支持协调外部机械单元（wobjdata.ufmec 非空）',
    }
  }
  if (target.robconf.some((value) => value !== 0)) {
    return { kind: 'unsupported-option', message: '首期只支持 robtarget.robconf=[0,0,0,0] 构型' }
  }
  if (isNoExternalAxis(target.extax)) return null
  return {
    kind: 'unsupported-option',
    message: '不支持外部轴，robtarget.extax 六项必须均为 ABB 未使用常量（9E9）',
  }
}

/**
 * 统一的数据与配置校验，严格按序：结构长度 → 数值有限性 → 四元数 →
 * 首期支持范围。任一失败即返回对应规划错误（非法数据 invalid-data，合法但
 * 暂不支持的配置 unsupported-option），保证非法输入不会进入 FK/IK/路径规划。
 */
export function validateMotionInput(
  target: RobTarget,
  speed: SpeedData,
  tool: ToolData,
  wobj: WobjData,
  zone: ZoneData,
): MotionPlanError | null {
  return (
    validateTupleLengths(target, tool, wobj) ??
    validateNumericData(target, speed, tool, wobj, zone) ??
    validateQuaternions(target, tool, wobj) ??
    validateSpeed(speed) ??
    checkSupportedConfiguration(tool, wobj, target)
  )
}

/**
 * 计算一条 MoveJ/MoveL 的仿真时长：TCP 起点到目标距离 / v_tcp，转毫秒并钳位为正的有限值。
 * 模型正解失败返回 null（调用方映射为 unreachable 规划错误）。MoveJ/MoveL 共用同一份
 * “有限性 + 正时长钳位”逻辑，避免两处各写一份且条件不一致。
 */
export function simulateDurationMs(
  model: RobotModel,
  currentJoints: JointAngles,
  trans: readonly [number, number, number],
  vTcp: number,
): number | null {
  const startPose = model.forwardKinematics(currentJoints)
  if (!startPose) return null
  const distance = Math.hypot(
    trans[0] - startPose.position[0],
    trans[1] - startPose.position[1],
    trans[2] - startPose.position[2],
  )
  const durationMs = (distance / vTcp) * 1000
  return Number.isFinite(durationMs) && durationMs > 0 ? Math.max(durationMs, 1) : 1
}

/** 把 robtarget.trans/rot 归一化并转换为 Pose（旋转矩阵为姿态误差唯一来源）。 */
export function robTargetToPose(target: RobTarget): Pose {
  const rotorLength = Math.hypot(...target.rot)
  // 归一化后的四元数仍是 RAPID [q1,q2,q3,q4] 顺序；交给数学模块前先转换到内部 [x,y,z,w]。
  const normalizedRapid = target.rot.map((value) => value / rotorLength) as RapidQuat
  const rotation = quaternionToRotationMatrix(rapidQuatToInternal(normalizedRapid))
  return {
    position: [...target.trans],
    euler: rotationMatrixToEulerZYX(rotation),
    rotation,
  }
}
