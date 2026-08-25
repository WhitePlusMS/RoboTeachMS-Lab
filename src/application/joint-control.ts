import { computed, ref } from 'vue'
import { radToDeg } from '@/robotics/math/angle.ts'
import type { JointRange, RobotProfile } from '@/robotics/model/robot-profile.ts'
import type { JointAngles, PoseDisplay } from '@/robotics/model/types.ts'
import { KUKA_JOINT_RANGES } from '@/robot-models/kuka-like/parameters.ts'

export const JOINT_STEPS = [0.1, 1, 5, 10] as const
export type JointStep = (typeof JOINT_STEPS)[number]
export type JointDirection = -1 | 1

export interface JointControlOptions {
  /** 关节控制从其唯一运行契约获得关节范围、回零状态与一体运动学模型。 */
  profile: RobotProfile
}

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

/** Vue 状态层只暴露机器人命令，不把 Three.js 节点泄漏给控制面板。 */
export function useJointControl(options: JointControlOptions) {
  const { profile } = options
  const ranges = profile.jointRanges
  const homeJoints = profile.homeJoints
  const joints = ref<JointAngles>([...homeJoints])
  const jointStep = ref<JointStep>(1)
  const pose = computed<PoseDisplay>(() => {
    const current = profile.model.forwardKinematics(joints.value)
    if (!current) {
      return { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }
    }
    return {
      positionMm: [...current.position] as PoseDisplay['positionMm'],
      orientationDeg: current.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
    }
  })

  function setJoint(index: number, value: number): void {
    joints.value = setJointAngle(joints.value, index, value, ranges)
  }

  function setJoints(next: JointAngles): void {
    joints.value = [...next]
  }

  function adjustJoint(index: number, direction: JointDirection): void {
    joints.value = adjustJointAngle(joints.value, index, direction, jointStep.value, ranges)
  }

  function setStep(value: number): void {
    if (isJointStep(value)) jointStep.value = value
  }

  function reset(): void {
    joints.value = [...homeJoints]
  }

  function randomize(): void {
    joints.value = randomJointAngles(ranges)
  }

  return {
    joints,
    jointStep,
    jointRanges: ranges,
    pose,
    setJoint,
    setJoints,
    adjustJoint,
    setStep,
    reset,
    randomize,
  }
}
