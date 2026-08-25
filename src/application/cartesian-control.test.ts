import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import { poseFromJoints } from '@/robotics/kinematics/legacy-dh-forward-kinematics.ts'
import { radToDeg } from '@/robotics/math/angle.ts'
import { applyCartesianDelta, useCartesianControl } from './cartesian-control.ts'
import type { CartesianPathResult } from '@/robotics/cartesian/path-planner.ts'
import type { JointAngles, PoseDisplay } from '@/robotics/model/types.ts'
import { AbbDhRobotModel } from '@/robot-models/abb-irb1200/kinematics/abb-robot-model-adapter.ts'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/profile.ts'
import type { RobotProfile, SixAxisJointRanges } from '@/robotics/model/robot-profile.ts'
import {
  KUKA_JOINT_RANGES,
  KUKA_LIKE,
  DEFAULT_JOINTS,
} from '@/robot-models/kuka-like/parameters.ts'
import { DhRobotModel } from '@/robot-models/kuka-like/kinematics/kuka-robot-model-adapter.ts'

/** 测试用 KUKA 局部 profile；沿用既有 KUKA 模型与常量，不迁移 KUKA 实现。 */
const KUKA_PROFILE: RobotProfile = {
  id: 'test-kuka',
  displayName: KUKA_LIKE.name,
  model: new DhRobotModel(),
  jointRanges: KUKA_JOINT_RANGES as SixAxisJointRanges,
  homeJoints: DEFAULT_JOINTS,
  mechanicalZeroJoints: DEFAULT_JOINTS,
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

    expect(control.status.value).toBe('joint-step')
    expect(joints.value).toEqual(before)
  })

  it('路径失败时展示具体不可继续的关节轴', () => {
    const joints = ref<JointAngles>([...DEFAULT_JOINTS])
    const poseRef = computed(() => poseFromJoints(joints.value, KUKA_LIKE))
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: KUKA_PROFILE,
      planTarget: () => ({
        ok: false,
        failure: 'ik-not-converged',
        diagnostic: {
          waypointIndex: 8,
          axisIndex: 3,
          previousAngleDeg: 12.3,
          attemptedAngleDeg: 21.1,
          deltaDeg: 8.8,
          limitRangeDeg: [-270, 270],
        },
      }),
      moveToTrajectory: () => undefined,
    })

    control.setField('x', poseRef.value.positionMm[0] + 1)

    expect(control.status.value).toBe('unreachable')
    expect(control.statusMessage.value).toContain('J4 无法继续')
    expect(control.statusMessage.value).toContain('第 8 个路径点')
    expect(control.statusMessage.value).toContain('变化 8.80°')
  })

  it('机械零位 Y 点动不再使用 SingArea\\Wrist，并提交轨迹', () => {
    const model = new AbbDhRobotModel()
    const joints = ref<JointAngles>([0, 0, 0, 0, 30, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      if (!currentPose) return { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      moveToTrajectory: (trajectory) => {
        const finalJoints = trajectory[trajectory.length - 1]
        if (finalJoints) joints.value = [...finalJoints]
      },
    })
    const before = [...joints.value]

    control.setPositionStep(1)
    control.move('y', 1)

    expect(control.status.value).toBe('solved')
    expect(joints.value).not.toEqual(before)
  })

  it('机械零位先 X+10 mm 后仍可正常 Y 点动', () => {
    const model = new AbbDhRobotModel()
    const joints = ref<JointAngles>([0, 0, 0, 0, 30, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      if (!currentPose) return { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      moveToTrajectory: (trajectory) => {
        const finalJoints = trajectory[trajectory.length - 1]
        if (finalJoints) joints.value = [...finalJoints]
      },
    })
    control.setPositionStep(10)

    control.move('x', 1)
    expect(model.isMechanicalZeroSingularityNeighborhood(joints.value)).toBe(false)
    const yBefore = poseRef.value.positionMm[1]

    control.move('y', 1)

    expect(control.status.value).toBe('solved')
    expect(poseRef.value.positionMm[1]).toBeGreaterThan(yBefore + 9)
  })

  it('机械零位字段直达不再进入 wrist 回退入口', () => {
    const model = new AbbDhRobotModel()
    const joints = ref<JointAngles>([0, 0, 0, 0, 30, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      moveToTrajectory: () => undefined,
    })

    control.setField('y', poseRef.value.positionMm[1] + 1)

    expect(control.status.value).toBe('solved')
  })

  it('非机械零位工作区的 J5=0 大步长不得显示机械零位重构提示', () => {
    const model = new AbbDhRobotModel()
    const joints = ref<JointAngles>([15, -20, 30, 0, 0, -300])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      moveToTrajectory: () => undefined,
    })

    control.setField('x', poseRef.value.positionMm[0] + 5)

    expect(control.status.value).toBe('joint-step')
    expect(control.statusMessage.value).toContain('路径相邻关节步长超过连续运动限制')
    expect(control.statusMessage.value).not.toContain('目标将导致机器人构型重新配置')
    expect(control.statusMessage.value).not.toContain('保留最近一次有效姿态')
  })

  it('非奇异位置连续点动每次推进目标且不显示腕部插补', () => {
    const model = new AbbDhRobotModel()
    const joints = ref<JointAngles>([0, -25, 45, 0, 20, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const submitted: JointAngles[] = []
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      moveToTrajectory: (trajectory) => {
        const finalJoints = trajectory[trajectory.length - 1]
        if (finalJoints) {
          submitted.push([...finalJoints] as JointAngles)
          joints.value = [...finalJoints]
        }
      },
    })
    const initialX = poseRef.value.positionMm[0]

    for (let index = 0; index < 5; index += 1) {
      control.move('x', 1, true)
      expect(control.status.value).toBe('solved')
    }

    expect(submitted).toHaveLength(5)
    expect(poseRef.value.positionMm[0]).toBeGreaterThan(initialX + 4)
  })

  it('连续同步规划在动画尚未回写关节时仍从最新目标锚点递进', () => {
    const model = new AbbDhRobotModel()
    const joints = ref<JointAngles>([0, -25, 45, 0, 20, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const submittedX: number[] = []
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      // 模拟动画帧尚未回写关节：会话锚点仍应把目标向未来累加。
      moveToTrajectory: (trajectory) => {
        const finalJoints = trajectory[trajectory.length - 1]
        if (finalJoints) submittedX.push(model.forwardKinematics(finalJoints).position[0])
      },
    })

    for (let index = 0; index < 3; index += 1) control.move('x', 1, true)

    expect(submittedX).toHaveLength(3)
    expect(submittedX[1] - submittedX[0]).toBeCloseTo(1, 8)
    expect(submittedX[2] - submittedX[1]).toBeCloseTo(1, 8)
  })

  it('异步连续规划只提交最新结果，过期轨迹不会覆盖新目标', async () => {
    const joints = ref<JointAngles>([0, -25, 45, 0, 20, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = new AbbDhRobotModel().forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const resolvers: Array<(result: CartesianPathResult) => void> = []
    const submitted: readonly JointAngles[][] = []
    const trajectories: JointAngles[][] = []
    const control = useCartesianControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      planTarget: () =>
        new Promise<CartesianPathResult>((resolve) => {
          resolvers.push(resolve)
        }),
      moveToTrajectory: (trajectory) => trajectories.push([...trajectory] as JointAngles[]),
    })

    control.move('x', 1, true)
    control.move('x', 1, true)
    expect(control.status.value).toBe('planning')

    resolvers[0]({ ok: true, waypoints: [[1, 1, 1, 1, 1, 1]], appliedSingularityMode: null })
    await Promise.resolve()
    expect(resolvers).toHaveLength(2)
    resolvers[1]({ ok: true, waypoints: [[2, 2, 2, 2, 2, 2]], appliedSingularityMode: null })
    await Promise.resolve()

    expect(trajectories).toEqual([[[2, 2, 2, 2, 2, 2]]])
    expect(submitted).toHaveLength(0)
    expect(control.status.value).toBe('solved')
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
