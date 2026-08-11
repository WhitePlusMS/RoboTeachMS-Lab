import { describe, expect, it } from 'vitest'
import { createMotionRunner } from '../robot/motion-runner'
import { ManualMotionClock } from '../robot/manual-motion-clock'
import { AbbDhRobotModel } from '../../robots/abb-irb1200/dh-robot-model'
import { ABB_JOINT_RANGES } from '../../robots/abb-irb1200/robot-config'
import type { JointAngles } from '../robot/types'
import { executeMoveJ, planMoveJ } from './movej-planner'
import {
  defaultTool0,
  defaultWobj0,
  defaultZoneFine,
  type RobTarget,
  type StructuredMoveJ,
  type ToolData,
} from './rapid-types'

const ABB_MODEL = new AbbDhRobotModel()
const AT_HOME: JointAngles = [0, 0, 0, 0, 0, 0]

/** 固定可达 robtarget：从 home [451,713,0] 移动到 [500,600,100]，单位四元数姿态。 */
const REACHABLE_TARGET: RobTarget = {
  trans: [500, 600, 100],
  rot: [0, 0, 0, 1],
  robconf: [0, 0, 0, 0],
  extax: [0, 0, 0, 0, 0, 0],
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
      frame: { trans: [0, 0, 0], rot: [0, 0, 1, 0] },
      tload: { mass: 0, cog: [0, 0, 0], aom: [0, 0, 0] },
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
      // home → [500,600,100] 直线距离约 158.6mm，v_tcp=100 → 约 1586ms。
      const distance = Math.hypot(500 - 451, 600 - 713.197792, 100 - 0)
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
      // 单位四元数姿态 → 终点姿态接近单位旋转（euler ZYX ≈ 0）。
      expect(Math.abs(endPose.euler[0])).toBeLessThan(1e-3)
      expect(Math.abs(endPose.euler[1])).toBeLessThan(1e-3)
      expect(Math.abs(endPose.euler[2])).toBeLessThan(1e-3)
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
      rot: [0, 0, 0, 1],
      robconf: [0, 0, 0, 0],
      extax: [0, 0, 0, 0, 0, 0],
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
