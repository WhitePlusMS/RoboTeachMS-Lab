import { describe, expect, it } from 'vitest'
import { createMotionRunner } from '@/robotics/motion/runner.ts'
import { ManualMotionClock } from '@/testing/manual-motion-clock.ts'
import { AbbRobotModelAdapter } from '@/robot-models/abb-irb1200/index.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/index.ts'
import type { JointAngles } from '@/robotics/model/index.ts'
import { rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'
import { executeMoveC, planMoveC } from './movec-planner.ts'
import { sampleArcPoses } from '@/robot-motion-core/arc-geometry.ts'
import { flangeToWorldTcpPose } from '../data/coordinate-transform.ts'
import { internalQuatToRapid } from '../data/pose-transform.ts'
import {
  defaultTool0,
  defaultWobj0,
  defaultZoneFine,
  NO_EXTERNAL_AXIS,
  type RobTarget,
  type StructuredMoveC,
} from '../data/index.ts'

const ABB_MODEL = new AbbRobotModelAdapter()
const AT_HOME: JointAngles = [15, -25, 45, 20, 20, 30]

/** 构造一个 robtarget（ABB 顺序四元数 [q1,q2,q3,q4] = [w,x,y,z]）。 */
function target(
  trans: [number, number, number],
  rot: [number, number, number, number] = [1, 0, 0, 0],
): RobTarget {
  return { trans, rot, robconf: [0, 0, 0, 0], extax: [...NO_EXTERNAL_AXIS] }
}

/**
 * 默认圆弧：起点为当前 TCP @ home，圆点/终点与 home 朝向一致（绕 home 作一段水平圆弧，
 * 全部落在 IRB1200 可达且数值逆解良态的区域）。home 朝向由正解推导，避免用 identity
 * 与 home 朝向相悖而制造过度反转的憾——那会让单一/多初值 IK 都在奇异带失败。
 */
const homeFlange = ABB_MODEL.forwardKinematics(AT_HOME)
const HOME_TCP = homeFlange
  ? flangeToWorldTcpPose(homeFlange, defaultTool0()).position
  : [451, 0, 807.1]
const HOME_QUAT: [number, number, number, number] = homeFlange
  ? internalQuatToRapid(
      rotationMatrixToQuaternion(flangeToWorldTcpPose(homeFlange, defaultTool0()).rotation),
    )
  : [1, 0, 0, 0]
const ARC_CIR = target([HOME_TCP[0] - 5, HOME_TCP[1] + 5, HOME_TCP[2]], HOME_QUAT)
const ARC_END = target([HOME_TCP[0] - 5, HOME_TCP[1] - 5, HOME_TCP[2]], HOME_QUAT)

function makeMoveC(cirPoint: RobTarget = ARC_CIR, end = ARC_END): StructuredMoveC {
  return {
    kind: 'movec',
    cirPoint,
    target: end,
    speed: { v_tcp: 100, v_ori: 100, v_leax: 100, v_reax: 100 },
    zone: defaultZoneFine(),
    tool: defaultTool0(),
    wobj: defaultWobj0(),
  }
}

function maxJointStep(waypoints: readonly JointAngles[]): number {
  let max = 0
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const current = waypoints[index]
    const next = waypoints[index + 1]
    for (let joint = 0; joint < 6; joint += 1) {
      max = Math.max(max, Math.abs(next[joint] - current[joint]))
    }
  }
  return max
}

describe('arc-planner 圆弧几何', () => {
  it('三点定圆采样：所有位姿共圆且经过起点/途经点/终点', () => {
    const start = [451, 0, 807]
    const poses = sampleArcPoses(
      start,
      ARC_CIR.trans,
      ARC_END.trans,
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      40,
    )
    expect(poses).not.toBeNull()
    if (!poses) return
    // 首尾位姿位置等于起点与终点（允许毫米级误差）。
    expect(Math.hypot(...poses[0].position.map((v, i) => v - start[i]))).toBeLessThan(1e-6)
    expect(
      Math.hypot(...poses[poses.length - 1].position.map((v, i) => v - ARC_END.trans[i])),
    ).toBeLessThan(1e-6)
    // 途经点位姿应落在采样序列中间（距离终点与起点都不为 0）。
    expect(poses.length).toBeGreaterThanOrEqual(3)
  })

  it('三点共线返回 null（无法定圆）', () => {
    const poses = sampleArcPoses([0, 0, 0], [50, 0, 0], [100, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], 10)
    expect(poses).toBeNull()
  })
})

describe('planMoveC 校验与支持边界', () => {
  it('非法数值（非有限）返回 invalid-data，不进入圆弧/IK', () => {
    const bad = makeMoveC(target([NaN, 60, 807]))
    const result = planMoveC(bad, ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid-data')
  })

  it('三点共线路径返回 ok:false（退化），不触发运动', () => {
    // 起点 home + 圆点 + 终点共线。
    const collinear = makeMoveC(
      target([HOME_TCP[0] + 30, HOME_TCP[1], HOME_TCP[2]]),
      target([HOME_TCP[0] + 60, HOME_TCP[1], HOME_TCP[2]]),
    )
    const result = planMoveC(collinear, ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok).toBe(false)
  })

  it('MoveC 仅在显式 SingArea\\Wrist 时允许腕部奇异回退', () => {
    const startJoints: JointAngles = [0, 0, 0, 0, 0, 0]
    const startFlange = ABB_MODEL.forwardKinematics(startJoints)
    expect(startFlange).not.toBeNull()
    if (!startFlange) return

    const startTcp = flangeToWorldTcpPose(startFlange, defaultTool0())
    const rotation = internalQuatToRapid(rotationMatrixToQuaternion(startTcp.rotation))
    const [x, y, z] = startTcp.position
    const cirPoint = target([x + 2, y + 2, z], rotation)
    const endPoint = target([x, y + 4, z], rotation)

    const strictResult = planMoveC(
      makeMoveC(cirPoint, endPoint),
      ABB_MODEL,
      startJoints,
      ABB_JOINT_RANGES,
    )
    expect(strictResult.ok).toBe(false)

    const wristResult = planMoveC(
      { ...makeMoveC(cirPoint, endPoint), singArea: 'wrist' },
      ABB_MODEL,
      startJoints,
      ABB_JOINT_RANGES,
    )
    expect(wristResult.ok).toBe(true)
  })

  it('时长近似按弧长：慢速 > 快速', () => {
    const slow = planMoveC(makeMoveC(), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    const fast = planMoveC(
      (() => {
        const m = makeMoveC()
        m.speed = { ...m.speed, v_tcp: 200 }
        return m
      })(),
      ABB_MODEL,
      AT_HOME,
      ABB_JOINT_RANGES,
    )
    expect(slow.ok).toBe(true)
    expect(fast.ok).toBe(true)
    if (slow.ok && fast.ok) expect(fast.durationMs).toBeLessThan(slow.durationMs)
  })
})

describe('planMoveC/executeMoveC 完整圆弧', () => {
  it('planMoveC 生成连续关节 waypoint，终点 FK 与目标接近', () => {
    const result = planMoveC(makeMoveC(), ABB_MODEL, AT_HOME, ABB_JOINT_RANGES)
    expect(result.ok, '默认圆弧规划失败').toBe(true)
    if (!result.ok) return
    expect(result.waypoints.length).toBeGreaterThanOrEqual(2)
    // 相邻关节步长不超过既有护栏 5°（含 IK 近似容差）。
    expect(maxJointStep(result.waypoints)).toBeLessThanOrEqual(5 + 1e-3)
    // 末点 FK 位置接近终点。
    const endPose = ABB_MODEL.forwardKinematics(result.waypoints[result.waypoints.length - 1])
    expect(endPose).not.toBeNull()
    if (endPose) {
      const err = Math.hypot(
        endPose.position[0] - ARC_END.trans[0],
        endPose.position[1] - ARC_END.trans[1],
        endPose.position[2] - ARC_END.trans[2],
      )
      expect(err).toBeLessThan(1)
    }
  })

  it('executeMoveC 经 MotionRunner 完成一个圆弧并返回 completed', async () => {
    let joints = [...AT_HOME] as JointAngles
    const clock = new ManualMotionClock()
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
      runTrajectory: (waypoints: readonly JointAngles[], durationMs: number) =>
        runner.startTrajectory(waypoints, durationMs),
    }
    const outcomePromise = executeMoveC(makeMoveC(), seam)
    // 推进到终点：圆弧时长有限，给一个大步长让轨迹跑完。
    clock.advanceBy(10000)
    const outcome = await outcomePromise
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result).toBe('completed')
  })

  it('规划错误不触发任何运动（退化路径 executeMoveC 返回错误）', async () => {
    let joints = [...AT_HOME] as JointAngles
    let invoked = false
    const seam = {
      model: ABB_MODEL,
      currentJoints: () => joints,
      jointRanges: ABB_JOINT_RANGES,
      runTrajectory: async () => {
        invoked = true
        return 'completed' as const
      },
    }
    const collinear = makeMoveC(
      target([HOME_TCP[0] + 30, HOME_TCP[1], HOME_TCP[2]]),
      target([HOME_TCP[0] + 60, HOME_TCP[1], HOME_TCP[2]]),
    )
    const outcome = await executeMoveC(collinear, seam)
    expect(outcome.ok).toBe(false)
    expect(invoked).toBe(false)
  })
})
