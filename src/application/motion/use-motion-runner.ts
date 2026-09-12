import { onBeforeUnmount } from 'vue'
import {
  createMotionRunner,
  type MotionClock,
  type MotionResult,
  type MotionStatus,
} from '@/robot-motion-core/playback/runner.ts'
import type { JointAngles } from '@/robot-geometry/robot-types.ts'
import type { MotionConfig } from '@/robot-motion-core/playback/playback-config.ts'

export interface MotionRunnerOptions {
  getCurrentJoints: () => JointAngles
  setJoints: (joints: JointAngles) => void
  motionConfig?: MotionConfig
}

/** Vue 只提供浏览器时钟 adapter，并在卸载时停止深层 Motion Runner。 */
export function useMotionRunner(options: MotionRunnerOptions) {
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
    appendCartesianTrajectory: runner.appendTrajectory,
    pauseMotion: runner.pause,
    resumeMotion: runner.resume,
    getMotionStatus: runner.getStatus,
  }
}

// 重新导出类型，便于上层以显式类型消费生命周期能力。
export type { MotionResult, MotionStatus }
