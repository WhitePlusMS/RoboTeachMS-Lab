import { describe, expect, it } from 'vitest'
import { extractPose } from '@/robot-geometry/transform/pose-conversion.ts'
import { forwardKinematicsDegrees } from './legacy-forward-kinematics.ts'
import type { JointAngles } from '@/robot-geometry/model/joint-pose.ts'
import { DEFAULT_JOINTS, KUKA_LIKE } from '@/robot-models/kuka-like/parameters.ts'

describe('KUKA 历史 DH 正运动学', () => {
  it('零位 FK 返回有限的末端位置和姿态', () => {
    const pose = extractPose(forwardKinematicsDegrees(DEFAULT_JOINTS, KUKA_LIKE))

    expect(pose.position[0]).toBeGreaterThan(0)
    expect(pose.position.every(Number.isFinite)).toBe(true)
    expect(pose.eulerZYX.every(Number.isFinite)).toBe(true)
  })

  it('关节角度变化会改变正解结果', () => {
    const moved: JointAngles = [15, 0, 0, 0, 0, 0]
    const zeroPosition = forwardKinematicsDegrees(DEFAULT_JOINTS, KUKA_LIKE).getPosition()
    const movedPosition = forwardKinematicsDegrees(moved, KUKA_LIKE).getPosition()

    expect(movedPosition).not.toEqual(zeroPosition)
  })
})
