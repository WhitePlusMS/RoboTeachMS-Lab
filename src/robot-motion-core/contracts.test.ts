import { describe, expect, it } from 'vitest'
import { planMotion, type MotionPlanningRequest } from './index.ts'

const home: MotionPlanningRequest = {
  schemaVersion: 1,
  robot: { modelId: 'abb-irb1200-5-0.9', modelRevision: 'dh-standard-v1' },
  state: { jointsDeg: [0, 0, 0, 0, 30, 0] },
  intent: { kind: 'joint-target', targetJointsDeg: [1, 2, 3, 4, 5, 6] },
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
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unsupported-capability')
    expect(result.error.category).toBe('unsupported-capability')
  })
})
