import { describe, expect, it } from 'vitest'
import { sampleJointTrajectory } from './joint-trajectory-sampler.ts'
import { createMotionRunner } from './runner.ts'
import { ManualMotionClock } from '@/testing/manual-motion-clock.ts'
import type { JointAngles } from '../../robot-geometry/robot-types.ts'

const points = [
  { timeMs: 0, jointsDeg: [0, 0, 0, 0, 0, 0] as const },
  { timeMs: 100, jointsDeg: [10, 0, 0, 0, 0, 0] as const },
  { timeMs: 1000, jointsDeg: [20, 0, 0, 0, 0, 0] as const },
]
describe('计划时间的真实执行', () => {
  it('非均匀时间点按时间定位，不按点下标平均分配', () => {
    expect(sampleJointTrajectory(points, 100)[0]).toBe(10)
    expect(sampleJointTrajectory(points, 550)[0]).toBe(15)
  })
  it('不同刷新频率与暂停恢复到达同一关节状态，停止后无迟到帧', async () => {
    for (const increments of [[550], [100, 150, 300]]) {
      const clock = new ManualMotionClock()
      let joints: JointAngles = [0, 0, 0, 0, 0, 0]
      const runner = createMotionRunner({
        clock,
        getCurrentJoints: () => joints,
        setJoints: (value) => {
          joints = value
        },
      })
      const done = runner.startTrajectory(points)
      increments.forEach((ms) => clock.advanceBy(ms))
      expect(joints[0]).toBeCloseTo(15)
      runner.pause()
      clock.advanceBy(5000)
      expect(joints[0]).toBeCloseTo(15)
      runner.resume()
      clock.advanceBy(450)
      expect(await done).toBe('completed')
      expect(joints[0]).toBe(20)
      runner.stop()
      clock.advanceBy(5000)
      expect(clock.pendingFrameCount()).toBe(0)
    }
  })
})
