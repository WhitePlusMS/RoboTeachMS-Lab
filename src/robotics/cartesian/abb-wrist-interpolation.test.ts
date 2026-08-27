import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/index.ts'
import { rotationDistanceRad } from '@/robotics/math/rotation3d.ts'
import type { JointAngles, Pose } from '@/robotics/model/index.ts'
import { planCartesianPath } from '@/robot-motion-core/internal/cartesian/path-planner.ts'

const TRUE_ZERO: JointAngles = [0, 0, 0, 0, 0, 0]

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position] as Pose['position'],
    euler: [...pose.euler] as Pose['euler'],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

describe('显式腕部退化插补', () => {
  it.each([-1, 1] as const)('保持 TCP 位置并报告受控姿态残差：Y%+d50', (direction) => {
    const model = ABB_IRB1200_PROFILE.model
    const start = model.forwardKinematics(TRUE_ZERO)
    expect(start).not.toBeNull()
    if (!start) return
    const target = clonePose(start)
    target.position[1] += direction * 50
    const result = planCartesianPath(
      target,
      TRUE_ZERO,
      model,
      ABB_IRB1200_PROFILE.jointRanges,
      { allowWristFallback: true },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return

    let maxOrientationDeg = 0
    let maxOrientationProgress = 0
    let maxPositionErrorMm = 0
    result.waypoints.forEach((waypoint, index) => {
      const actual = model.forwardKinematics(waypoint)
      expect(actual).not.toBeNull()
      if (!actual) return
      const progress = (index + 1) / result.waypoints.length
      const expectedY = start.position[1] + direction * 50 * progress
      maxPositionErrorMm = Math.max(
        maxPositionErrorMm,
        Math.hypot(
          actual.position[0] - start.position[0],
          actual.position[1] - expectedY,
          actual.position[2] - start.position[2],
        ),
      )
      const orientationDeg =
        (rotationDistanceRad(start.rotation, actual.rotation) * 180) / Math.PI
      if (orientationDeg > maxOrientationDeg) {
        maxOrientationDeg = orientationDeg
        maxOrientationProgress = progress
      }
    })

    const final = result.waypoints[result.waypoints.length - 1]
    const finalPose = model.forwardKinematics(final)
    expect(finalPose).not.toBeNull()
    if (!finalPose) return
    const finalOrientationDeg =
      (rotationDistanceRad(start.rotation, finalPose.rotation) * 180) / Math.PI

    expect(result.appliedSingularityMode).toBe('wrist')
    expect(maxPositionErrorMm).toBeLessThan(0.05)
    // 当前能力只保证安全位置路径与实际姿态残差，不宣称逐样本复刻控制器曲线。
    expect(maxOrientationDeg).toBeLessThan(2.2)
    expect(maxOrientationProgress).toBeGreaterThan(0)
    expect(maxOrientationProgress).toBeLessThan(1)
    expect(finalOrientationDeg).toBeLessThan(2.2)
    expect(final.every(Number.isFinite)).toBe(true)
  })
})
