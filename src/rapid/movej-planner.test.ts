import { describe, expect, it } from 'vitest'
import { createMotionRunner } from '../robotics/motion-runner.ts'
import { ManualMotionClock } from '../testing/manual-motion-clock.ts'
import { AbbDhRobotModel } from '../robot-models/abb-irb1200/dh-robot-model.ts'
import { ABB_JOINT_RANGES } from '../robot-models/abb-irb1200/robot-config.ts'
import type { JointAngles } from '../robotics/types.ts'
import { executeMoveJ, planMoveJ } from './movej-planner.ts'
import { robTargetToPose } from './plan-shared.ts'
import { orientationError } from '../robotics/math/rotation3d.ts'
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
    const result = planMoveJ(makeMoveJ({ target: invalidTrans }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
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

  it('非默认工具返回 unsupported-option', () => {
    const customTool: ToolData = {
      robhold: true,
      tframe: { trans: [0, 0, 0], rot: [1, 0, 0, 0] },
      tload: { mass: 1, cog: [0, 0, 0], aom: [1, 0, 0, 0], ix: 0, iy: 0, iz: 0 },
    }
    const result = planMoveJ(makeMoveJ({ tool: customTool }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('unsupported-option')
      expect(result.error.message).toContain('tool0')
    }
  })

  it('非 fine zone 返回 unsupported-option', () => {
    const zone = { ...defaultZoneFine(), finep: false }
    const result = planMoveJ(makeMoveJ({ zone }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('unsupported-option')
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
      setJoints: (next) => { joints = [...next] },
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
      setJoints: (next) => { joints = [...next] },
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
    expect(planMoveJ(makeMoveJ({ target: wrongTrans }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES).ok).toBe(false)
    expect(planMoveJ(makeMoveJ({ target: wrongRot }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES).ok).toBe(false)
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
      expect(result.error.message).toContain('wobj0')
    }
  })

  it('非默认工具 frame 返回 unsupported-option（frame 分支）', () => {
    const tool: ToolData = {
      robhold: true,
      tframe: { trans: [10, 0, 0], rot: [1, 0, 0, 0] },
      tload: { mass: 0, cog: [0, 0, 0], aom: [1, 0, 0, 0], ix: 0, iy: 0, iz: 0 },
    }
    const result = planMoveJ(makeMoveJ({ tool }), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('unsupported-option')
  })
})
