import { describe, expect, it } from 'vitest'
import { buildJointPathAudit } from './joint-path-audit.ts'
import type { JointAngles } from './types.ts'

describe('Joint path audit', () => {
  it('可疑腕部 waypoint 输出前、当前、后三组六轴快照', () => {
    const initial: JointAngles = [1, 2, 3, 10, 20, 30]
    const waypoints: JointAngles[] = [
      [1, 2, 3, 12, 21, 31],
      [4, 5, 6, 173.7, 82, -179.3],
      [4, 5, 6, 174, 82.2, -179],
    ]

    const audit = buildJointPathAudit(initial, waypoints)

    expect(audit).not.toBeNull()
    expect(audit?.initialJoints).toEqual(initial)
    expect(audit?.waypointCount).toBe(3)
    expect(audit?.initialWristAbsDeg).toEqual({ J4: 10, J6: 30 })
    expect(audit?.maxWristAbsolute).toMatchObject({ axis: 'J6', waypointIndex: 2 })
    expect(audit?.maxWristStep).toMatchObject({ axis: 'J6', waypointIndex: 2 })
    expect(audit?.maxWristStepPoint).toMatchObject({
      waypointIndex: 2,
      previous: waypoints[0],
      current: waypoints[1],
      next: waypoints[2],
    })
    expect(audit?.firstHighWristPoint?.waypointIndex).toBe(2)
    expect(audit?.suspiciousPoints[0]).toMatchObject({
      waypointIndex: 2,
      previous: waypoints[0],
      current: waypoints[1],
      next: waypoints[2],
      wristAbsDeg: { J4: 173.7, J6: 179.3 },
    })
    expect(audit?.suspiciousPoints[0].deltaFromPreviousDeg).toEqual([
      3,
      3,
      3,
      161.7,
      61,
      210.3,
    ])
  })

  it('普通小幅路径不输出审计对象', () => {
    const initial: JointAngles = [0, 0, 0, 0, 0, 0]
    const waypoints: JointAngles[] = [[0, 0, 0, 5, 1, 4]]
    expect(buildJointPathAudit(initial, waypoints)).toBeNull()
  })
})
