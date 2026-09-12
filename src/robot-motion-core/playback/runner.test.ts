import { describe, expect, it } from 'vitest'
import type { MotionClock, MotionResult } from './runner.ts'
import { createMotionRunner } from './runner.ts'
import type { JointAngles } from '../../robot-geometry/robot-types.ts'

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

function timed(initial: JointAngles, targets: JointAngles[], duration: number) {
  return [initial, ...targets].map((jointsDeg, i) => ({
    jointsDeg,
    timeMs: (duration * i) / targets.length,
  }))
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
      setJoints: (next) => {
        joints = [...next]
      },
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
      setJoints: (next) => {
        joints = [...next]
      },
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
      setJoints: (next) => {
        joints = [...next]
      },
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
      setJoints: (next) => {
        joints = [...next]
      },
    })

    runner.startEased(jointsAt(10), 100)
    clock.advanceBy(40)
    const stoppedAt = [...joints]
    runner.stop()
    clock.advanceBy(60)

    expect(joints).toEqual(stoppedAt)
    expect(clock.pendingFrameCount()).toBe(0)
    expect(runner.getStatus()).toBe('idle')
  })

  it('按统一时间轴平滑执行笛卡尔规划得到的关节 waypoint', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    runner.startTrajectory(timed(joints, [jointsAt(10), jointsAt(20)], 100))
    clock.advanceBy(50)
    expect(joints).toEqual(jointsAt(10))
    expect(clock.pendingFrameCount()).toBe(1)

    clock.advanceBy(50)
    expect(joints).toEqual(jointsAt(20))
    expect(clock.pendingFrameCount()).toBe(0)
  })

  it('缓动自然完成只解析一次 completed，状态回到 idle', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    expect(runner.getStatus()).toBe('idle')
    const result = runner.startEased(jointsAt(10), 100)
    expect(runner.getStatus()).toBe('running')
    clock.advanceBy(100)

    expect(await result).toBe('completed')
    expect(runner.getStatus()).toBe('idle')
    expect(clock.pendingFrameCount()).toBe(0)
  })

  it('显式停止只解析一次 stopped，保持停止瞬间关节并回到 idle', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    const result = runner.startEased(jointsAt(10), 100)
    clock.advanceBy(40)
    const stoppedAt = [...joints]
    runner.stop()

    expect(await result).toBe('stopped')
    expect(joints).toEqual(stoppedAt)
    expect(runner.getStatus()).toBe('idle')
  })

  it('模式切换时旧 Promise 解析为 stopped，新模式独立并始终单帧循环', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
      motionConfig: { jointSpeedLimit: 1000, ikAnimDuration: 800, snapThreshold: 0.01 },
    })

    const eased = runner.startEased(jointsAt(10), 100)
    clock.advanceBy(50)
    expect(clock.pendingFrameCount()).toBe(1)

    const decelerated = runner.startSpeedLimited(jointsAt(20))
    expect(clock.pendingFrameCount()).toBe(1)

    expect(await eased).toBe('stopped')
    expect(runner.getStatus()).toBe('running')
    clock.advanceBy(100)
    expect(runner.getStatus()).toBe('idle')
    expect(await decelerated).toBe('completed')
  })

  it('同模式连续更新目标返回同一个未完成 Promise', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    const first = runner.startEased(jointsAt(10), 200)
    clock.advanceBy(100)
    const second = runner.startEased(jointsAt(20), 200)
    expect(second).toBe(first)
    clock.advanceBy(200)
    expect(await first).toBe('completed')
  })

  it('暂停期间不改变关节，继续后排除暂停时间准确到达原目标', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    const result = runner.startEased(jointsAt(10), 100)
    clock.advanceBy(30)
    expect(joints[0]).toBeCloseTo(1.08)

    runner.pause()
    const pausedAt = [...joints]
    expect(runner.getStatus()).toBe('paused')
    expect(clock.pendingFrameCount()).toBe(0)

    // 暂停期间时钟继续前进，但关节冻结。
    clock.advanceBy(5000)
    expect(joints).toEqual(pausedAt)

    runner.resume()
    expect(runner.getStatus()).toBe('running')
    // 排除 5000ms 暂停后，剩余 70ms 应推进到终点。
    clock.advanceBy(70)
    expect(joints[0]).toBeCloseTo(10)
    expect(await result).toBe('completed')
  })

  it('轨迹暂停期间不推进，继续后准确到达终点', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(5)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    const result = runner.startTrajectory(timed(joints, [jointsAt(15), jointsAt(25)], 100))
    clock.advanceBy(30)
    runner.pause()
    const pausedAt = [...joints]
    clock.advanceBy(3000)
    expect(joints).toEqual(pausedAt)

    runner.resume()
    clock.advanceBy(70)
    expect(joints).toEqual(jointsAt(25))
    expect(await result).toBe('completed')
  })

  it('限速运动暂停继续后关节增量不因暂停时间跳变', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
      motionConfig: { jointSpeedLimit: 10, ikAnimDuration: 800, snapThreshold: 0.01 },
    })

    runner.startSpeedLimited(jointsAt(2))
    clock.advanceBy(100)
    expect(joints[0]).toBeCloseTo(1)

    runner.pause()
    clock.advanceBy(5000)
    expect(joints[0]).toBeCloseTo(1)

    runner.resume()
    clock.advanceBy(100)
    // 只推进 100ms 步长，不因 5 秒暂停产生 5 度跳变。
    expect(joints[0]).toBeCloseTo(2)
  })

  it('pause/resume/stop 对不适用状态幂等', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    expect(runner.getStatus()).toBe('idle')
    runner.pause()
    runner.resume()
    runner.stop()
    expect(runner.getStatus()).toBe('idle')
    expect(clock.pendingFrameCount()).toBe(0)

    runner.startEased(jointsAt(5), 100)
    runner.pause()
    expect(runner.getStatus()).toBe('paused')
    runner.pause()
    expect(runner.getStatus()).toBe('paused')
    // 重复 resume 之后的 stop 仍保持幂等。
    runner.resume()
    runner.resume()
    expect(runner.getStatus()).toBe('running')
    runner.stop()
    expect(runner.getStatus()).toBe('idle')
  })

  it('空 waypoint 轨迹抛出参数错误且不改变现有运动状态', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    expect(runner.getStatus()).toBe('idle')
    expect(() => runner.startTrajectory([])).toThrow()
    expect(runner.getStatus()).toBe('idle')
    expect(clock.pendingFrameCount()).toBe(0)
  })

  it('暂停中停止解析为 stopped 并回到 idle', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    const result = runner.startEased(jointsAt(10), 100)
    clock.advanceBy(20)
    runner.pause()
    runner.stop()
    expect(runner.getStatus()).toBe('idle')
    expect(await result).toBe('stopped')
  })

  it('getStatus 覆盖运行、暂停、继续、停止与自然完成', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    expect(runner.getStatus()).toBe('idle')
    runner.startEased(jointsAt(10), 100)
    expect(runner.getStatus()).toBe('running')
    runner.pause()
    expect(runner.getStatus()).toBe('paused')
    runner.resume()
    expect(runner.getStatus()).toBe('running')
    runner.stop()
    expect(runner.getStatus()).toBe('idle')
  })
})

// 明确引用结果类型，保证 Promise<MotionResult> 是严格类型而非 any。
const _typeCheck: Promise<MotionResult> = (() => {
  const clock = new ManualMotionClock()
  const runner = createMotionRunner({
    clock,
    getCurrentJoints: () => jointsAt(0),
    setJoints: () => {},
  })
  return runner.startEased(jointsAt(1))
})()
void _typeCheck

describe('Motion Runner 暂停后 retarget 的时间轴', () => {
  it('eased 暂停→继续→运行中 retarget 按新 duration 完成，且始终单帧循环', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    const result = runner.startEased(jointsAt(10), 100)
    clock.advanceBy(30)
    runner.pause()
    clock.advanceBy(5000)
    runner.resume()

    // 运行中同模式 retarget：从当前关节按新 duration(100) 重新开始，忽略历史暂停。
    runner.startEased(jointsAt(0), 100)
    expect(clock.pendingFrameCount()).toBeLessThanOrEqual(1)
    clock.advanceBy(100)

    expect(await result).toBe('completed')
    expect(joints).toEqual(jointsAt(0))
    expect(clock.pendingFrameCount()).toBe(0)
  })

  it('eased 暂停中 retarget 保持 paused、不创建 RAF，resume 后按新 duration 完成', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    const result = runner.startEased(jointsAt(10), 100)
    clock.advanceBy(30)
    runner.pause()
    clock.advanceBy(5000)

    runner.startEased(jointsAt(0), 50)
    expect(runner.getStatus()).toBe('paused')
    expect(clock.pendingFrameCount()).toBe(0)

    runner.resume()
    expect(runner.getStatus()).toBe('running')
    clock.advanceBy(50)
    expect(await result).toBe('completed')
    expect(joints).toEqual(jointsAt(0))
  })

  it('trajectory 暂停中 retarget 复用 Promise，resume 后准确到新终点', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(5)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    const result = runner.startTrajectory(timed(joints, [jointsAt(15), jointsAt(25)], 100))
    clock.advanceBy(30)
    runner.pause()
    clock.advanceBy(3000)

    // 暂停中同模式 retarget：更新轨迹与时间轴，复用原 Promise，状态保持 paused。
    const retarget = runner.startTrajectory(timed(joints, [jointsAt(35), jointsAt(45)], 80))
    expect(retarget).toBe(result)
    expect(runner.getStatus()).toBe('paused')
    expect(clock.pendingFrameCount()).toBe(0)

    runner.resume()
    clock.advanceBy(80)
    expect(await result).toBe('completed')
    expect(joints).toEqual(jointsAt(45))
    expect(clock.pendingFrameCount()).toBe(0)
  })

  it('eased 暂停中 retarget 后不额外等待历史暂停时间（暂停时间不影响新目标）', async () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    runner.startEased(jointsAt(10), 60)
    clock.advanceBy(20)
    runner.pause()
    clock.advanceBy(10_000)

    // 暂停很久后 retarget 到零姿态，resume 应立即从进度 0 开始（新 duration 1000）。
    const result = runner.startEased(jointsAt(0), 1000)
    runner.resume()
    // 只推进 1ms 也不应一次性跳到终点（历史暂停被清零）。
    clock.advanceBy(1)
    expect(joints[0]).toBeLessThan(10)
    expect(joints[0]).toBeGreaterThanOrEqual(0)
    clock.advanceBy(999)
    expect(await result).toBe('completed')
    expect(joints).toEqual(jointsAt(0))
  })
})

describe('Motion Runner 未来轨迹尾部追加', () => {
  it('追加目标不重置已执行段，关节轨迹单调到达最新尾部', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const samples: number[] = []
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
        samples.push(joints[0])
      },
    })

    runner.appendTrajectory(timed(joints, [jointsAt(10)], 100))
    clock.advanceBy(50)
    runner.appendTrajectory(timed(joints, [jointsAt(20)], 100))
    clock.advanceBy(50)
    clock.advanceBy(100)

    expect(samples.length).toBeGreaterThan(2)
    expect(samples.every((value, index) => index === 0 || value >= samples[index - 1])).toBe(true)
    expect(joints).toEqual(jointsAt(20))
  })

  it('连续新计划从实际状态接入并保持全部后缀', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const samples: number[] = []
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
        samples.push(joints[0])
      },
    })

    runner.appendTrajectory(timed(joints, [jointsAt(10)], 50))
    clock.advanceBy(50)
    runner.appendTrajectory(timed(joints, [jointsAt(15), jointsAt(20)], 50))
    clock.advanceBy(50)

    expect(samples.every((value, index) => index === 0 || value >= samples[index - 1])).toBe(true)
    expect(joints).toEqual(jointsAt(20))
  })

  it('新结果替换当前段时只在当前位置与最新终点之间运动', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
    })

    runner.appendTrajectory(timed(joints, [jointsAt(10)], 50))
    clock.advanceBy(25)
    runner.appendTrajectory(timed(joints, [jointsAt(5.5), jointsAt(6)], 50))
    clock.advanceBy(25)
    expect(joints[0]).toBeGreaterThanOrEqual(5)
    expect(joints[0]).toBeLessThanOrEqual(6)
  })

  it('连续目标替换丢弃旧计划，但保留新计划的中间路径点', () => {
    const clock = new ManualMotionClock()
    let joints = jointsAt(0)
    const samples: number[] = []
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
        samples.push(joints[0])
      },
    })

    runner.appendTrajectory(timed(joints, [jointsAt(10)], 50))
    clock.advanceBy(25)
    runner.appendTrajectory(timed(joints, [jointsAt(5), jointsAt(20), jointsAt(0)], 50))
    clock.advanceBy(25)

    expect(joints[0]).toBeGreaterThanOrEqual(0)
    expect(joints[0]).toBeCloseTo(12.5)
    expect(samples.length).toBeLessThan(10)
  })
})
