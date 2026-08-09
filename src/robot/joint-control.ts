import { computed, ref } from 'vue'
import { extractPose, forwardKinematicsDegrees } from '../core/robot/kinematics'
import type { JointAngles, PoseDisplay } from '../core/robot/types'
import {
  DEFAULT_JOINTS,
  KUKA_JOINT_RANGES,
  KUKA_LIKE,
} from '../robots/kuka-like/robot-config'

export const JOINT_STEPS = [0.1, 1, 5, 10] as const
export type JointStep = (typeof JOINT_STEPS)[number]
export type JointDirection = -1 | 1
export type JointRange = readonly [number, number]

export function clampJointAngle(index: number, value: number, ranges: readonly JointRange[] = KUKA_JOINT_RANGES): number {
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

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function calculatePose(joints: JointAngles): PoseDisplay {
  const matrix = forwardKinematicsDegrees(joints, KUKA_LIKE)
  const pose = extractPose(matrix)
  return {
    positionMm: pose.position,
    orientationDeg: pose.eulerZYX.map(toDegrees) as [number, number, number],
  }
}

/** Vue 状态层只暴露机器人命令，不把 Three.js 节点泄漏给控制面板。 */
export function useJointControl() {
  const joints = ref<JointAngles>([...DEFAULT_JOINTS])
  const jointStep = ref<JointStep>(1)
  const pose = computed(() => calculatePose(joints.value))

  function setJoint(index: number, value: number): void {
    joints.value = setJointAngle(joints.value, index, value)
  }

  function adjustJoint(index: number, direction: JointDirection): void {
    joints.value = adjustJointAngle(joints.value, index, direction, jointStep.value)
  }

  function setStep(value: number): void {
    if (isJointStep(value)) jointStep.value = value
  }

  function reset(): void {
    joints.value = [...DEFAULT_JOINTS]
  }

  function randomize(): void {
    joints.value = randomJointAngles()
  }

  return {
    joints,
    jointStep,
    jointRanges: KUKA_JOINT_RANGES,
    pose,
    setJoint,
    adjustJoint,
    setStep,
    reset,
    randomize,
  }
}
