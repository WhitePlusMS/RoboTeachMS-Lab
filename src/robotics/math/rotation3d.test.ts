import { describe, expect, it } from 'vitest'
import { orientationError, rotationDistanceRad } from './rotation3d.ts'

describe('旋转误差', () => {
  it('把 180° 姿态差识别为 π，而不是 sin(π)=0', () => {
    const identity = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const halfTurnAroundX = [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
    ]

    expect(rotationDistanceRad(identity, halfTurnAroundX)).toBeCloseTo(Math.PI, 8)
    expect(Math.hypot(...orientationError(identity, halfTurnAroundX))).toBeCloseTo(Math.PI, 8)
  })

  it('小角度仍返回连续的轴角向量', () => {
    const angle = 0.01
    const rotation = [
      [Math.cos(angle), -Math.sin(angle), 0],
      [Math.sin(angle), Math.cos(angle), 0],
      [0, 0, 1],
    ]

    expect(Math.hypot(...orientationError(rotation, [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]))).toBeCloseTo(angle, 8)
  })
})
