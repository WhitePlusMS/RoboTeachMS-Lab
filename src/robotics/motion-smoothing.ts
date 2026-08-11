import type { MotionConfig } from './types.ts'

/** 原始项目的默认运动过渡参数。 */
export const DEFAULT_MOTION_CONFIG: MotionConfig = {
  jointSpeedLimit: 60,
  ikAnimDuration: 800,
  snapThreshold: 0.1,
}

/** 单击和目标姿态切换使用的 easeInOutCubic 缓动。 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** 对每个关节做统一时间轴的缓动插值，保持关节相对运动关系。 */
export function lerpJoints(start: readonly number[], end: readonly number[], t: number): number[] {
  const eased = easeInOutCubic(t)
  return start.map((value, index) => value + (end[index] - value) * eased)
}
