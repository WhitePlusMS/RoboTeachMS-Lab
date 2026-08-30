import { describe, expect, it } from 'vitest'
import { AbbRobotModelAdapter } from '@/robot-models/abb-irb1200/index.ts'
import type { JointAngles, Pose } from '@/robot-geometry/model/index.ts'
import { rotationMatrixToQuaternion } from '@/robot-geometry/math/rotation3d.ts'
import { planMotion, type MotionPlanningRequest, type ABBConfigurationData, type PoseData, type ConfigurationPolicy } from './index.ts'

const home: MotionPlanningRequest = {
  schemaVersion: 1,
  robot: { modelId: 'abb-irb1200-5-0.9', modelRevision: 'dh-standard-v1' },
  state: { jointsDeg: [0, 0, 0, 0, 30, 0] },
  intent: { kind: 'joint-target', targetJointsDeg: [1, 2, 3, 4, 5, 6] },
}

const IDENTITY_FRAME: PoseData = { positionMm: [0, 0, 0], quaternionWxyz: [1, 0, 0, 0] }

function poseData(pose: Pose): PoseData {
  const quaternion = rotationMatrixToQuaternion(pose.rotation)
  return { positionMm: [...pose.position] as PoseData['positionMm'], quaternionWxyz: [quaternion[3], quaternion[0], quaternion[1], quaternion[2]] }
}

function offsetPosition(pose: Pose, deltaMm: readonly [number, number, number]): Pose {
  return { ...pose, position: pose.position.map((value, axis) => value + deltaMm[axis]) as Pose['position'] }
}

describe('robot motion core contract', () => {
  it('returns a time-ordered joint plan for a valid target', () => {
    const result = planMotion(home)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.waypoints[0]).toEqual({ timeMs: 0, jointsDeg: [0, 0, 0, 0, 30, 0] })
    expect(result.end.jointsDeg).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.waypoints.at(-1)?.jointsDeg).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.waypoints.every((point, index, points) => index === 0 || point.timeMs > points[index - 1].timeMs)).toBe(true)
  })

  it('rejects malformed numeric contract data before planning', () => {
    const result = planMotion({
      ...home,
      state: { jointsDeg: [0, 0, 0, 0, Number.NaN, 0] },
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        category: 'invalid-request',
        details: { field: 'state.jointsDeg', reason: 'expected-six-finite-numbers' },
      },
    })
  })

  it('rejects unsupported model and joint limits structurally', () => {
    expect(planMotion({ ...home, robot: { modelId: 'unknown', modelRevision: 'dh-standard-v1' } })).toEqual({
      ok: false,
      error: {
        code: 'unsupported-model',
        category: 'unsupported-model',
        details: { modelId: 'unknown', modelRevision: 'dh-standard-v1' },
      },
    })

    expect(
      planMotion({
        ...home,
        intent: { kind: 'joint-target', targetJointsDeg: [999, 0, 0, 0, 0, 0] },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'joint-limit',
        category: 'planning-failure',
        details: { axisIndex: 0 },
      },
    })
  })

  it('does not silently route unsupported intent types to DLS', () => {
    const result = planMotion({
      ...home,
      intent: {
        kind: 'degenerate-ik',
        targetTcpPose: {
          positionMm: [0, 0, 0],
          quaternionWxyz: [1, 0, 0, 0],
        },
        constraint: 'numerical-only',
      } as unknown as MotionPlanningRequest['intent'],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual({
      code: 'invalid-request',
      category: 'invalid-request',
      details: { field: 'intent.kind', reason: 'unsupported-intent' },
    })
  })
})

/**
 * 特征化测试：先固定 planCartesianTarget/planLinearPath/planCircularPath 三个入口
 * 当前对 ConfigurationPolicy 的行为，再抽取共享的构型校验 helper，确保重构前后
 * 运动效果逐字不变。cf1/cf4/cf6/cfx 取自起始关节的真实解析构型，不使用占位数值。
 */
describe('robot motion core contract — configurationPolicy 特征化', () => {
  const model = new AbbRobotModelAdapter()
  const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
  const [cf1, cf4, cf6, cfx] = model.deriveConfiguration!(startJoints)!
  const startConfiguration: ABBConfigurationData = { cf1, cf4, cf6, cfx }
  const startPose = model.forwardKinematics(startJoints)
  const targetPose = offsetPosition(startPose, [5, 0, 0])
  const viaPose = offsetPosition(startPose, [0, 2, 0])
  const wrongConfiguration: ABBConfigurationData = {
    cf1: startConfiguration.cf1,
    cf4: startConfiguration.cf4,
    cf6: startConfiguration.cf6,
    cfx: (startConfiguration.cfx + 1) % 8,
  }
  const mismatchedConfiguration: ABBConfigurationData = { cf1: 5, cf4: 5, cf6: 5, cfx: 5 }

  const baseIntent = {
    tool: { robhold: true as const, tcpInFlange: IDENTITY_FRAME },
    workObject: { robhold: false as const, userFrame: IDENTITY_FRAME, objectFrame: IDENTITY_FRAME, ufprog: true as const, ufmec: '' as const },
    singularityPolicy: 'strict' as const,
    zone: 'fine' as const,
  }

  function requestFor(
    kind: 'cartesian-target' | 'linear-path' | 'circular-path',
    configurationPolicy: ConfigurationPolicy,
  ): MotionPlanningRequest {
    return {
      schemaVersion: 1,
      robot: { modelId: 'abb-irb1200-5-0.9', modelRevision: 'dh-standard-v1' },
      state: { jointsDeg: startJoints as unknown as MotionPlanningRequest['state']['jointsDeg'] },
      intent: {
        kind,
        targetTcpPose: poseData(targetPose),
        ...(kind === 'circular-path' ? { viaTcpPose: poseData(viaPose) } : {}),
        ...baseIntent,
        configurationPolicy,
        ...(kind === 'cartesian-target' ? {} : { speedMmPerSec: 50 }),
      } as MotionPlanningRequest['intent'],
    }
  }

  describe.each([
    ['cartesian-target', 'planCartesianTarget'],
    ['linear-path', 'planLinearPath'],
    ['circular-path', 'planCircularPath'],
  ] as const)('%s (%s)', (kind, _entryPoint) => {
    it('required 且解出构型与目标一致时规划成功', () => {
      const result = planMotion(requestFor(kind, { kind: 'required', target: startConfiguration }))
      expect(result.ok).toBe(true)
    })

    it('required 但解出构型与目标不一致时以 configuration-unreachable 或 unreachable 失败', () => {
      const result = planMotion(requestFor(kind, { kind: 'required', target: wrongConfiguration }))
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(['configuration-unreachable', 'unreachable']).toContain(result.error.code)
    })

    it('current-main 且解出构型与当前主构型一致时规划成功', () => {
      const result = planMotion(requestFor(kind, { kind: 'current-main', currentMain: startConfiguration }))
      expect(result.ok).toBe(true)
    })

    it('current-main 但解出构型与当前主构型不一致时以 configuration-unreachable 失败', () => {
      const result = planMotion(requestFor(kind, { kind: 'current-main', currentMain: mismatchedConfiguration }))
      expect(result).toEqual({
        ok: false,
        error: { code: 'configuration-unreachable', category: 'planning-failure', details: { policy: 'current-main' } },
      })
    })

    it('nearest-valid 不做构型后置校验，规划成功', () => {
      const result = planMotion(requestFor(kind, { kind: 'nearest-valid' }))
      expect(result.ok).toBe(true)
    })
  })
})
