import { describe, expect, it } from 'vitest'
import { extractPose } from '../../core/robot/kinematics'
import { forwardAbbKinematicsDegrees, standardDhTransform } from './abb-kinematics'

describe('ABB IRB 1200 专用标准 DH 适配器', () => {
  it('使用标准 DH 矩阵而不是 KUKA 历史矩阵', () => {
    const transform = standardDhTransform(0, 399.1, 448, -Math.PI / 2)

    expect(transform.data[0][0]).toBeCloseTo(1)
    expect(transform.data[0][3]).toBeCloseTo(448)
    expect(transform.data[1][2]).toBeCloseTo(1)
    expect(transform.data[2][1]).toBeCloseTo(-1)
    expect(transform.data[2][3]).toBeCloseTo(399.1)
  })

  it('零位使用 ABB 基座到 Three.js 世界的固定坐标转换', () => {
    const pose = extractPose(forwardAbbKinematicsDegrees([0, 0, 0, 0, 0, 0]))

    expect(pose.position[0]).toBeCloseTo(533)
    expect(pose.position[1]).toBeCloseTo(889.1)
    expect(pose.position[2]).toBeCloseTo(0)
    expect(pose.position.every(Number.isFinite)).toBe(true)
    expect(pose.eulerZYX.every(Number.isFinite)).toBe(true)
  })

  it('每个关节运动都会改变 ABB 专用正解结果', () => {
    const zero = extractPose(forwardAbbKinematicsDegrees([0, 0, 0, 0, 0, 0]))
    const moved = extractPose(forwardAbbKinematicsDegrees([10, 0, 0, 0, 0, 0]))

    expect(moved.position).not.toEqual(zero.position)
  })
})
