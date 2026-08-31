import type { JointRange } from '@/robot-geometry/model/robot-profile.ts'
import type { JointAngles } from '@/robot-geometry/model/index.ts'
import { KUKA_JOINT_RANGES } from '@/robot-models/kuka-like/parameters.ts'

export const JOINT_STEPS = [0.1, 1, 5, 10] as const
export type JointStep = (typeof JOINT_STEPS)[number]
export type JointDirection = -1 | 1

export function clampJointAngle(
  index: number,
  value: number,
  ranges: readonly JointRange[] = KUKA_JOINT_RANGES,
): number {
  if (!Number.isFinite(value) || !ranges[index]) return ranges[index]?.[0] ?? 0
  const [min, max] = ranges[index]
  return Math.min(max, Math.max(min, value))
}
export function setJointAngle(
  joints: JointAngles,
  index: number,
  value: number,
  ranges: readonly JointRange[] = KUKA_JOINT_RANGES,
): JointAngles {
  if (index < 0 || index >= joints.length) return [...joints] as JointAngles
  const next = [...joints] as JointAngles
  next[index] = clampJointAngle(index, value, ranges)
  return next
}

export function adjustJointAngle(
  joints: JointAngles,
  index: number,
  direction: JointDirection,
  step: number,
  ranges: readonly JointRange[] = KUKA_JOINT_RANGES,
): JointAngles {
  return setJointAngle(joints, index, joints[index] + direction * step, ranges)
}

export function randomJointAngles(
  ranges: readonly JointRange[] = KUKA_JOINT_RANGES,
  random: () => number = Math.random,
): JointAngles {
  return ranges.map(([min, max]) => {
    const value = min + Math.min(1, Math.max(0, random())) * (max - min)
    return Math.round(value * 10) / 10
  }) as JointAngles
}

export function isJointStep(value: number): value is JointStep {
  return JOINT_STEPS.some((step) => step === value)
}
