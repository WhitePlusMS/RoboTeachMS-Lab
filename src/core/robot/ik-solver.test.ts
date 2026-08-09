import { describe, expect, it } from 'vitest'
import { solveIK } from './ik-solver'
import { eulerZYXToMatrix } from './matrix4x4'
import type { JointAngles, Pose } from './types'
import { DEFAULT_JOINTS, KUKA_JOINT_RANGES } from '../../robots/kuka-like/robot-config'
import { DhRobotModel } from '../../robots/kuka-like/dh-robot-model'

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
