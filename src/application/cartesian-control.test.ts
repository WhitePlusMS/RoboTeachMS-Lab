import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import { poseFromJoints } from '@/robotics/kinematics.ts'
import { radToDeg } from '@/robotics/math/angle.ts'
import { applyCartesianDelta, useCartesianControl } from './cartesian-control.ts'
import type { JointAngles, PoseDisplay } from '@/robotics/types.ts'
import { AbbDhRobotModel } from '@/robot-models/abb-irb1200/dh-robot-model.ts'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import type { RobotProfile, SixAxisJointRanges } from '@/robotics/robot-profile.ts'
import {
  KUKA_JOINT_RANGES,
  KUKA_LIKE,
  DEFAULT_JOINTS,
} from '@/robot-models/kuka-like/robot-config.ts'
import { DhRobotModel } from '@/robot-models/kuka-like/dh-robot-model.ts'

/** 测试用 KUKA 局部 profile；沿用既有 KUKA 模型与常量，不迁移 KUKA 实现。 */
const KUKA_PROFILE: RobotProfile = {
  id: 'test-kuka',
  displayName: KUKA_LIKE.name,
  model: new DhRobotModel(),
  jointRanges: KUKA_JOINT_RANGES as SixAxisJointRanges,
  homeJoints: DEFAULT_JOINTS,
}

const pose: PoseDisplay = {
  positionMm: [100, 200, 300],
  orientationDeg: [0, 0, 90],
}

describe('笛卡尔坐标增量', () => {
  it('World 坐标沿世界 X 轴移动', () => {
    const next = applyCartesianDelta(pose, 'x', 1, 10, 'World')

    expect(next.positionMm).toEqual([110, 200, 300])
  })

  it('Tool 坐标会把局部 X 轴转换为当前工具朝向', () => {
    const next = applyCartesianDelta(pose, 'x', 1, 10, 'Tool')

    expect(next.positionMm[0]).toBeCloseTo(100)
    expect(next.positionMm[1]).toBeCloseTo(210)
    expect(next.positionMm[2]).toBeCloseTo(300)
  })

  it('非法输入只更新失败状态，不覆盖当前关节', () => {
    const joints = ref<JointAngles>([...DEFAULT_JOINTS])
    const poseRef = computed(() => poseFromJoints(joints.value, KUKA_LIKE))
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: KUKA_PROFILE,
      moveToTrajectory: (trajectory) => {
        const finalJoints = trajectory[trajectory.length - 1]
        if (finalJoints) joints.value = [...finalJoints]
      },
    })
    const before = [...joints.value]

    control.setField('x', Number.NaN)

    expect(control.status.value).toBe('invalid')
    expect(joints.value).toEqual(before)
  })

  it('不可达目标只更新失败状态，不覆盖当前关节', () => {
    const joints = ref<JointAngles>([...DEFAULT_JOINTS])
    const poseRef = computed(() => poseFromJoints(joints.value, KUKA_LIKE))
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: KUKA_PROFILE,
      moveToTrajectory: (trajectory) => {
        const finalJoints = trajectory[trajectory.length - 1]
        if (finalJoints) joints.value = [...finalJoints]
      },
    })
    const before = [...joints.value]

    control.setField('x', 100000)

    expect(control.status.value).toBe('unreachable')
    expect(joints.value).toEqual(before)
  })

  it('向 ABB 动画层提交分段笛卡尔轨迹，而不是单个终点关节角', () => {
    const model = new AbbDhRobotModel()
    const joints = ref<JointAngles>([15, -20, 30, 10, 25, -15])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    let submittedTrajectory: readonly JointAngles[] = []
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      moveToTrajectory: (trajectory) => {
        submittedTrajectory = trajectory
      },
    })

    control.setField('x', poseRef.value.positionMm[0] + 5)

    expect(control.status.value).toBe('solved')
    expect(submittedTrajectory.length).toBeGreaterThanOrEqual(5)
  })
})
