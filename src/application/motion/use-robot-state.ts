import { computed, ref } from 'vue'
import { radToDeg } from '@/robot-geometry/math/angle.ts'
import type { RobotProfile } from '@/robot-geometry/robot-types.ts'
import type { JointAngles, PoseDisplay } from '@/robot-geometry/robot-types.ts'
import { isJointStep, type JointStep } from './joint-math.ts'

export interface RobotStateOptions {
  /** 关节控制从其唯一运行契约获得关节范围、回零状态与一体运动学模型。 */
  profile: RobotProfile
}

/** 持有唯一关节真值与 FK 派生状态；运动命令由 RobotController/Coordinator 处理。 */
export function useRobotState(options: RobotStateOptions) {
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

  /** 仅供装配层接入 Coordinator 即时写入与 Runner 帧推进，不直接交给面板。 */
  function setJoints(next: JointAngles): void {
    joints.value = [...next]
  }

  function setStep(value: number): void {
    if (isJointStep(value)) jointStep.value = value
  }

  return {
    joints,
    jointStep,
    jointRanges: ranges,
    pose,
    setJoints,
    setStep,
  }
}
