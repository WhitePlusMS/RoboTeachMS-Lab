import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/profile.ts'
import type { JointAngles, Pose } from '@/robotics/model/types.ts'
import { planMoveJ } from './movej-planner.ts'
import { planMoveL } from './movel-planner.ts'
import {
  flangeToWorldTcpPose,
  robTargetToFlangePose,
  robTargetToWorldPose,
} from './coordinate-transform.ts'
import { internalQuatToRapid, robTargetToPose } from './plan-shared.ts'
import { orientationError, rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'
import {
  defaultTool0,
  defaultWobj0,
  defaultZoneFine,
  type RobTarget,
  type SpeedData,
  type ToolData,
  type WobjData,
  type ZoneData,
} from './rapid-types.ts'

/**
 * Ticket 02 — 让固定 Tool/WObj 驱动 MoveJ/MoveL。
 * 验证自定义工具的 TCP 平移/旋转与固定 wobj 的平移/旋转按 ABB 官方矩阵顺序影响法兰目标、FK/IK 和实际 TCP 轨迹。
 */

const MODEL = ABB_IRB1200_PROFILE.model
const JOINT_RANGES = ABB_IRB1200_PROFILE.jointRanges
const HOME: JointAngles = [...ABB_IRB1200_PROFILE.homeJoints] as JointAngles

/** 断言 FK 非空的 home 位姿。 */
function homeFk(): Pose {
  const pose = MODEL.forwardKinematics(HOME)
  if (!pose) throw new Error('home FK unavailable')
  return pose
}

const SPEED: SpeedData = { v_tcp: 100, v_ori: 500, v_leax: 5000, v_reax: 1000 }
const FINE: ZoneData = defaultZoneFine()

/** 由当前法兰位姿生成一个可达的 robtarget（FK 正向教学目标）。 */
function fkT(frame: Pose): RobTarget {
  const quat = rotationMatrixToQuaternion(frame.rotation)
  return {
    trans: [...frame.position],
    rot: internalQuatToRapid(quat),
    robconf: [0, 0, 0, 0],
    extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
  }
}

function makeMoveJ(target: RobTarget, tool: ToolData, wobj: WobjData) {
  return { kind: 'movej' as const, target, speed: SPEED, zone: FINE, tool, wobj }
}
function makeMoveL(target: RobTarget, tool: ToolData, wobj: WobjData) {
  return { kind: 'movel' as const, target, speed: SPEED, zone: FINE, tool, wobj }
}

function posErr(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

describe('Ticket 02 — tool0+wobj0 无回归（ABB 基座机械法兰语义）', () => {
  it('tool0/wobj0 时换算后的法兰目标与既有 robTargetToPose 一致', () => {
    const base = fkT(homeFk())
    const tool0 = defaultTool0()
    const wobj0 = defaultWobj0()
    const flange = robTargetToFlangePose(base, wobj0, tool0)
    const legacy = robTargetToPose(base)
    expect(posErr(flange.position, legacy.position)).toBeLessThan(1e-9)
  })
})

describe('Ticket 02 — 自定义 Tool/WObj 影响 MoveJ 法兰目标与 FK', () => {
  it('自定义 TCP 平移偏移机械法兰目标：法兰 FK 等于换算后的目标（负方向 T 平移）', () => {
    const baseT = fkT(homeFk())
    // 工具 TCP 沿其 z 前伸 40mm：机器人法兰须相对 TCP 目标后缩 40mm 才能让 TCP 到点。
    const tipTool: ToolData = {
      robhold: true,
      tframe: { trans: [0, 0, 40], rot: [1, 0, 0, 0] },
      tload: { mass: 0.2, cog: [0, 0, 20], aom: [1, 0, 0, 0], ix: 0, iy: 0, iz: 0 },
    }
    const plan = planMoveJ(makeMoveJ(baseT, tipTool, defaultWobj0()), MODEL, HOME, JOINT_RANGES)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const expectedFlange = robTargetToFlangePose(baseT, defaultWobj0(), tipTool)
    const fk = MODEL.forwardKinematics(plan.joints)
    expect(fk).not.toBeNull()
    if (fk) expect(posErr(fk.position, expectedFlange.position)).toBeLessThanOrEqual(1)
  })

  it('自定义 wobj 平移（uframe）偏移机械法兰目标', () => {
    const baseT = fkT(homeFk())
    const offsetWobj: WobjData = {
      ...defaultWobj0(),
      uframe: { trans: [80, 0, 0], rot: [1, 0, 0, 0] },
    }
    const plan = planMoveJ(makeMoveJ(baseT, defaultTool0(), offsetWobj), MODEL, HOME, JOINT_RANGES)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const expectedFlange = robTargetToFlangePose(baseT, offsetWobj, defaultTool0())
    const fk = MODEL.forwardKinematics(plan.joints)
    expect(fk).not.toBeNull()
    if (fk) expect(posErr(fk.position, expectedFlange.position)).toBeLessThanOrEqual(1)
  })
})

describe('Ticket 02 — MoveL 保证 TCP（而非裸法兰）走直线', () => {
  it('自定义工具下，逐 waypoint 换算回的世界 TCP 近似落在直线，而法兰轨迹明显偏移', () => {
    // 工具 TCP 前伸 120mm（沿法兰本地 z，HOME 下指向下）；目标 TCP 沿世界 +X 平移 80mm、保持同一高度，
    // 即 TCP 走一条干净的直线；法兰将平行跟进（恒偏移 120mm）。
    const tool: ToolData = {
      robhold: true,
      tframe: { trans: [0, 0, 120], rot: [1, 0, 0, 0] },
      tload: { mass: 0.5, cog: [0, 0, 60], aom: [1, 0, 0, 0], ix: 0, iy: 0, iz: 0 },
    }
    const wobj = defaultWobj0()
    const tcpStartWorld = flangeToWorldTcpPose(homeFk(), tool)
    const endTcpPos: [number, number, number] = [
      tcpStartWorld.position[0] + 80,
      tcpStartWorld.position[1],
      tcpStartWorld.position[2],
    ]
    const robTarget: RobTarget = {
      trans: endTcpPos,
      rot: internalQuatToRapid(rotationMatrixToQuaternion(tcpStartWorld.rotation)),
      robconf: [0, 0, 0, 0],
      extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
    }
    const plan = planMoveL(makeMoveL(robTarget, tool, wobj), MODEL, HOME, JOINT_RANGES)
    expect(plan.ok, plan.ok ? '' : plan.error.message).toBe(true)
    if (!plan.ok) return

    const tcpEndWorld = robTargetToWorldPose(robTarget, wobj)
    // 直线：起点→终点方向向量（沿 +X）。
    const dir = [
      tcpEndWorld.position[0] - tcpStartWorld.position[0],
      tcpEndWorld.position[1] - tcpStartWorld.position[1],
      tcpEndWorld.position[2] - tcpStartWorld.position[2],
    ]
    const len = Math.hypot(...dir) || 1
    const unit = dir.map((v) => v / len)

    let maxTcpLateral = 0
    let maxFlangeLateral = 0
    for (const joints of plan.waypoints) {
      const fk = MODEL.forwardKinematics(joints)
      expect(fk).not.toBeNull()
      if (!fk) continue
      const tcp = flangeToWorldTcpPose(fk, tool).position
      const flangePos = fk.position
      // TCP 到直线的侧向距离。
      const tcpVec = [
        tcp[0] - tcpStartWorld.position[0],
        tcp[1] - tcpStartWorld.position[1],
        tcp[2] - tcpStartWorld.position[2],
      ]
      const proj = tcpVec[0] * unit[0] + tcpVec[1] * unit[1] + tcpVec[2] * unit[2]
      const lateral = Math.hypot(
        tcpVec[0] - proj * unit[0],
        tcpVec[1] - proj * unit[1],
        tcpVec[2] - proj * unit[2],
      )
      maxTcpLateral = Math.max(maxTcpLateral, lateral)
      // 法兰相对 TCP 直线的侧向距离（工具偏移 120mm 使法兰显著偏离 TCP 直线）。
      const fkVec = [
        flangePos[0] - tcpStartWorld.position[0],
        flangePos[1] - tcpStartWorld.position[1],
        flangePos[2] - tcpStartWorld.position[2],
      ]
      const fkProj = fkVec[0] * unit[0] + fkVec[1] * unit[1] + fkVec[2] * unit[2]
      const fkLateral = Math.hypot(
        fkVec[0] - fkProj * unit[0],
        fkVec[1] - fkProj * unit[1],
        fkVec[2] - fkProj * unit[2],
      )
      maxFlangeLateral = Math.max(maxFlangeLateral, fkLateral)
    }
    // TCP 直线：侧向误差应为小量（毫米级）。
    expect(maxTcpLateral).toBeLessThan(0.6)
    // 由于工具前伸 + 路径方向，法兰不应与 TCP 轨迹重合。
    expect(maxFlangeLateral).toBeGreaterThan(5)
  })
})

describe('Ticket 02 — 自定义 Tool/WObj 旋转驱动法兰目标与 FK/IK（rotation 分支）', () => {
  // 工具 tframe 绕其局部 Z 旋转 90° 并沿局部 X 前伸 10mm：法兰目标相对 tool0 应既平移又旋转。
  const ROT_Z90: RobTarget['rot'] = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
  const rotTool: ToolData = {
    robhold: true,
    tframe: { trans: [10, 0, 0], rot: ROT_Z90 },
    tload: { mass: 0.2, cog: [0, 0, 20], aom: [1, 0, 0, 0], ix: 0, iy: 0, iz: 0 },
  }

  it('旋转工具：法兰目标相对 tool0 在位置与姿态上都改变，MoveJ FK/实际 TCP 一致（票据 02 旋转分支）', () => {
    const baseT = fkT(homeFk())
    const flangeRot = robTargetToFlangePose(baseT, defaultWobj0(), rotTool)
    const flangeTool0 = robTargetToFlangePose(baseT, defaultWobj0(), defaultTool0())
    // 位置改变（工具非对称偏移）且姿态改变。
    expect(posErr(flangeRot.position, flangeTool0.position)).toBeGreaterThan(1)
    expect(
      Math.hypot(...orientationError(flangeRot.rotation, flangeTool0.rotation)),
    ).toBeGreaterThan(0.1)

    // 端到端 MoveJ：法兰 FK 落点 ≈ 换算后的法兰目标。
    const plan = planMoveJ(makeMoveJ(baseT, rotTool, defaultWobj0()), MODEL, HOME, JOINT_RANGES, {
      preserveConfiguration: false,
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const fk = MODEL.forwardKinematics(plan.joints)
    expect(fk).not.toBeNull()
    if (fk) {
      expect(posErr(fk.position, flangeRot.position)).toBeLessThanOrEqual(1)
      expect(Math.hypot(...orientationError(fk.rotation, flangeRot.rotation))).toBeLessThan(0.01)
    }
    // TCP 到点：换算回的世界 TCP ≈ 目标世界 TCP。
    const fkFinal = MODEL.forwardKinematics(plan.joints)
    const tcp = fkFinal ? flangeToWorldTcpPose(fkFinal, rotTool).position : [999, 999, 999]
    expect(posErr(tcp, robTargetToWorldPose(baseT, defaultWobj0()).position)).toBeLessThan(1)
  })

  it('旋转 wobj（uframe 绕 Y 90°）：同一 robtarget 的法兰目标相对 wobj0 平移改变（票据 02 旋转分支）', () => {
    const baseT = fkT(homeFk())
    const rotWobj: WobjData = {
      ...defaultWobj0(),
      uframe: { trans: [0, 0, 0], rot: [Math.SQRT1_2, 0, Math.SQRT1_2, 0] },
    }
    const flangeRot = robTargetToFlangePose(baseT, rotWobj, defaultTool0())
    const flangeTool0 = robTargetToFlangePose(baseT, defaultWobj0(), defaultTool0())
    // 旋转用户坐标系使同一 robtarget 的法兰目标移动且姿态改变（核心验收：旋转影响法兰目标）。
    expect(posErr(flangeRot.position, flangeTool0.position)).toBeGreaterThan(1)
    expect(
      Math.hypot(...orientationError(flangeRot.rotation, flangeTool0.rotation)),
    ).toBeGreaterThan(0.1)

    // 旋转可能使目标超出 HOME 可达域；可达则端到端验证 FK 落点等于换算目标。
    const plan = planMoveJ(makeMoveJ(baseT, defaultTool0(), rotWobj), MODEL, HOME, JOINT_RANGES)
    if (plan.ok) {
      const fk = MODEL.forwardKinematics(plan.joints)
      expect(fk).not.toBeNull()
      if (fk) expect(posErr(fk.position, flangeRot.position)).toBeLessThanOrEqual(1)
    }
  })
})

describe('Ticket 02 — 不可支持的配置明确拒绝', () => {
  const baseT = fkT(homeFk())

  const robholdFalseTool: ToolData = { ...defaultTool0(), robhold: false }
  const robholdTrueWobj: WobjData = { ...defaultWobj0(), robhold: true }
  const movableUfprogWobj: WobjData = { ...defaultWobj0(), ufprog: false }
  const mechUfmecWobj: WobjData = { ...defaultWobj0(), ufmec: 'mech1' }

  const cases: Array<[string, ToolData, WobjData]> = [
    ['静止工具 robhold=FALSE', robholdFalseTool, defaultWobj0()],
    ['机器人持工件 robhold=TRUE', defaultTool0(), robholdTrueWobj],
    ['可移动用户坐标 ufprog=FALSE', defaultTool0(), movableUfprogWobj],
    ['协调机械单元 ufmec 非空', defaultTool0(), mechUfmecWobj],
  ]

  for (const [label, tool, wobj] of cases) {
    it(label + ' → unsupported-option', () => {
      const plan = planMoveJ(makeMoveJ(baseT, tool, wobj), MODEL, HOME, JOINT_RANGES)
      expect(plan.ok).toBe(false)
      if (!plan.ok) expect(plan.error.kind).toBe('unsupported-option')
    })
  }
})
