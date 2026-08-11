import { DEFAULT_MOTION_CONFIG, easeInOutCubic, lerpJoints } from './motion-smoothing'
import type { JointAngles, MotionConfig } from './types'

type MotionType = 'none' | 'joint-eased' | 'joint-speed' | 'joint-trajectory'

/**
 * 动画时钟接缝。
 *
 * 生产环境由浏览器 RAF adapter 实现，测试由手动时钟 adapter 实现；Motion Runner
 * 不感知 Vue、window 或 performance，完整生命周期可以通过同一个 interface 验证。
 */
export interface MotionClock {
  now: () => number
  requestFrame: (callback: () => void) => number
  cancelFrame: (frameId: number) => void
}

export interface MotionRunnerOptions {
  clock: MotionClock
  getCurrentJoints: () => JointAngles
  setJoints: (joints: JointAngles) => void
  motionConfig?: MotionConfig
}

export interface MotionRunner {
  startEased: (target: JointAngles, duration?: number) => void
  startSpeedLimited: (target: JointAngles) => void
  startTrajectory: (waypoints: readonly JointAngles[], duration?: number) => void
  stop: () => void
}

/**
 * 管理单一关节运动生命周期：模式切换、目标替换、时间推进和停止语义均封装在内部。
 * 同类目标会复用当前帧循环，避免连续输入造成 cancel/restart 卡顿。
 */
export function createMotionRunner(options: MotionRunnerOptions): MotionRunner {
  const config = options.motionConfig ?? DEFAULT_MOTION_CONFIG
  let frameId: number | null = null
  let activeType: MotionType = 'none'
  let targetJoints: JointAngles = [...options.getCurrentJoints()]
  let startJoints: JointAngles = [...targetJoints]
  let startTime = 0
  let lastTime: number | null = null
  let animationDuration = config.ikAnimDuration
  let trajectoryJoints: JointAngles[] = []

  function requestFrame(callback: () => void): void {
    frameId = options.clock.requestFrame(callback)
  }

  function cancelFrame(): void {
    if (frameId !== null) options.clock.cancelFrame(frameId)
    frameId = null
  }

  function finish(): void {
    frameId = null
    activeType = 'none'
    lastTime = null
  }

  function stop(): void {
    cancelFrame()
    activeType = 'none'
    lastTime = null
  }

  function runEased(): void {
    const elapsed = options.clock.now() - startTime
    const progress = Math.min(Math.max(elapsed / animationDuration, 0), 1)
    options.setJoints(lerpJoints(startJoints, targetJoints, progress) as JointAngles)

    if (progress < 1) requestFrame(runEased)
    else finish()
  }

  function runSpeedLimited(): void {
    const now = options.clock.now()
    const deltaTime = Math.max(now - (lastTime ?? now), 0)
    lastTime = now
    const current = options.getCurrentJoints()
    const maxStep = (config.jointSpeedLimit * deltaTime) / 1000
    const next = current.map((value, index) => {
      const difference = targetJoints[index] - value
      if (Math.abs(difference) < config.snapThreshold) return targetJoints[index]
      return value + Math.sign(difference) * Math.min(Math.abs(difference), maxStep)
    }) as JointAngles

    options.setJoints(next)
    const completed = next.every(
      (value, index) => Math.abs(value - targetJoints[index]) < config.snapThreshold,
    )
    if (completed) finish()
    else requestFrame(runSpeedLimited)
  }

  function runTrajectory(): void {
    const elapsed = options.clock.now() - startTime
    const progress = easeInOutCubic(Math.min(Math.max(elapsed / animationDuration, 0), 1))
    const segmentPosition = progress * (trajectoryJoints.length - 1)
    const segmentIndex = Math.min(Math.floor(segmentPosition), trajectoryJoints.length - 2)
    const segmentProgress = segmentPosition - segmentIndex
    const start = trajectoryJoints[segmentIndex]
    const end = trajectoryJoints[segmentIndex + 1]
    options.setJoints(start.map((value, index) =>
      value + (end[index] - value) * segmentProgress,
    ) as JointAngles)

    if (progress < 1) requestFrame(runTrajectory)
    else finish()
  }

  function startEased(target: JointAngles, duration = config.ikAnimDuration): void {
    targetJoints = [...target]
    startJoints = [...options.getCurrentJoints()]
    startTime = options.clock.now()
    animationDuration = Math.max(duration, 1)

    if (activeType === 'joint-eased') return

    cancelFrame()
    activeType = 'joint-eased'
    lastTime = null
    requestFrame(runEased)
  }

  function startSpeedLimited(target: JointAngles): void {
    targetJoints = [...target]
    if (activeType === 'joint-speed') return

    cancelFrame()
    activeType = 'joint-speed'
    lastTime = options.clock.now()
    requestFrame(runSpeedLimited)
  }

  function startTrajectory(waypoints: readonly JointAngles[], duration = config.ikAnimDuration): void {
    if (waypoints.length === 0) return
    trajectoryJoints = [
      [...options.getCurrentJoints()] as JointAngles,
      ...waypoints.map((waypoint) => [...waypoint] as JointAngles),
    ]
    startTime = options.clock.now()
    animationDuration = Math.max(duration, 1)

    if (activeType === 'joint-trajectory') return

    cancelFrame()
    activeType = 'joint-trajectory'
    lastTime = null
    requestFrame(runTrajectory)
  }

  return { startEased, startSpeedLimited, startTrajectory, stop }
}
