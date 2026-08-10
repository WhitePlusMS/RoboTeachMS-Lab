import { onBeforeUnmount } from 'vue'
import { createMotionRunner, type MotionClock } from '../core/robot/motion-runner'
import type { JointAngles, MotionConfig } from '../core/robot/types'

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
  }
}
