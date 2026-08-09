import { describe, expect, it } from 'vitest'
import { applyCartesianDelta } from './cartesian-control'
import type { PoseDisplay } from '../core/robot/types'

const pose: PoseDisplay = {
  positionMm: [100, 200, 300],
  orientationDeg: [0, 0, 90],
}

describe('笛卡尔坐标增量', () => {
  it('World 坐标沿世界 X 轴移动', () => {
    const next = applyCartesianDelta(pose, 'x', 1, 10, 'World')

    expect(next.positionMm).toEqual([110, 200, 300])
  })

  it('Tool 坐标会把局部 X 轴转换为当前工具朝向', () => {
    const next = applyCartesianDelta(pose, 'x', 1, 10, 'Tool')

    expect(next.positionMm[0]).toBeCloseTo(100)
    expect(next.positionMm[1]).toBeCloseTo(210)
    expect(next.positionMm[2]).toBeCloseTo(300)
  })
})
