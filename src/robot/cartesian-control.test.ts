import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import { poseFromJoints } from '../core/robot/kinematics'
import { radToDeg } from '../core/robot/math/angle'
import {
  applyCartesianDelta,
  useCartesianControl,
} from './cartesian-control'
import type { JointAngles, PoseDisplay } from '../core/robot/types'
import { AbbDhRobotModel } from '../robots/abb-irb1200/dh-robot-model'
import { ABB_JOINT_RANGES } from '../robots/abb-irb1200/robot-config'
import { DEFAULT_JOINTS, KUKA_JOINT_RANGES, KUKA_LIKE } from '../robots/kuka-like/robot-config'
import { DhRobotModel } from '../robots/kuka-like/dh-robot-model'

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
      robotModel: ref(new DhRobotModel()),
      jointRanges: KUKA_JOINT_RANGES,
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
      robotModel: ref(new DhRobotModel()),
      jointRanges: KUKA_JOINT_RANGES,
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
      robotModel: ref(model),
      jointRanges: ABB_JOINT_RANGES,
      moveToTrajectory: (trajectory) => {
        submittedTrajectory = trajectory
      },
    })

    control.setField('x', poseRef.value.positionMm[0] + 5)

    expect(control.status.value).toBe('solved')
    expect(submittedTrajectory.length).toBeGreaterThanOrEqual(5)
  })
})
