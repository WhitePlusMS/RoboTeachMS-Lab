import { onBeforeUnmount } from 'vue'
import {
  createMotionRunner,
  type MotionClock,
  type MotionResult,
  type MotionStatus,
} from '@/robotics/motion-runner.ts'
import type { JointAngles, MotionConfig } from '@/robotics/types.ts'

export interface MotionControlOptions {
  getCurrentJoints: () => JointAngles
  setJoints: (joints: JointAngles) => void
  motionConfig?: MotionConfig
}

/** Vue 只提供浏览器时钟 adapter，并在卸载时停止深层 Motion Runner。 */
export function useMotion(options: MotionControlOptions) {
  const clock: MotionClock = {
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
  }
  const runner = createMotionRunner({ ...options, clock })

  onBeforeUnmount(runner.stop)

  return {
    stopAnimation: runner.stop,
    startEasedAnimation: runner.startEased,
    startSpeedLimitedAnimation: runner.startSpeedLimited,
    startCartesianTrajectory: runner.startTrajectory,
    pauseMotion: runner.pause,
    resumeMotion: runner.resume,
    getMotionStatus: runner.getStatus,
  }
}

// 重新导出类型，便于上层以显式类型消费生命周期能力。
export type { MotionResult, MotionStatus }
