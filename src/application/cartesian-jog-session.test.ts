import { describe, expect, it } from 'vitest'
import { createCartesianJogSession } from './cartesian-jog-session.ts'
import type { PoseDisplay } from '@/robotics/model/index.ts'

const pose: PoseDisplay = {
  positionMm: [1, 2, 3],
  orientationDeg: [4, 5, 6],
}

describe('Cartesian Jog session', () => {
  it('请求锚点只向前提交，失败可回滚到最后提交目标', () => {
    const session = createCartesianJogSession()
    session.begin(pose, [0, 0, 0, 0, 0, 0])
    session.request({ positionMm: [2, 2, 3], orientationDeg: [4, 5, 6] })
    expect(session.getAnchor(pose).positionMm[0]).toBe(2)
    session.rollback()
    expect(session.getAnchor(pose).positionMm[0]).toBe(1)
    session.commit({ positionMm: [3, 2, 3], orientationDeg: [4, 5, 6] }, [1, 1, 1, 1, 1, 1])
    expect(session.getAnchor(pose).positionMm[0]).toBe(3)
    expect(session.getPlanningJoints([9, 9, 9, 9, 9, 9])).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('同一长按 generation 在每批成功提交后保持不变', () => {
    const session = createCartesianJogSession()
    session.begin(pose, [0, 0, 0, 0, 0, 0])
    const generation = session.getGeneration()
    session.commit(pose, [1, 1, 1, 1, 1, 1])
    expect(session.getGeneration()).toBe(generation)
  })

  it('结束会话后不保留旧锚点', () => {
    const session = createCartesianJogSession()
    session.begin(pose, [0, 0, 0, 0, 0, 0])
    session.end()
    expect(session.isActive()).toBe(false)
    expect(session.getAnchor(pose).positionMm[0]).toBe(1)
  })
})
