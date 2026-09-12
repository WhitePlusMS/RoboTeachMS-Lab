import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { poseFromJoints } from '@/robot-models/kuka-like/kinematics/legacy-forward-kinematics.ts'
import { radToDeg } from '@/robot-geometry/math/angle.ts'
import {
  useCartesianJog,
  type CartesianJogOptions,
  type CartesianPathResult,
} from './use-cartesian-jog.ts'
import { planCartesianPath } from '@/robot-motion-core/cartesian/linear-path-planner.ts'
import type { JointAngles, PoseDisplay } from '@/robot-geometry/robot-types.ts'
import type { MotionCommandOutcome } from './motion-coordinator.ts'
import { createCartesianTargetRequest } from './manual-motion-request.ts'
import { quaternionToRotationMatrix } from '@/robot-geometry/math/rotation3d.ts'
import { AbbRobotModelAdapter } from '@/robot-models/abb-irb1200/index.ts'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/index.ts'
import type { RobotProfile, SixAxisJointRanges } from '@/robot-geometry/robot-types.ts'
import {
  KUKA_JOINT_RANGES,
  KUKA_LIKE,
  DEFAULT_JOINTS,
} from '@/robot-models/kuka-like/parameters.ts'
import { KukaRobotModelAdapter } from '@/robot-models/kuka-like/kinematics/kuka-robot-model-adapter.ts'

/** 测试用 KUKA 局部 profile；沿用既有 KUKA 模型与常量，不迁移 KUKA 实现。 */
const KUKA_PROFILE: RobotProfile = {
  id: 'test-kuka',
  revision: 'test-v1',
  displayName: KUKA_LIKE.name,
  model: new KukaRobotModelAdapter(),
  jointRanges: KUKA_JOINT_RANGES as SixAxisJointRanges,
  homeJoints: DEFAULT_JOINTS,
  mechanicalZeroJoints: DEFAULT_JOINTS,
}

type LegacyPlanTarget = (
  target: {
    position: [number, number, number]
    euler: [number, number, number]
    rotation: number[][]
  },
  initial: JointAngles,
  context: { isContinuous: boolean },
) => CartesianPathResult | Promise<CartesianPathResult | null>
type TestControlOptions = Omit<CartesianJogOptions, 'submitMotion' | 'buildRequest'> & {
  planTarget?: LegacyPlanTarget
  moveToTrajectory?: (trajectory: readonly JointAngles[], isContinuous?: boolean) => void
  deferMotionOutcome?: boolean
}

function createControl(options: TestControlOptions) {
  const {
    planTarget: suppliedPlanTarget,
    moveToTrajectory,
    deferMotionOutcome,
    ...controlOptions
  } = options
  const planTarget: LegacyPlanTarget =
    suppliedPlanTarget ??
    ((target, initial) =>
      planCartesianPath(target, initial, options.profile.model, options.profile.jointRanges, {
        preserveConfiguration: false,
      }))
  const submitMotion = (
    request: Parameters<CartesianJogOptions['submitMotion']>[0],
    mode: Parameters<CartesianJogOptions['submitMotion']>[1],
    _durationMs?: number,
    _continuous?: boolean,
    onPlanAccepted?: Parameters<CartesianJogOptions['submitMotion']>[4],
  ): MotionCommandOutcome | Promise<MotionCommandOutcome> => {
    if (request.intent.kind !== 'linear-path') {
      throw new Error('测试 Cartesian 控制只接受 cartesian-target request')
    }
    const euler = [0, 0, 0] as [number, number, number]
    const target = {
      position: [...request.intent.targetTcpPose.positionMm] as [number, number, number],
      euler,
      rotation: quaternionToRotationMatrix([
        request.intent.targetTcpPose.quaternionWxyz[1],
        request.intent.targetTcpPose.quaternionWxyz[2],
        request.intent.targetTcpPose.quaternionWxyz[3],
        request.intent.targetTcpPose.quaternionWxyz[0],
      ]),
    }
    const context = { isContinuous: mode === 'stream' }
    const toOutcome = (
      path: CartesianPathResult | null,
    ): MotionCommandOutcome | Promise<MotionCommandOutcome> => {
      if (path === null || !path.ok) {
        const details: Readonly<Record<string, string | number | boolean | null>> = path?.diagnostic
          ? {
              waypointIndex: path.diagnostic.waypointIndex,
              axisIndex: path.diagnostic.axisIndex,
              previousAngleDeg: path.diagnostic.previousAngleDeg,
              attemptedAngleDeg: path.diagnostic.attemptedAngleDeg ?? null,
              deltaDeg: path.diagnostic.deltaDeg ?? null,
            }
          : { reason: 'test-planning-failure' }
        return {
          ok: false,
          reason: 'planning-failure',
          result: {
            ok: false,
            error: {
              code:
                path?.coreError?.code ??
                (path?.failure === 'joint-step'
                  ? 'path-discontinuity'
                  : path?.failure === 'joint-limit'
                    ? 'joint-limit'
                    : path?.failure === 'wrist-singularity'
                      ? 'wrist-singularity'
                      : 'unreachable'),
              category: 'planning-failure',
              details,
            },
          },
        }
      }
      const waypoints = [
        { timeMs: 0, jointsDeg: request.state.jointsDeg },
        ...path.waypoints.map((joints, index) => ({ timeMs: index + 1, jointsDeg: joints })),
      ]
      moveToTrajectory?.(path.waypoints, context.isContinuous)
      const acceptedPlan = {
        ok: true as const,
        waypoints,
        end: { jointsDeg: waypoints.at(-1)?.jointsDeg ?? request.state.jointsDeg },
        validation: {
          relaxedConstraints: path.appliedSingularityMode ? ['orientation'] : undefined,
        },
      }
      const outcome: MotionCommandOutcome = {
        ok: true,
        result: 'completed',
        plan: acceptedPlan,
      }
      if (deferMotionOutcome) {
        // 模拟 Runner 仍在运动：计划先被接受，运动结果 Promise 暂不结算。
        queueMicrotask(() => onPlanAccepted?.(acceptedPlan))
        return new Promise<MotionCommandOutcome>(() => {})
      }
      onPlanAccepted?.(acceptedPlan)
      return outcome
    }
    const planned = planTarget(target, [...request.state.jointsDeg] as JointAngles, context)
    return planned instanceof Promise ? planned.then(toOutcome) : toOutcome(planned)
  }
  return useCartesianJog({
    ...controlOptions,
    buildRequest: createCartesianTargetRequest,
    submitMotion,
  })
}

describe('笛卡尔坐标增量', () => {
  it('非法输入只更新失败状态，不覆盖当前关节', () => {
    const joints = ref<JointAngles>([...DEFAULT_JOINTS])
    const poseRef = computed(() => poseFromJoints(joints.value, KUKA_LIKE))
    const control = createControl({
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
    const control = createControl({
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
    const control = createControl({
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

  /**
   * 特征化测试：面板状态文案（面向手动 Jog 操作员的场景化短文案）与 motion-errors.ts 的
   * presentMotionError（面向 RAPID/末端拖拽提示）是两个刻意保持独立的呈现表面，对齐
   * CONTEXT.md「运动错误呈现」——UI 分别提供场景化文案，不与机器契约或另一呈现表面同步。
   * 这里锁定面板文案现状，防止今后继续静默分叉，不代表两处文案应当合并成同一份。
   */
  it('腕部奇异失败时面板展示手动 Jog 场景化文案', () => {
    const joints = ref<JointAngles>([...DEFAULT_JOINTS])
    const poseRef = computed(() => poseFromJoints(joints.value, KUKA_LIKE))
    const control = createControl({
      joints,
      pose: poseRef,
      profile: KUKA_PROFILE,
      planTarget: () => ({ ok: false, failure: 'wrist-singularity' }),
      moveToTrajectory: () => undefined,
    })

    control.setField('x', poseRef.value.positionMm[0] + 1)

    expect(control.status.value).toBe('singularity')
    expect(control.statusMessage.value).toBe(
      '自动腕部插补仍无法连续通过奇异（J5≈0°）；请修改目标姿态，或先用关节 Jog 脱离',
    )
  })

  it('关节限位失败时面板展示手动 Jog 场景化文案', () => {
    const joints = ref<JointAngles>([...DEFAULT_JOINTS])
    const poseRef = computed(() => poseFromJoints(joints.value, KUKA_LIKE))
    const control = createControl({
      joints,
      pose: poseRef,
      profile: KUKA_PROFILE,
      planTarget: () => ({ ok: false, failure: 'joint-limit' }),
      moveToTrajectory: () => undefined,
    })

    control.setField('x', poseRef.value.positionMm[0] + 1)

    expect(control.status.value).toBe('joint-limit')
    expect(control.statusMessage.value).toBe('目标会触及关节限位，未执行目标')
  })

  it('机械零位 Y 点动不再使用 SingArea\\Wrist，并提交轨迹', () => {
    const model = new AbbRobotModelAdapter()
    const joints = ref<JointAngles>([0, 0, 0, 0, 30, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      if (!currentPose) return { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const control = createControl({
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
    const model = new AbbRobotModelAdapter()
    const joints = ref<JointAngles>([0, 0, 0, 0, 30, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      if (!currentPose) return { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const control = createControl({
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
    const yBefore = poseRef.value.positionMm[1]

    control.move('y', 1)

    expect(control.status.value).toBe('solved')
    expect(poseRef.value.positionMm[1]).toBeGreaterThan(yBefore + 9)
  })

  it('机械零位字段直达不再进入 wrist 回退入口', () => {
    const model = new AbbRobotModelAdapter()
    const joints = ref<JointAngles>([0, 0, 0, 0, 30, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const control = createControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      moveToTrajectory: () => undefined,
    })

    control.setField('y', poseRef.value.positionMm[1] + 1)

    expect(control.status.value).toBe('solved')
  })

  it('非机械零位工作区的 J5=0 大步长不得显示机械零位重构提示', () => {
    const model = new AbbRobotModelAdapter()
    const joints = ref<JointAngles>([15, -20, 30, 0, 0, -300])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const control = createControl({
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
    const model = new AbbRobotModelAdapter()
    const joints = ref<JointAngles>([0, -25, 45, 0, 20, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const submitted: JointAngles[] = []
    const control = createControl({
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

  it('连续同步规划在动画尚未回写关节时仍按已提交锚点递进', () => {
    const model = new AbbRobotModelAdapter()
    const joints = ref<JointAngles>([0, -25, 45, 0, 20, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const submittedX: number[] = []
    const control = createControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      // 同步规划已立即提交计划，下一次可以从已提交锚点继续。
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

  it('连续计划被 Runner 接受后立即推进锚点，不等待运动完成结果', async () => {
    const model = new AbbRobotModelAdapter()
    const joints = ref<JointAngles>([0, -25, 45, 0, 20, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const requestedX: number[] = []
    const control = createControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      deferMotionOutcome: true,
      planTarget: (target, initial) => {
        requestedX.push(target.position[0])
        return planCartesianPath(target, initial, model, ABB_IRB1200_PROFILE.jointRanges, {
          preserveConfiguration: false,
        })
      },
    })

    control.move('x', 1, true)
    await Promise.resolve()
    control.move('x', 1, true)

    expect(requestedX).toHaveLength(2)
    expect(requestedX[1] - requestedX[0]).toBeCloseTo(1, 8)
  })

  it('连续点动结束时通知宿主停止当前运动', () => {
    const joints = ref<JointAngles>([0, -25, 45, 0, 20, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = new AbbRobotModelAdapter().forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const stopMotion = vi.fn()
    const control = createControl({
      joints,
      pose: poseRef,
      profile: ABB_IRB1200_PROFILE,
      moveToTrajectory: () => undefined,
      stopMotion,
    })

    control.move('x', 1, true)
    control.endContinuous()

    expect(stopMotion).toHaveBeenCalledTimes(1)
  })

  it('异步连续规划先提交当前成功结果，再处理最新排队目标', async () => {
    const joints = ref<JointAngles>([0, -25, 45, 0, 20, 0])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = new AbbRobotModelAdapter().forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    const resolvers: Array<(result: CartesianPathResult) => void> = []
    const submitted: readonly JointAngles[][] = []
    const trajectories: JointAngles[][] = []
    const control = createControl({
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

    expect(trajectories).toEqual([[[1, 1, 1, 1, 1, 1]], [[2, 2, 2, 2, 2, 2]]])
    expect(submitted).toHaveLength(0)
    expect(control.status.value).toBe('solved')
  })

  it('向 ABB 动画层提交分段笛卡尔轨迹，而不是单个终点关节角', () => {
    const model = new AbbRobotModelAdapter()
    const joints = ref<JointAngles>([15, -20, 30, 10, 25, -15])
    const poseRef = computed<PoseDisplay>(() => {
      const currentPose = model.forwardKinematics(joints.value)
      return {
        positionMm: [...currentPose.position] as PoseDisplay['positionMm'],
        orientationDeg: currentPose.euler.map(radToDeg) as PoseDisplay['orientationDeg'],
      }
    })
    let submittedTrajectory: readonly JointAngles[] = []
    const control = createControl({
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
