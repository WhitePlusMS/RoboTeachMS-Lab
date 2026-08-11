import { describe, expect, it } from 'vitest'
import type { MotionClock } from './motion-runner'
import { createMotionRunner } from './motion-runner'
import type { JointAngles } from './types'

class ManualMotionClock implements MotionClock {
  private currentTime = 0
  private nextFrameId = 1
  private readonly frames = new Map<number, () => void>()

  now(): number {
    return this.currentTime
  }

  requestFrame(callback: () => void): number {
    const frameId = this.nextFrameId
    this.nextFrameId += 1
    this.frames.set(frameId, callback)
    return frameId
  }

  cancelFrame(frameId: number): void {
    this.frames.delete(frameId)
  }

  advanceBy(milliseconds: number): void {
    this.currentTime += milliseconds
    const callbacks = [...this.frames.values()]
    this.frames.clear()
    callbacks.forEach((callback) => callback())
  }

  pendingFrameCount(): number {
    return this.frames.size
  }
}

function jointsAt(value: number): JointAngles {
  return [value, value, value, value, value, value]
}

describe('Motion Runner', () => {
  it('通过手动时钟完成缓动并在终点停止请求帧', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => { joints = [...next] },
    })

    runner.startEased(jointsAt(10), 100)
    clock.advanceBy(50)
    expect(joints).toEqual(jointsAt(5))
    expect(clock.pendingFrameCount()).toBe(1)

    clock.advanceBy(50)
    expect(joints).toEqual(jointsAt(10))
    expect(clock.pendingFrameCount()).toBe(0)
  })

  it('缓动过程中替换目标时从当前关节重新开始', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => { joints = [...next] },
    })

    runner.startEased(jointsAt(10), 100)
    clock.advanceBy(50)
    runner.startEased(jointsAt(20), 100)
    clock.advanceBy(50)

    expect(joints).toEqual(jointsAt(12.5))
    expect(clock.pendingFrameCount()).toBe(1)
  })

  it('限速运动会复用循环、替换目标并遵守速度上限', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => { joints = [...next] },
      motionConfig: { jointSpeedLimit: 10, ikAnimDuration: 800, snapThreshold: 0.01 },
    })

    runner.startSpeedLimited(jointsAt(2))
    clock.advanceBy(100)
    expect(joints).toEqual(jointsAt(1))

    runner.startSpeedLimited(jointsAt(3))
    expect(clock.pendingFrameCount()).toBe(1)
    clock.advanceBy(100)
    expect(joints).toEqual(jointsAt(2))
    clock.advanceBy(100)
    expect(joints).toEqual(jointsAt(3))
    expect(clock.pendingFrameCount()).toBe(0)
  })

  it('停止后取消待执行帧并保持当前关节', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => { joints = [...next] },
    })

    runner.startEased(jointsAt(10), 100)
    clock.advanceBy(40)
    const stoppedAt = [...joints]
    runner.stop()
    clock.advanceBy(60)

    expect(joints).toEqual(stoppedAt)
    expect(clock.pendingFrameCount()).toBe(0)
  })

  it('按统一时间轴平滑执行笛卡尔规划得到的关节 waypoint', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => { joints = [...next] },
    })

    runner.startTrajectory([jointsAt(10), jointsAt(20)], 100)
    clock.advanceBy(50)
    expect(joints).toEqual(jointsAt(10))
    expect(clock.pendingFrameCount()).toBe(1)

    clock.advanceBy(50)
    expect(joints).toEqual(jointsAt(20))
    expect(clock.pendingFrameCount()).toBe(0)
  })
})
