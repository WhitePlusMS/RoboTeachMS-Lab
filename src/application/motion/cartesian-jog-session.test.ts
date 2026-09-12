import { describe, expect, it } from 'vitest'
import { createCartesianJogSession } from './cartesian-jog-session.ts'
import type { PoseDisplay } from '@/robot-geometry/robot-types.ts'

const pose: PoseDisplay = {
  positionMm: [1, 2, 3],
  orientationDeg: [4, 5, 6],
}

describe('Cartesian Jog session', () => {
  it('未提交请求不改变锚点，失败可回滚到最后提交目标', () => {
    const session = createCartesianJogSession()
    session.begin(pose, [0, 0, 0, 0, 0, 0])
    expect(session.getAnchor(pose).positionMm[0]).toBe(1)
    session.commit({ positionMm: [3, 2, 3], orientationDeg: [4, 5, 6] }, [1, 1, 1, 1, 1, 1])
    expect(session.getAnchor(pose).positionMm[0]).toBe(3)
    expect(session.getPlanningJoints([9, 9, 9, 9, 9, 9])).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('同一长按成功提交后只更新规划锚点', () => {
    const session = createCartesianJogSession()
    session.begin(pose, [0, 0, 0, 0, 0, 0])
    session.commit(pose, [1, 1, 1, 1, 1, 1])
    expect(session.getPlanningJoints([9, 9, 9, 9, 9, 9])).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('结束会话后不保留旧锚点', () => {
    const session = createCartesianJogSession()
    session.begin(pose, [0, 0, 0, 0, 0, 0])
    session.end()
    expect(session.isActive()).toBe(false)
    expect(session.getAnchor(pose).positionMm[0]).toBe(1)
  })
})
