import { describe, expect, it } from 'vitest'
import { easeInOutCubic, lerpJoints } from './smoothing.ts'

describe('机器人运动缓动', () => {
  it('缓动曲线在起止点保持边界并在中点对称', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5)
  })

  it('关节插值同时应用缓动曲线', () => {
    expect(lerpJoints([0, 10], [10, 30], 0)).toEqual([0, 10])
    expect(lerpJoints([0, 10], [10, 30], 1)).toEqual([10, 30])
    expect(lerpJoints([0, 10], [10, 30], 0.5)).toEqual([5, 20])
  })
})
