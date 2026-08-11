import { describe, expect, it } from 'vitest'
import { extractPose } from '../../robotics/kinematics.ts'
import {
  forwardAbbKinematicsDegrees,
  forwardAbbKinematicsFramesDegrees,
  standardDhTransform,
} from './abb-kinematics.ts'

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

    expect(pose.position[0]).toBeCloseTo(451)
    expect(pose.position[1]).toBeCloseTo(713.197792)
    expect(pose.position[2]).toBeCloseTo(0)
    expect(pose.position.every(Number.isFinite)).toBe(true)
    expect(pose.eulerZYX.every(Number.isFinite)).toBe(true)
  })

  it('每个关节运动都会改变 ABB 专用正解结果', () => {
    const zero = extractPose(forwardAbbKinematicsDegrees([0, 0, 0, 0, 0, 0]))
    const moved = extractPose(forwardAbbKinematicsDegrees([10, 0, 0, 0, 0, 0]))

    expect(moved.position).not.toEqual(zero.position)
  })

  it('输出可用于可视化的七个 DH 原点 frame', () => {
    const frames = forwardAbbKinematicsFramesDegrees([0, 0, 0, 0, 0, 0])
    const positions = frames.map((frame) => frame.getPosition())
    const expectedPositions = [
      [0, 0, 0],
      [0, 399.1, 0],
      [0, 847.1, 0],
      [0, 889.1, 0],
      [451, 889.1, 0],
      [451, 889.1, 0],
      [451, 807.1, 0],
    ]

    expect(frames).toHaveLength(7)
    positions.forEach((position, frameIndex) => {
      position.forEach((value, componentIndex) => {
        expect(value).toBeCloseTo(expectedPositions[frameIndex][componentIndex], 6)
      })
    })
  })

  it('零位关节轴与 FBX 已确认的轴线一致，并使腕部沿负 Y 方向伸出', () => {
    const frames = forwardAbbKinematicsFramesDegrees([0, 0, 0, 0, 0, 0])
    const expectedDirectedAxes = [
      [0, 1, 0],
      [0, 0, -1],
      [0, 0, -1],
      [1, 0, 0],
      [0, 0, -1],
      [0, -1, 0],
    ]

    expectedDirectedAxes.forEach((expectedAxis, jointIndex) => {
      const rotation = frames[jointIndex].getRotation()
      const actualAxis = [rotation[0][2], rotation[1][2], rotation[2][2]]
      actualAxis.forEach((value, componentIndex) => {
        expect(value).toBeCloseTo(expectedAxis[componentIndex], 6)
      })
    })
  })
})
