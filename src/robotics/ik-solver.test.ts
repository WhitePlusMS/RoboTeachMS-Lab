import { describe, expect, it } from 'vitest'
import { solveIK } from './ik-solver.ts'
import { eulerZYXToMatrix } from './matrix4x4.ts'
import type { JointAngles, Pose } from './types.ts'
import { DEFAULT_JOINTS, KUKA_JOINT_RANGES } from '@/robot-models/kuka-like/robot-config.ts'
import { DhRobotModel } from '@/robot-models/kuka-like/dh-robot-model.ts'
import { ABB_DEFAULT_JOINTS, ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/robot-config.ts'
import { AbbDhRobotModel } from '@/robot-models/abb-irb1200/dh-robot-model.ts'

describe('KUKA 数值逆解', () => {
  const model = new DhRobotModel()

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

describe('ABB IRB 1200 数值逆解', () => {
  const model = new AbbDhRobotModel()

  it('复用 KUKA 的六维 DLS 算法完成 FK→IK→FK 闭环', () => {
    const source: JointAngles = [25, -20, 35, 15, -25, 30]
    const target = model.forwardKinematics(source) as Pose
    const result = solveIK(
      target,
      ABB_DEFAULT_JOINTS,
      model,
      { maxIterations: 250 },
      ABB_JOINT_RANGES,
    )

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

  it('ABB 位置-only 回退仍使用相同模型和关节限位', () => {
    const target = model.forwardKinematics([0, -25, 45, 0, 20, 0]) as Pose
    target.position[0] += 5
    const result = solveIK(target, ABB_DEFAULT_JOINTS, model, {}, ABB_JOINT_RANGES)

    expect(result).not.toBeNull()
    const solved = model.forwardKinematics(result as JointAngles) as Pose
    expect(Math.abs(solved.position[0] - target.position[0])).toBeLessThan(1)
  })

  it.fails('已知限制：单初值 DLS 无法覆盖所有 ABB 构型分支', () => {
    const samples: JointAngles[] = [
      [0, -80, 60, 0, 30, 0],
      [90, -30, 50, 120, -45, -90],
      [-90, 20, -100, -120, 80, 180],
      [140, -60, 0, 200, -100, 270],
    ]

    samples.forEach((source) => {
      const target = model.forwardKinematics(source) as Pose
      const result = solveIK(
        target,
        ABB_DEFAULT_JOINTS,
        model,
        { maxIterations: 250 },
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
    })
  })
})
