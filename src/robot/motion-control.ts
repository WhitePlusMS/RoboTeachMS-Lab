import { onBeforeUnmount, ref } from 'vue'
import {
  DEFAULT_MOTION_CONFIG,
  lerpJoints,
} from '../core/robot/motion-smoothing'
import type { JointAngles, MotionConfig } from '../core/robot/types'

type MotionType = 'none' | 'joint-eased' | 'joint-speed'

export interface MotionControlOptions {
  getCurrentJoints: () => JointAngles
  setJoints: (joints: JointAngles) => void
  motionConfig?: MotionConfig
}

/**
 * 关节动画循环管理。
 *
 * 目标更新时复用正在运行的 RAF：缓动动画重置当前起点，限速动画只替换目标，
 * 从而避免长按或连续逆解调用造成 cancel/restart 的视觉卡顿。
 */
export function useMotion(options: MotionControlOptions) {
  const config = options.motionConfig ?? DEFAULT_MOTION_CONFIG
  const isAnimating = ref(false)
  const isAnimatingRef = { current: false }

  let animationId: number | null = null
  let activeType: MotionType = 'none'
  let targetJoints: JointAngles = [...options.getCurrentJoints()]
  let startJoints: JointAngles = [...targetJoints]
  let startTime = 0
  let lastTime = 0
  let animationDuration = config.ikAnimDuration

  function requestFrame(callback: () => void): void {
    animationId = window.requestAnimationFrame(callback)
  }

  function cancelFrame(): void {
    if (animationId !== null) window.cancelAnimationFrame(animationId)
    animationId = null
  }

  function finishAnimation(): void {
    animationId = null
    activeType = 'none'
    isAnimating.value = false
    isAnimatingRef.current = false
  }

  function stopAnimation(): void {
    cancelFrame()
    activeType = 'none'
    isAnimating.value = false
    isAnimatingRef.current = false
  }

  function runEasedAnimation(): void {
    const elapsed = performance.now() - startTime
    const progress = Math.min(elapsed / animationDuration, 1)
    options.setJoints(lerpJoints(startJoints, targetJoints, progress) as JointAngles)

    if (progress < 1) requestFrame(runEasedAnimation)
    else finishAnimation()
  }

  function runSpeedLimitedAnimation(): void {
    const now = performance.now()
    const deltaTime = lastTime > 0 ? now - lastTime : 16
    lastTime = now
    const current = options.getCurrentJoints()
    const maxStep = (config.jointSpeedLimit * deltaTime) / 1000
    const next = current.map((value, index) => {
      const difference = targetJoints[index] - value
      if (Math.abs(difference) < config.snapThreshold) return targetJoints[index]
      return value + Math.sign(difference) * Math.min(Math.abs(difference), maxStep)
    }) as JointAngles

    options.setJoints(next)
    const allClose = next.every(
      (value, index) => Math.abs(value - targetJoints[index]) < config.snapThreshold,
    )
    if (allClose) finishAnimation()
    else requestFrame(runSpeedLimitedAnimation)
  }

  function startEasedAnimation(target: JointAngles, duration = config.ikAnimDuration): void {
    targetJoints = [...target]

    if (activeType === 'joint-eased') {
      startJoints = [...options.getCurrentJoints()]
      startTime = performance.now()
      animationDuration = Math.max(duration, 1)
      return
    }

    cancelFrame()
    startJoints = [...options.getCurrentJoints()]
    startTime = performance.now()
    animationDuration = Math.max(duration, 1)
    lastTime = 0
    activeType = 'joint-eased'
    isAnimating.value = true
    isAnimatingRef.current = true
    requestFrame(runEasedAnimation)
  }

  function startSpeedLimitedAnimation(target: JointAngles): void {
    targetJoints = [...target]
    if (activeType === 'joint-speed') return

    cancelFrame()
    lastTime = 0
    activeType = 'joint-speed'
    isAnimating.value = true
    isAnimatingRef.current = true
    requestFrame(runSpeedLimitedAnimation)
  }

  onBeforeUnmount(stopAnimation)

  return {
    isAnimating,
    isAnimatingRef,
    stopAnimation,
    startEasedAnimation,
    startSpeedLimitedAnimation,
  }
}
