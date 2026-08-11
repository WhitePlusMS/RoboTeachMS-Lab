import { describe, expect, it } from 'vitest'
import { extractPose } from '../../robotics/kinematics.ts'
import { abbBaseFrameToSceneFrame } from '../../scene/abb-scene-transform.ts'
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

  it('零位机械法兰位于 ABB 基座坐标约 [451, 0, 807.1] mm，不再携带场景/工具偏移', () => {
    const pose = extractPose(forwardAbbKinematicsDegrees([0, 0, 0, 0, 0, 0]))

    expect(pose.position[0]).toBeCloseTo(451)
    expect(pose.position[1]).toBeCloseTo(0)
    expect(pose.position[2]).toBeCloseTo(807.1)
    expect(pose.position.every(Number.isFinite)).toBe(true)
    expect(pose.eulerZYX.every(Number.isFinite)).toBe(true)
  })

  it('每个关节运动都会改变 ABB 专用正解结果', () => {
    const zero = extractPose(forwardAbbKinematicsDegrees([0, 0, 0, 0, 0, 0]))
    const moved = extractPose(forwardAbbKinematicsDegrees([10, 0, 0, 0, 0, 0]))

    expect(moved.position).not.toEqual(zero.position)
  })

  it('输出可用于可视化的七个 DH 原点 frame，均为 ABB 基座坐标', () => {
    const frames = forwardAbbKinematicsFramesDegrees([0, 0, 0, 0, 0, 0])
    const positions = frames.map((frame) => frame.getPosition())
    const expectedPositions = [
      [0, 0, 0],
      [0, 0, 399.1],
      [0, 0, 847.1],
      [0, 0, 889.1],
      [451, 0, 889.1],
      [451, 0, 889.1],
      [451, 0, 807.1],
    ]

    expect(frames).toHaveLength(7)
    positions.forEach((position, frameIndex) => {
      position.forEach((value, componentIndex) => {
        expect(value).toBeCloseTo(expectedPositions[frameIndex][componentIndex], 6)
      })
    })
  })

  it('ABB 基座 frame 经唯一场景显示转换后的关节轴与 FBX 一致，并使腕部沿负 Y 伸出', () => {
    const frames = forwardAbbKinematicsFramesDegrees([0, 0, 0, 0, 0, 0]).map(abbBaseFrameToSceneFrame)
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
