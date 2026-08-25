import { describe, expect, it } from 'vitest'
import { orientationError } from '@/robotics/math/rotation3d.ts'
import { extractPose } from '@/robotics/kinematics/pose-conversion.ts'
import { forwardAbbKinematicsDegrees } from './forward-kinematics.ts'
import { abbConfigurationFromBranch, abbQuadrant } from './configuration.ts'
import { solveAbbAnalyticIK } from './analytic-inverse-kinematics.ts'

function poseFromJoints(joints: [number, number, number, number, number, number]) {
  const matrix = forwardAbbKinematicsDegrees(joints)
  const pose = extractPose(matrix)
  return {
    position: pose.position,
    euler: pose.eulerZYX,
    rotation: matrix.getRotation(),
  }
}

describe('ABB IRB1200 解析逆解', () => {
  it.each([
    [0, 0],
    [-1e-10, 0],
    [89.999, 0],
    [89.99999995, 0],
    [90, 1],
    [90.00000005, 1],
    [-0.001, -1],
    [-90, -1],
    [-89.99999995, -1],
    [-90.00000005, -2],
    [179.99999995, 1],
    [300, 3],
  ])('ABB 象限按未回绕角度计算：%s° -> %s', (angle, expected) => {
    expect(abbQuadrant(angle)).toBe(expected)
  })

  it('分支构型在多圈关节上保留实际 cf6 象限', () => {
    expect(abbConfigurationFromBranch([20, -30, 35, 40, 25, 300], 0, 0, 0)).toEqual([0, 0, 3, 0])
  })

  it.each([
    { joints: [0, 0, 0, 0, 0, 0] },
    { joints: [20, -30, 35, 40, 25, -50] },
    { joints: [-40, 20, -80, -90, -35, 120] },
    { joints: [10, -60, -120, 170, 70, -220] },
  ] as { joints: [number, number, number, number, number, number] }[])(
    '能闭环恢复 $joints',
    ({ joints }) => {
      const target = poseFromJoints(joints)
      const candidates = solveAbbAnalyticIK(target, joints)

      expect(candidates.length).toBeGreaterThan(0)
      const best = candidates.reduce((current, candidate) =>
        candidate.positionErrorMm + candidate.orientationErrorRad <
        current.positionErrorMm + current.orientationErrorRad
          ? candidate
          : current,
      )
      expect(best.positionErrorMm).toBeLessThan(1e-5)
      expect(best.orientationErrorRad).toBeLessThan(1e-8)

      const solvedPose = poseFromJoints(best.joints)
      const orientationResidual = orientationError(target.rotation, solvedPose.rotation)
      expect(Math.hypot(...orientationResidual)).toBeLessThan(1e-8)
    },
  )

  it('J5 接近零位时补充以参考 J4 为中心的耦合腕部候选', () => {
    const reference: [number, number, number, number, number, number] = [0, -20, 30, 30, 0.5, 20]
    const target = poseFromJoints(reference)
    const candidates = solveAbbAnalyticIK(target, reference)

    expect(
      candidates.some(
        (candidate) =>
          Math.abs(candidate.joints[3] - reference[3]) < 1e-6 && Math.abs(candidate.joints[4]) <= 1,
      ),
    ).toBe(true)
  })
})
