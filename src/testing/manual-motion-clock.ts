import type { MotionClock } from '@/robot-motion-core/playback/runner.ts'

/**
 * 测试用手动时钟：可精确控制时间推进，供运动生命周期相关单测复用。
 * 仅用于测试，不进入运行时链路。
 */
export class ManualMotionClock implements MotionClock {
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
