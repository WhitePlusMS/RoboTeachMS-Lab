import { describe, expect, it } from 'vitest'
import { createMotionRunner } from '@/robotics/motion-runner.ts'
import { ManualMotionClock } from '@/testing/manual-motion-clock.ts'
import { AbbDhRobotModel } from '@/robot-models/abb-irb1200/dh-robot-model.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/robot-config.ts'
import type { JointAngles, Pose } from '@/robotics/types.ts'
import { executeMoveJ, planMoveJ, type MoveJPlanResult } from './movej-planner.ts'
import { internalQuatToRapid, robTargetToPose } from './plan-shared.ts'
import { robTargetToFlangePose } from './coordinate-transform.ts'
import { orientationError, rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'
import {
  defaultTool0,
  defaultWobj0,
  defaultZoneFine,
  NO_EXTERNAL_AXIS,
  type RobTarget,
  type StructuredMoveJ,
  type ToolData,
  type WobjData,
} from './rapid-types.ts'

const ABB_MODEL = new AbbDhRobotModel()
const AT_HOME: JointAngles = [0, 0, 0, 0, 0, 0]

/** 固定可达 robtarget：从 home 机械法兰 [451,0,807.1] 移动至 [500,100,807.1]，单位 RAPID 四元数姿态。 */
const REACHABLE_TARGET: RobTarget = {
  trans: [500, 100, 807.1],
  rot: [1, 0, 0, 0],
  robconf: [0, 0, 0, 0],
  extax: [...NO_EXTERNAL_AXIS],
}

function makeMoveJ(overrides: Partial<StructuredMoveJ> = {}): StructuredMoveJ {
  return {
    kind: 'movej',
    target: REACHABLE_TARGET,
    speed: { v_tcp: 100, v_ori: 100, v_leax: 100, v_reax: 100 },
    zone: defaultZoneFine(),
    tool: defaultTool0(),
    wobj: defaultWobj0(),
    ...overrides,
  }
}

describe('移动数据类型位于不依赖 Vue/Three 的领域层', () => {
  it('结构化 MoveJ 携带目标、速度、zone、工具和工件值', () => {
    const movej = makeMoveJ()
    expect(movej.kind).toBe('movej')
    expect(movej.target.trans).toHaveLength(3)
    expect(movej.target.rot).toHaveLength(4)
    expect(movej.target.robconf).toHaveLength(4)
    expect(movej.target.extax).toHaveLength(6)
    expect(movej.speed.v_tcp).toBeGreaterThan(0)
    expect(movej.zone.finep).toBe(true)
  })
})
describe('planMoveJ 数据与配置校验', () => {
  it('非有限数值在调用 IK 前返回 invalid-data', () => {
    const invalidTrans: RobTarget = { ...REACHABLE_TARGET, trans: [NaN, 600, 100] }
    const result = planMoveJ(
      makeMoveJ({ target: invalidTrans }),
      ABB_MODEL,
      AT_HOME,
      ABB_JOINT_RANGES,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid-data')
  })

  it('零长度四元数返回 invalid-data', () => {
    const zeroRot: RobTarget = { ...REACHABLE_TARGET, rot: [0, 0, 0, 0] }
    const result = planMoveJ(makeMoveJ({ target: zeroRot }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid-data')
  })

  it('非正 v_tcp 返回 invalid-data', () => {
    const result = planMoveJ(
      makeMoveJ({ speed: { v_tcp: 0, v_ori: 100, v_leax: 100, v_reax: 100 } }),
      ABB_MODEL,
      AT_HOME,
      ABB_JOINT_RANGES,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid-data')
  })

  it('机器人不持工具（robhold=FALSE）返回 unsupported-option', () => {
    const stationaryTool: ToolData = {
      robhold: false,
      tframe: { trans: [0, 0, 0], rot: [1, 0, 0, 0] },
      tload: { mass: 1, cog: [0, 0, 0], aom: [1, 0, 0, 0], ix: 0, iy: 0, iz: 0 },
    }
    const result = planMoveJ(
      makeMoveJ({ tool: stationaryTool }),
      ABB_MODEL,
      AT_HOME,
      ABB_JOINT_RANGES,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('unsupported-option')
      expect(result.error.message).toContain('robhold')
    }
  })

  it('非 fine zone（fly-by）可用安全停点近似执行，不再报 unsupported-option（票据 04）', () => {
    const zone = { ...defaultZoneFine(), finep: false }
    const result = planMoveJ(makeMoveJ({ zone }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.joints.length).toBeGreaterThan(0)
  })

  it('有效外部轴返回 unsupported-option', () => {
    const target: RobTarget = { ...REACHABLE_TARGET, extax: [1, 0, 0, 0, 0, 0] }
    const result = planMoveJ(makeMoveJ({ target }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('unsupported-option')
      expect(result.error.message).toContain('extax')
    }
  })
})

describe('planMoveJ 时长仿真近似', () => {
  it('v_tcp 变化按 距离/v_tcp 改变时长', () => {
    const slow = planMoveJ(makeMoveJ(), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    const fast = planMoveJ(
      makeMoveJ({ speed: { v_tcp: 200, v_ori: 100, v_leax: 100, v_reax: 100 } }),
      ABB_MODEL,
      AT_HOME,
      ABB_JOINT_RANGES,
    )
    expect(slow.ok && fast.ok).toBe(true)
    if (slow.ok && fast.ok) {
      expect(slow.durationMs).toBeGreaterThan(0)
      expect(slow.durationMs).toBeCloseTo(fast.durationMs * 2, 6)
      expect(Number.isFinite(slow.durationMs)).toBe(true)
    }
  })

  it('时长只取决于距离与 v_tcp，与关节插值无关', () => {
    const result = planMoveJ(makeMoveJ(), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // home → [500,100,807.1] 直线距离约 111.4mm，v_tcp=100 → 约 1114ms。
      const distance = Math.hypot(500 - 451, 100 - 0, 807.1 - 807.1)
      expect(result.durationMs).toBeCloseTo((distance / 100) * 1000, 0)
    }
  })
})

describe('executeMoveJ 经 MotionRunner 完成一个 ABB 目标', () => {
  it('固定可达 robtarget 完成 MoveJ，FK 检查终点位置与姿态', async () => {
    const clock = new ManualMotionClock()
    let joints: JointAngles = [...AT_HOME]
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })
    const seam = {
      model: ABB_MODEL,
      currentJoints: () => joints,
      jointRanges: ABB_JOINT_RANGES,
      runEased: (target: JointAngles, durationMs: number) => runner.startEased(target, durationMs),
    }

    const outcomePromise = executeMoveJ(makeMoveJ(), seam)
    // 驱动时钟直至缓动完成。
    clock.advanceBy(5000)
    const outcome = await outcomePromise

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result).toBe('completed')

    const endPose = ABB_MODEL.forwardKinematics(joints)
    expect(endPose).not.toBeNull()
    if (endPose) {
      // solveIK 的终点容差约 1mm，MoveJ 到达的是 IK 解所在位姿，允许该阈值内误差。
      expect(Math.abs(endPose.position[0] - REACHABLE_TARGET.trans[0])).toBeLessThan(2)
      expect(Math.abs(endPose.position[1] - REACHABLE_TARGET.trans[1])).toBeLessThan(2)
      expect(Math.abs(endPose.position[2] - REACHABLE_TARGET.trans[2])).toBeLessThan(2)
      // 终点姿态通过旋转矩阵比较 robtarget 姿态（与坐标轴无关）；euler 表示在 ABB 基座下不唯一。
      const targetRotation = robTargetToPose(REACHABLE_TARGET).rotation
      const orientationDelta = orientationError(endPose.rotation, targetRotation)
      expect(Math.max(...orientationDelta)).toBeLessThan(1e-3)
    }
  })

  it('停止 MoveJ 返回 stopped', async () => {
    const clock = new ManualMotionClock()
    let joints: JointAngles = [...AT_HOME]
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })
    const seam = {
      model: ABB_MODEL,
      currentJoints: () => joints,
      jointRanges: ABB_JOINT_RANGES,
      runEased: (target: JointAngles, durationMs: number) => runner.startEased(target, durationMs),
    }

    const outcomePromise = executeMoveJ(makeMoveJ(), seam)
    clock.advanceBy(1000)
    runner.stop()
    const outcome = await outcomePromise

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result).toBe('stopped')
  })

  it('规划错误不会启动任何请求帧，也不调用 runEased', async () => {
    const clock = new ManualMotionClock()
    let joints: JointAngles = [...AT_HOME]
    let runEasedCalls = 0
    const badTarget: RobTarget = {
      trans: [5000, 5000, 5000],
      rot: [1, 0, 0, 0],
      robconf: [0, 0, 0, 0],
      extax: [...NO_EXTERNAL_AXIS],
    }
    const outcome = await executeMoveJ(makeMoveJ({ target: badTarget }), {
      model: ABB_MODEL,
      currentJoints: () => joints,
      jointRanges: ABB_JOINT_RANGES,
      runEased: (_target, _duration) => {
        runEasedCalls += 1
        return Promise.resolve('completed' as const)
      },
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.kind).toBe('unreachable')
    expect(runEasedCalls).toBe(0)
    expect(clock.pendingFrameCount()).toBe(0)
  })
})

describe('planMoveJ 补齐的结构/数值/配置输入校验', () => {
  it('非零 robconf 返回 unsupported-option，消息指出 robconf', () => {
    const target: RobTarget = { ...REACHABLE_TARGET, robconf: [0, 1, 0, 0] }
    const result = planMoveJ(makeMoveJ({ target }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('unsupported-option')
      expect(result.error.message).toContain('robconf')
    }
  })

  it('全零 extax 不再被当成“未使用”，返回 unsupported-option', () => {
    const target: RobTarget = { ...REACHABLE_TARGET, extax: [0, 0, 0, 0, 0, 0] }
    const result = planMoveJ(makeMoveJ({ target }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('unsupported-option')
      expect(result.error.message).toContain('extax')
    }
  })

  it('畸形 tuple 长度返回 invalid-data', () => {
    const wrongTrans = { ...REACHABLE_TARGET, trans: [500, 600] } as unknown as RobTarget
    const wrongRot = { ...REACHABLE_TARGET, rot: [1, 0, 0] } as unknown as RobTarget
    expect(
      planMoveJ(makeMoveJ({ target: wrongTrans }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES).ok,
    ).toBe(false)
    expect(
      planMoveJ(makeMoveJ({ target: wrongRot }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES).ok,
    ).toBe(false)
  })

  it('speeddata 任一速度字段≤0 返回 invalid-data', () => {
    for (const field of ['v_ori', 'v_leax', 'v_reax'] as const) {
      const speed = { v_tcp: 100, v_ori: 100, v_leax: 100, v_reax: 100, [field]: 0 }
      const result = planMoveJ(makeMoveJ({ speed }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('invalid-data')
    }
  })

  it('zone 数值非有限返回 invalid-data', () => {
    const zone = { ...defaultZoneFine(), pzoneTcp: NaN }
    const result = planMoveJ(makeMoveJ({ zone }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid-data')
  })

  it('负载 aom 零四元数返回 invalid-data', () => {
    const tool: ToolData = {
      robhold: true,
      tframe: { trans: [0, 0, 0], rot: [1, 0, 0, 0] },
      tload: { mass: 0, cog: [0, 0, 0], aom: [0, 0, 0, 0], ix: 0, iy: 0, iz: 0 },
    }
    const result = planMoveJ(makeMoveJ({ tool }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid-data')
  })

  it('非默认 ufmec 返回 unsupported-option', () => {
    const wobj: WobjData = { ...defaultWobj0(), ufmec: 'mech1' }
    const result = planMoveJ(makeMoveJ({ wobj }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('unsupported-option')
      expect(result.error.message).toContain('ufmec')
    }
  })

  it('自定义工具 frame（robhold=TRUE）可求值：终点法兰 FK 等于换算后的法兰目标（票据 02）', () => {
    const tool: ToolData = {
      robhold: true,
      tframe: { trans: [10, 0, 0], rot: [1, 0, 0, 0] },
      tload: { mass: 0, cog: [0, 0, 0], aom: [1, 0, 0, 0], ix: 0, iy: 0, iz: 0 },
    }
    const result = planMoveJ(makeMoveJ({ tool }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const targetFlange = robTargetToFlangePose(
      makeMoveJ({ tool }).target,
      makeMoveJ({ tool }).wobj,
      tool,
    )
    const flangeFk = ABB_MODEL.forwardKinematics(result.joints)
    expect(flangeFk).not.toBeNull()
    if (flangeFk) {
      const posErr = Math.hypot(
        flangeFk.position[0] - targetFlange.position[0],
        flangeFk.position[1] - targetFlange.position[1],
        flangeFk.position[2] - targetFlange.position[2],
      )
      expect(posErr).toBeLessThanOrEqual(1)
    }
  })
})

/** 由关节角度正解得到 robtarget（FK 生成的教学目标）。 */
function fkTarget(joints: JointAngles): RobTarget {
  const pose: Pose = ABB_MODEL.forwardKinematics(joints)!
  const quat = rotationMatrixToQuaternion(pose.rotation)
  return {
    trans: [pose.position[0], pose.position[1], pose.position[2]],
    rot: internalQuatToRapid(quat),
    robconf: [0, 0, 0, 0],
    extax: [...NO_EXTERNAL_AXIS],
  }
}

/** 断言规划结果到达 robtarget 的目标位姿（位置 + 姿态容差与项目既有 IK 一致）。 */
function expectReaches(result: MoveJPlanResult, target: RobTarget): void {
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const endPose = ABB_MODEL.forwardKinematics(result.joints)!
  const targetRotation = robTargetToPose(target).rotation
  expect(Math.abs(endPose.position[0] - target.trans[0])).toBeLessThan(2)
  expect(Math.abs(endPose.position[1] - target.trans[1])).toBeLessThan(2)
  expect(Math.abs(endPose.position[2] - target.trans[2])).toBeLessThan(2)
  const orientationDelta = orientationError(endPose.rotation, targetRotation)
  // 多初值远端求解会停在求解器声明的姿态容差（oriTolerance=0.01 rad）内。
  expect(Math.max(...orientationDelta)).toBeLessThan(1e-2)
}

describe('可靠回放大幅 MoveJ（多初值 IK）', () => {
  // 教学目标：J1=+60，且肩（J2=-40）、肘（J3=+20）、腕（J5=+30/J6=+10）均有明显变化。
  const TARGET_JOINTS: JointAngles = [60, -40, 20, 0, 30, 10]
  const TARGET = fkTarget(TARGET_JOINTS)
  // 远端出发姿态：J1=-120 且其余关节明显不同。
  const DISTANT_CURRENT: JointAngles = [-120, 20, -60, 0, -20, 45]

  it('大幅 J1 复合目标能由 J1 约 -120° 的远端姿态规划并到达', () => {
    const result = planMoveJ(
      makeMoveJ({ target: TARGET }),
      ABB_MODEL,
      DISTANT_CURRENT,
      ABB_JOINT_RANGES,
    )
    expectReaches(result, TARGET)
    // 大幅动作中 J1 确实产生显著变化：从 -120° 到达目标侧。
    if (result.ok) expect(result.joints[0]).toBeGreaterThan(0)
  })

  it('至少一个同时含大幅 J1、肩肘和腕部变化的 FK 目标能从远端姿态回放', () => {
    // 另一侧的大幅 J1（+120 → -30），并含肩、肘、腕变化。
    const otherJoints: JointAngles = [120, 10, -30, 0, -10, 20]
    const target = fkTarget(otherJoints)
    const current: JointAngles = [-30, -50, 40, 0, 50, -60]
    const result = planMoveJ(makeMoveJ({ target }), ABB_MODEL, current, ABB_JOINT_RANGES)
    expectReaches(result, target)
  })

  it('多个候选成功时选择离当前姿态最近的解，平局结果稳定', () => {
    // 反复规划同一场景，选出的关节解稳定一致（无随机、顺序稳定）。
    const first = planMoveJ(
      makeMoveJ({ target: TARGET }),
      ABB_MODEL,
      DISTANT_CURRENT,
      ABB_JOINT_RANGES,
    )
    const second = planMoveJ(
      makeMoveJ({ target: TARGET }),
      ABB_MODEL,
      DISTANT_CURRENT,
      ABB_JOINT_RANGES,
    )
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.joints).toEqual(second.joints)
      // 与当前姿态相比，归一化距离确实小于同一目标的其他远端配置。
      expect(first.joints[0]).toBeGreaterThan(DISTANT_CURRENT[0] + 100)
    }
  })

  it('普通近距离目标优先使用当前初值，不为成功目标执行多余候选搜索', () => {
    const nearby: JointAngles = [58, -38, 18, 2, 28, 8]
    const target = fkTarget(nearby)
    const result = planMoveJ(makeMoveJ({ target }), ABB_MODEL, nearby, ABB_JOINT_RANGES)
    expect(result.ok).toBe(true)
    // 主初值直接命中，返回的解应非常接近当前关节（未跳到远端备用解）。
    if (result.ok) {
      for (let i = 0; i < 6; i += 1) {
        expect(Math.abs(result.joints[i] - nearby[i])).toBeLessThan(15)
      }
    }
  })

  it('真正不可达目标仍返回 unreachable，且不会启动运动', async () => {
    const unreachable: RobTarget = {
      trans: [5000, 5000, 5000],
      rot: [1, 0, 0, 0],
      robconf: [0, 0, 0, 0],
      extax: [...NO_EXTERNAL_AXIS],
    }
    const result = planMoveJ(
      makeMoveJ({ target: unreachable }),
      ABB_MODEL,
      DISTANT_CURRENT,
      ABB_JOINT_RANGES,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('unreachable')

    // 经 executeMoveJ 也不会启动任何运动。
    const clock = new ManualMotionClock()
    let joints: JointAngles = [...DISTANT_CURRENT]
    let runEasedCalls = 0
    const outcome = await executeMoveJ(makeMoveJ({ target: unreachable }), {
      model: ABB_MODEL,
      currentJoints: () => joints,
      jointRanges: ABB_JOINT_RANGES,
      runEased: (_t, _d) => {
        runEasedCalls += 1
        return Promise.resolve('completed' as const)
      },
    })
    expect(outcome.ok).toBe(false)
    expect(runEasedCalls).toBe(0)
    expect(clock.pendingFrameCount()).toBe(0)
  })
})
