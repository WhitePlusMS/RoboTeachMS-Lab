import { describe, expect, it } from 'vitest'
import { createMotionRunner } from '../robot/motion-runner'
import { ManualMotionClock } from '../robot/manual-motion-clock'
import { AbbDhRobotModel } from '../../robots/abb-irb1200/dh-robot-model'
import { ABB_JOINT_RANGES } from '../../robots/abb-irb1200/robot-config'
import { mat3Mul, rotationMatrixToQuaternion } from '../robot/math/rotation3d'
import type { JointAngles } from '../robot/types'
import { executeMoveL, planMoveL } from './movel-planner'
import {
  defaultTool0,
  defaultWobj0,
  defaultZoneFine,
  type RobTarget,
  type RapiDegreeFrame,
  type StructuredMoveL,
} from './rapid-types'

const ABB_MODEL = new AbbDhRobotModel()

function degreeFrameFromPose(
  joints: JointAngles,
): { frame: RapiDegreeFrame; position: [number, number, number] } {
  const pose = ABB_MODEL.forwardKinematics(joints)
  if (!pose) throw new Error('FK 失败')
  const rot = rotationMatrixToQuaternion(pose.rotation)
  return {
    frame: { trans: [...pose.position], rot },
    position: [...pose.position],
  }
}

function makeMoveL(
  target: RobTarget,
  overrides: Partial<StructuredMoveL> = {},
): StructuredMoveL {
  return {
    kind: 'movel',
    target,
    speed: { v_tcp: 100, v_ori: 100, v_leax: 100, v_reax: 100 },
    zone: defaultZoneFine(),
    tool: defaultTool0(),
    wobj: defaultWobj0(),
    ...overrides,
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

describe('planMoveL 校验与支持边界', () => {
  it('非有限数值与非正速度返回 invalid-data，非默认配置返回 unsupported-option', () => {
    const { frame } = degreeFrameFromPose([0, 0, 0, 0, 0, 0])
    const base = makeMoveL({ trans: [460, 700, 10], rot: frame.rot, robconf: [0, 0, 0, 0], extax: [0, 0, 0, 0, 0, 0] })

    const nonFinite = planMoveL(
      makeMoveL({ ...base.target, trans: [NaN, 700, 10] }),
      ABB_MODEL,
      [0, 0, 0, 0, 0, 0],
      ABB_JOINT_RANGES,
    )
    expect(nonFinite.ok).toBe(false)
    if (!nonFinite.ok) expect(nonFinite.error.kind).toBe('invalid-data')

    const nonPositive = planMoveL(
      makeMoveL(base.target, { speed: { v_tcp: 0, v_ori: 100, v_leax: 100, v_reax: 100 } }),
      ABB_MODEL,
      [0, 0, 0, 0, 0, 0],
      ABB_JOINT_RANGES,
    )
    expect(nonPositive.ok).toBe(false)
    if (!nonPositive.ok) expect(nonPositive.error.kind).toBe('invalid-data')

    const zone = { ...defaultZoneFine(), finep: false }
    const nonFine = planMoveL(
      makeMoveL(base.target, { zone }),
      ABB_MODEL,
      [0, 0, 0, 0, 0, 0],
      ABB_JOINT_RANGES,
    )
    expect(nonFine.ok).toBe(false)
    if (!nonFine.ok) expect(nonFine.error.kind).toBe('unsupported-option')

    const extAx: RobTarget = { ...base.target, extax: [1, 0, 0, 0, 0, 0] }
    const externalAxis = planMoveL(
      makeMoveL(extAx),
      ABB_MODEL,
      [0, 0, 0, 0, 0, 0],
      ABB_JOINT_RANGES,
    )
    expect(externalAxis.ok).toBe(false)
    if (!externalAxis.ok) expect(externalAxis.error.kind).toBe('unsupported-option')
  })
})

describe('planMoveL 5 mm 位置保持直线', () => {
  it('5mm 世界坐标点动 MoveL 的横向误差与终点误差满足现有路径阈值', async () => {
    const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
    const start = degreeFrameFromPose(startJoints)
    const target: RobTarget = {
      trans: [start.position[0] + 5, start.position[1], start.position[2]],
      rot: start.frame.rot,
      robconf: [0, 0, 0, 0],
      extax: [0, 0, 0, 0, 0, 0],
    }

    const plan = planMoveL(makeMoveL(target), ABB_MODEL, startJoints, ABB_JOINT_RANGES)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const poses = plan.waypoints.map((joints) => ABB_MODEL.forwardKinematics(joints))
    const maxCrossTrack = Math.max(...poses.map((pose) => Math.hypot(
      pose.position[1] - start.position[1],
      pose.position[2] - start.position[2],
    )))
    const endpoint = poses[poses.length - 1]
    expect(maxCrossTrack).toBeLessThan(0.5)
    expect(Math.hypot(
      endpoint.position[0] - target.trans[0],
      endpoint.position[1] - target.trans[1],
      endpoint.position[2] - target.trans[2],
    )).toBeLessThan(0.2)

    // 整组 waypoint 通过轨迹入口一次性提交并完成。
    const clock = new ManualMotionClock()
    let joints: JointAngles = [...startJoints]
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => { joints = [...next] },
    })
    let trajectoryCalls = 0
    const outcomePromise = executeMoveL(makeMoveL(target), {
      model: ABB_MODEL,
      currentJoints: () => joints,
      jointRanges: ABB_JOINT_RANGES,
      runTrajectory: (waypoints, durationMs) => {
        trajectoryCalls += 1
        return runner.startTrajectory(waypoints, durationMs)
      },
    })
    clock.advanceBy(1000)
    const outcome = await outcomePromise
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result).toBe('completed')
    expect(trajectoryCalls).toBe(1)
  })
})

describe('planMoveL 带姿态变化保持连续 waypoint', () => {
  it('10 度姿态 MoveL 拆成连续小角度 waypoint，且不超最大关节步长', () => {
    const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
    const start = degreeFrameFromPose(startJoints)
    const angle = (10 * Math.PI) / 180
    const worldZ = [
      [Math.cos(angle), -Math.sin(angle), 0],
      [Math.sin(angle), Math.cos(angle), 0],
      [0, 0, 1],
    ]
    const startRotation = ABB_MODEL.forwardKinematics(startJoints)!.rotation
    const targetRot = rotationMatrixToQuaternion(mat3Mul(worldZ, startRotation))
    const target: RobTarget = {
      // 位置带 10mm 平移以提升可解性；姿态改变 10°。
      trans: [start.position[0] + 10, start.position[1], start.position[2]],
      rot: targetRot,
      robconf: [0, 0, 0, 0],
      extax: [0, 0, 0, 0, 0, 0],
    }

    const plan = planMoveL(makeMoveL(target), ABB_MODEL, startJoints, ABB_JOINT_RANGES)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.waypoints.length).toBeGreaterThanOrEqual(10)
    expect(maxJointStep(plan.waypoints)).toBeLessThanOrEqual(5)
  })
})

describe('executeMoveL 控制与时长', () => {
  it('运动中停止返回 stopped，停止后不再推进剩余轨迹', async () => {
    const startJoints: JointAngles = [0, 0, 0, 0, 0, 0]
    const start = degreeFrameFromPose(startJoints)
    const target: RobTarget = {
      trans: [start.position[0] + 5, start.position[1], start.position[2]],
      rot: start.frame.rot,
      robconf: [0, 0, 0, 0],
      extax: [0, 0, 0, 0, 0, 0],
    }
    const clock = new ManualMotionClock()
    let joints: JointAngles = [...startJoints]
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => { joints = [...next] },
    })
    const outcomePromise = executeMoveL(makeMoveL(target, { speed: { v_tcp: 1, v_ori: 100, v_leax: 100, v_reax: 100 } }), {
      model: ABB_MODEL,
      currentJoints: () => joints,
      jointRanges: ABB_JOINT_RANGES,
      runTrajectory: (waypoints, durationMs) => runner.startTrajectory(waypoints, durationMs),
    })
    clock.advanceBy(100)
    runner.stop()
    const stoppedAt = [...joints]
    clock.advanceBy(5000)

    expect(joints).toEqual(stoppedAt)
    const outcome = await outcomePromise
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result).toBe('stopped')
  })

  it('零距离 MoveL 有确定行为：单 waypoint、时长被钳位且保持关节不变', async () => {
    const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
    const start = degreeFrameFromPose(startJoints)
    const target: RobTarget = {
      trans: start.position,
      rot: start.frame.rot,
      robconf: [0, 0, 0, 0],
      extax: [0, 0, 0, 0, 0, 0],
    }
    const plan = planMoveL(makeMoveL(target), ABB_MODEL, startJoints, ABB_JOINT_RANGES)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.waypoints.length).toBe(1)
    expect(plan.durationMs).toBe(1)

    const clock = new ManualMotionClock()
    let joints: JointAngles = [...startJoints]
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => { joints = [...next] },
    })
    const outcomePromise = executeMoveL(makeMoveL(target), {
      model: ABB_MODEL,
      currentJoints: () => joints,
      jointRanges: ABB_JOINT_RANGES,
      runTrajectory: (waypoints, durationMs) => runner.startTrajectory(waypoints, durationMs),
    })
    clock.advanceBy(10)
    const outcome = await outcomePromise
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.result).toBe('completed')
    expect(joints).toEqual(startJoints)
  })

  it('v_tcp 按声明公式改变整条轨迹时长', () => {
    const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
    const start = degreeFrameFromPose(startJoints)
    const target: RobTarget = {
      trans: [start.position[0] + 30, start.position[1], start.position[2] + 20],
      rot: start.frame.rot,
      robconf: [0, 0, 0, 0],
      extax: [0, 0, 0, 0, 0, 0],
    }
    const slow = planMoveL(makeMoveL(target), ABB_MODEL, startJoints, ABB_JOINT_RANGES)
    const fast = planMoveL(
      makeMoveL(target, { speed: { v_tcp: 200, v_ori: 100, v_leax: 100, v_reax: 100 } }),
      ABB_MODEL,
      startJoints,
      ABB_JOINT_RANGES,
    )
    expect(slow.ok && fast.ok).toBe(true)
    if (slow.ok && fast.ok) {
      expect(slow.durationMs).toBeCloseTo(fast.durationMs * 2, 6)
    }
  })

  it('不可达 / 构型跳变规划失败发生在运动启动前，runTrajectory 不被调用', async () => {
    const startJoints: JointAngles = [-129.4, 58.4, -30.4, -148.6, -66.7, 35.2]
    const start = degreeFrameFromPose(startJoints)
    const target: RobTarget = {
      trans: [start.position[0], start.position[1], start.position[2] + 5],
      rot: start.frame.rot,
      robconf: [0, 0, 0, 0],
      extax: [0, 0, 0, 0, 0, 0],
    }
    let runTrajectoryCalls = 0
    const outcome = await executeMoveL(makeMoveL(target), {
      model: ABB_MODEL,
      currentJoints: () => startJoints,
      jointRanges: ABB_JOINT_RANGES,
      runTrajectory: () => {
        runTrajectoryCalls += 1
        return Promise.resolve('completed' as const)
      },
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error.kind).toBe('unreachable')
    expect(runTrajectoryCalls).toBe(0)
  })
})
