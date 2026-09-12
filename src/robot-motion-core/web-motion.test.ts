import { describe, expect, it } from 'vitest'
import { DEFAULT_ROBOT, robotIdentity } from '@/robot-models/registry.ts'
import type { RobotProfile } from '@/robot-geometry/robot-types.ts'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import { rotationMatrixToQuaternion, mat3Mul } from '@/robot-geometry/math/rotation3d.ts'
import { eulerZYXToMatrix } from '@/robot-geometry/math/transform-matrix.ts'
import { planMotion } from './motion-planner.ts'
import type { MotionPlanningRequest, PoseData } from './contracts.ts'

const initial: JointAngles = [15, -20, 30, 10, 25, -15]
const flange = DEFAULT_ROBOT.model.forwardKinematics(initial)!
const identity: PoseData = { positionMm: [0, 0, 0], quaternionWxyz: [1, 0, 0, 0] }
function data(pose: Pose): PoseData {
  const q = rotationMatrixToQuaternion(pose.rotation)
  return { positionMm: [...pose.position], quaternionWxyz: [q[3], q[0], q[1], q[2]] }
}
function request(target: PoseData): MotionPlanningRequest {
  return {
    schemaVersion: 1,
    robot: robotIdentity(DEFAULT_ROBOT),
    state: { jointsDeg: initial },
    intent: {
      kind: 'linear-path',
      targetTcpPose: target,
      speedMmPerSec: 10,
      speedOriDegPerSec: 10,
      tool: { robhold: true, tcpInFlange: identity },
      workObject: {
        robhold: false,
        userFrame: identity,
        objectFrame: identity,
        ufprog: true,
        ufmec: '',
      },
      configurationPolicy: { kind: 'nearest-valid' },
      singularityPolicy: 'strict',
      zone: 'fine',
    },
  }
}

describe('Web 核心运动语义', () => {
  it('MoveJ 只要求目标 IK；不查询中间 TCP 位姿逆解', () => {
    const targetJoints: JointAngles = [90, -20, 30, 10, 25, -15]
    const target = DEFAULT_ROBOT.model.forwardKinematics(targetJoints)!
    const queried: Pose[] = []
    // 此替身只允许终点逆解，能检测 MoveJ 是否意外经过直线候选图。
    const profile: RobotProfile = {
      ...DEFAULT_ROBOT,
      model: {
        isAvailable: () => true,
        forwardKinematics: (joints) => DEFAULT_ROBOT.model.forwardKinematics(joints),
        estimateJacobian: (joints) => DEFAULT_ROBOT.model.estimateJacobian(joints),
        deriveConfiguration: (joints) => DEFAULT_ROBOT.model.deriveConfiguration!(joints),
        configurationForRepresentation: (config, joints) =>
          DEFAULT_ROBOT.model.configurationForRepresentation!(config, joints),
        solveAllIK: (pose) => {
          queried.push(pose)
          expect(Math.hypot(...pose.position.map((v, i) => v - target.position[i]))).toBeLessThan(
            1e-8,
          )
          return DEFAULT_ROBOT.model.solveAllIK!(pose, initial)
        },
      },
    }
    const base = request(data(target))
    if (base.intent.kind !== 'linear-path') throw new Error('test intent')
    const result = planMotion(
      { ...base, intent: { ...base.intent, kind: 'pose-joint-target' } },
      profile,
    )
    expect(result.ok).toBe(true)
    expect(queried).toHaveLength(1)
  })

  it('直线速度翻倍使真实计划时间减半', () => {
    const base = request(
      data({
        ...flange,
        position: [flange.position[0] + 10, flange.position[1], flange.position[2]],
      }),
    )
    const slow = planMotion(base)
    if (base.intent.kind !== 'linear-path') throw new Error('test intent')
    const fast = planMotion({ ...base, intent: { ...base.intent, speedMmPerSec: 20 } })
    expect(slow.ok && fast.ok).toBe(true)
    if (!slow.ok || !fast.ok) return
    expect(slow.waypoints.at(-1)!.timeMs).toBeCloseTo(1000)
    expect(fast.waypoints.at(-1)!.timeMs).toBeCloseTo(500)
  })

  it('纯姿态运动按姿态速度计时，不能退化为采样点数毫秒', () => {
    const target = {
      ...flange,
      rotation: mat3Mul(eulerZYXToMatrix([0, 0, Math.PI / 180]), flange.rotation),
    }
    const result = planMotion(request(data(target)))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.waypoints.at(-1)!.timeMs).toBeCloseTo(100, 0)
  })

  it('非默认工具与工件坐标的残差在同一 TCP 坐标下计算', () => {
    const offset = [20, 0, 0]
    const worldTcp = flange.position.map(
      (v, i) => v + flange.rotation[i].reduce((sum, r, j) => sum + r * offset[j], 0),
    ) as Pose['position']
    const base = request(
      data({ ...flange, position: [worldTcp[0] + 5 - 100, worldTcp[1], worldTcp[2]] }),
    )
    if (base.intent.kind !== 'linear-path') throw new Error('test intent')
    const result = planMotion({
      ...base,
      intent: {
        ...base.intent,
        tool: { robhold: true, tcpInFlange: { ...identity, positionMm: [20, 0, 0] } },
        workObject: {
          ...base.intent.workObject,
          userFrame: { ...identity, positionMm: [100, 0, 0] },
        },
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.validation.tcpResidualMm).toBeLessThan(0.05)
  })

  it('规划使用注入模型的限位且拒绝版本错配', () => {
    const [, j2, j3, j4, j5, j6] = DEFAULT_ROBOT.jointRanges
    const profile: RobotProfile = {
      ...DEFAULT_ROBOT,
      id: 'test-tight-range',
      revision: 'test',
      jointRanges: [[-1, 1], j2, j3, j4, j5, j6],
    }
    const base: MotionPlanningRequest = {
      schemaVersion: 1,
      robot: robotIdentity(profile),
      state: { jointsDeg: [0, 0, 0, 0, 30, 0] },
      intent: { kind: 'joint-target', targetJointsDeg: [2, 0, 0, 0, 30, 0] },
    }
    expect(planMotion(base, profile)).toMatchObject({ ok: false, error: { code: 'joint-limit' } })
    expect(
      planMotion({ ...base, robot: { ...base.robot, modelRevision: 'other' } }, profile),
    ).toMatchObject({ ok: false, error: { code: 'unsupported-model' } })
  })
})
