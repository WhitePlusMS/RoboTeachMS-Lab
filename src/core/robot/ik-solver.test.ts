import { describe, expect, it } from 'vitest'
import { extractPose, forwardKinematicsDegrees } from './kinematics'
import { solveIK } from './ik-solver'
import type { JointAngles, PoseDisplay } from './types'
import { DEFAULT_JOINTS, KUKA_LIKE } from '../../robots/kuka-like/robot-config'

function poseFromJoints(joints: JointAngles): PoseDisplay {
  const pose = extractPose(forwardKinematicsDegrees(joints, KUKA_LIKE))
  return {
    positionMm: pose.position,
    orientationDeg: pose.eulerZYX.map((value) => (value * 180) / Math.PI) as [number, number, number],
  }
}

describe('KUKA 数值逆解', () => {
  it('目标等于当前正解时返回当前关节', () => {
    const result = solveIK(poseFromJoints(DEFAULT_JOINTS), DEFAULT_JOINTS, KUKA_LIKE)

    expect(result).not.toBeNull()
    expect(result).toEqual(DEFAULT_JOINTS)
  })

  it('可以收敛到当前姿态附近的小位置位移', () => {
    const target = poseFromJoints(DEFAULT_JOINTS)
    target.positionMm[0] += 5
    const result = solveIK(target, DEFAULT_JOINTS, KUKA_LIKE)

    expect(result).not.toBeNull()
    const solved = poseFromJoints(result as JointAngles)
    expect(Math.abs(solved.positionMm[0] - target.positionMm[0])).toBeLessThan(1)
  })

  it('可以收敛到小幅末端姿态变化', () => {
    const target = poseFromJoints(DEFAULT_JOINTS)
    target.orientationDeg[2] += 2
    const result = solveIK(target, DEFAULT_JOINTS, KUKA_LIKE)

    expect(result).not.toBeNull()
    const solved = poseFromJoints(result as JointAngles)
    expect(Math.abs(solved.orientationDeg[2] - target.orientationDeg[2])).toBeLessThan(0.5)
  })

  it('明显超出工作空间的目标返回失败且不伪造关节结果', () => {
    const target: PoseDisplay = {
      positionMm: [100000, 100000, 100000],
      orientationDeg: [0, 0, 0],
    }

    expect(solveIK(target, DEFAULT_JOINTS, KUKA_LIKE)).toBeNull()
  })
})
