import { describe, expect, it } from 'vitest'
import { solveIK } from './numerical-ik.ts'
import { eulerZYXToMatrix } from '../kinematics/transform-matrix.ts'
import { orientationError } from '../math/rotation3d.ts'
import type { JointAngles, Pose } from '../model/types.ts'
import { DEFAULT_JOINTS, KUKA_JOINT_RANGES } from '@/robot-models/kuka-like/parameters.ts'
import { KukaRobotModelAdapter } from '@/robot-models/kuka-like/kinematics/kuka-robot-model-adapter.ts'
import {
  ABB_MECHANICAL_ZERO_JOINTS,
  ABB_JOINT_RANGES,
} from '@/robot-models/abb-irb1200/parameters.ts'
import { AbbRobotModelAdapter } from '@/robot-models/abb-irb1200/kinematics/abb-robot-model-adapter.ts'

describe('KUKA 数值逆解', () => {
  const model = new KukaRobotModelAdapter()

  it('目标等于当前正解时返回当前关节', () => {
    const target = model.forwardKinematics(DEFAULT_JOINTS) as Pose
    const result = solveIK(target, DEFAULT_JOINTS, model, {}, KUKA_JOINT_RANGES)

    expect(result).not.toBeNull()
    expect(result).toEqual(DEFAULT_JOINTS)
  })

  it('可以收敛到当前姿态附近的小位置位移', () => {
    const target = model.forwardKinematics(DEFAULT_JOINTS) as Pose
    target.position[0] += 5
    const result = solveIK(target, DEFAULT_JOINTS, model, {}, KUKA_JOINT_RANGES)

    expect(result).not.toBeNull()
    const solved = model.forwardKinematics(result as JointAngles) as Pose
    expect(Math.abs(solved.position[0] - target.position[0])).toBeLessThan(1)
  })

  it('可以收敛到小幅末端姿态变化', () => {
    const target = model.forwardKinematics(DEFAULT_JOINTS) as Pose
    target.euler[2] += (2 * Math.PI) / 180
    target.rotation = eulerZYXToMatrix(target.euler)
    const result = solveIK(target, DEFAULT_JOINTS, model, {}, KUKA_JOINT_RANGES)

    expect(result).not.toBeNull()
    const solved = model.forwardKinematics(result as JointAngles) as Pose
    expect(Math.abs(solved.euler[2] - target.euler[2])).toBeLessThan((0.5 * Math.PI) / 180)
  })

  it('明显超出工作空间的目标返回失败且不伪造关节结果', () => {
    const target = model.forwardKinematics(DEFAULT_JOINTS) as Pose
    target.position = [100000, 100000, 100000]

    expect(solveIK(target, DEFAULT_JOINTS, model, {}, KUKA_JOINT_RANGES)).toBeNull()
  })
})

describe('ABB IRB 1200 解析逆解', () => {
  const model = new AbbRobotModelAdapter()

  it('解析法完成 FK→IK→FK 闭环', () => {
    const source: JointAngles = [25, -20, 35, 15, -25, 30]
    const target = model.forwardKinematics(source) as Pose
    const result = solveIK(target, source, model, {}, ABB_JOINT_RANGES)

    expect(result).not.toBeNull()
    const solved = model.forwardKinematics(result as JointAngles) as Pose
    const positionError = Math.hypot(
      solved.position[0] - target.position[0],
      solved.position[1] - target.position[1],
      solved.position[2] - target.position[2],
    )
    const orientationDelta = solved.rotation
      .map((row, rowIndex) =>
        row.map((value, columnIndex) => value - target.rotation[rowIndex][columnIndex]),
      )
      .flat()

    expect(positionError).toBeLessThan(1)
    expect(Math.hypot(...orientationDelta)).toBeLessThan(0.01)
    ;(result as JointAngles).forEach((angle, index) => {
      const [min, max] = ABB_JOINT_RANGES[index]
      expect(angle).toBeGreaterThanOrEqual(min)
      expect(angle).toBeLessThanOrEqual(max)
    })
  })

  it('解析 IK 返回全部 ABB 构型分支，覆盖远离机械零位的目标', () => {
    const samples: JointAngles[] = [
      [0, -80, 60, 0, 30, 0],
      [90, -30, 50, 120, -45, -90],
      [-90, 20, -100, -120, 80, 180],
      [140, -60, 0, 200, -100, 270],
    ]

    samples.forEach((source) => {
      const target = model.forwardKinematics(source) as Pose
      // 该组测试验证解析几何分支的位姿闭环，不验证 RAPID 的构型保持策略。
      const result = solveIK(
        target,
        source,
        model,
        { preserveConfiguration: false },
        ABB_JOINT_RANGES,
      )

      expect(result, `纯 ABB DH 求解失败：${source.join(',')}`).not.toBeNull()
      const solved = model.forwardKinematics(result as JointAngles) as Pose
      const positionError = Math.hypot(
        solved.position[0] - target.position[0],
        solved.position[1] - target.position[1],
        solved.position[2] - target.position[2],
      )
      expect(positionError, `ABB DH 位置残差：${source.join(',')}`).toBeLessThan(1)
      const orientationErrorVector = orientationError(target.rotation, solved.rotation)
      expect(
        Math.hypot(...orientationErrorVector),
        `ABB DH 姿态残差：${source.join(',')}`,
      ).toBeLessThan(1e-8)
    })
  })
})

describe('ABB IRB 1200 数值兜底', () => {
  const model = new AbbRobotModelAdapter()

  it('ABB 位置-only 回退仍使用相同模型和关节限位', () => {
    const target = model.forwardKinematics([0, -25, 45, 0, 20, 0]) as Pose
    target.position[0] += 5
    const result = solveIK(
      target,
      ABB_MECHANICAL_ZERO_JOINTS,
      model,
      { positionOnly: true },
      ABB_JOINT_RANGES,
    )

    expect(result).not.toBeNull()
    const solved = model.forwardKinematics(result as JointAngles) as Pose
    expect(Math.abs(solved.position[0] - target.position[0])).toBeLessThan(1)
  })

  it('机械零位位置逆解可在迭代全过程锁定 J4', () => {
    const target = model.forwardKinematics(ABB_MECHANICAL_ZERO_JOINTS) as Pose
    target.position[1] += 1

    const result = solveIK(
      target,
      [0, 0, 0, 0, 5, 0],
      model,
      {
        maxIterations: 150,
        posTolerance: 0.05,
        positionOnly: true,
        lockedJointTargetsDeg: [null, null, null, 0, null, null],
      },
      ABB_JOINT_RANGES,
    )

    expect(result).not.toBeNull()
    expect((result as JointAngles)[3]).toBe(0)
    const solved = model.forwardKinematics(result as JointAngles) as Pose
    expect(Math.abs(solved.position[1] - target.position[1])).toBeLessThan(0.05)
  })

  it('机械零位位置逆解优先保持 J4 连续而不硬锁定', () => {
    const target = model.forwardKinematics(ABB_MECHANICAL_ZERO_JOINTS) as Pose
    target.position[1] += 1

    const result = solveIK(
      target,
      [0, 0, 0, 0, 5, 0],
      model,
      {
        maxIterations: 150,
        posTolerance: 0.05,
        positionOnly: true,
        jointContinuityReferenceDeg: ABB_MECHANICAL_ZERO_JOINTS,
        jointContinuityWeights: [0, 0, 0, 100, 0, 0],
      },
      ABB_JOINT_RANGES,
    )

    expect(result).not.toBeNull()
    const solved = model.forwardKinematics(result as JointAngles) as Pose
    expect(Math.abs(solved.position[1] - target.position[1])).toBeLessThan(0.05)
    expect(Math.abs((result as JointAngles)[3])).toBeLessThan(0.5)
  })
})
