import { computed, ref } from 'vue'
import { radToDeg } from '@/robot-geometry/math/angle.ts'
import type { RobotProfile } from '@/robot-geometry/model/robot-profile.ts'
import type { JointAngles, PoseDisplay } from '@/robot-geometry/model/index.ts'
import {
  adjustJointAngle,
  isJointStep,
  randomJointAngles,
  setJointAngle,
  type JointDirection,
  type JointStep,
} from './joint-math.ts'

export interface JointControlOptions {
  /** 关节控制从其唯一运行契约获得关节范围、回零状态与一体运动学模型。 */
  profile: RobotProfile
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
