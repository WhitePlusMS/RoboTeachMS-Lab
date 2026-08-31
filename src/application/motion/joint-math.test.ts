import { describe, expect, it } from 'vitest'
import {
  adjustJointAngle,
  clampJointAngle,
  randomJointAngles,
  setJointAngle,
} from './joint-math.ts'
import type { JointAngles } from '@/robot-geometry/model/index.ts'
import { DEFAULT_JOINTS, KUKA_JOINT_RANGES } from '@/robot-models/kuka-like/parameters.ts'

describe('关节控制状态', () => {
  it('手动输入和步进都会限制在关节范围内', () => {
    expect(clampJointAngle(1, 999)).toBe(45)
    expect(clampJointAngle(1, -999)).toBe(-90)
    expect(setJointAngle(DEFAULT_JOINTS, 1, 999)[1]).toBe(45)
    expect(adjustJointAngle([45, 0, 0, 0, 0, 0], 1, 1, 10)[1]).toBe(10)
  })

  it('加减步进使用指定的角度幅度', () => {
    const start: JointAngles = [0, 0, 0, 0, 0, 0]
    expect(adjustJointAngle(start, 0, 1, 5)[0]).toBe(5)
    expect(adjustJointAngle(start, 0, -1, 0.1)[0]).toBe(-0.1)
  })

  it('随机姿态始终落在六轴范围内', () => {
    const randomJoints = randomJointAngles(KUKA_JOINT_RANGES, () => 0.5)

    randomJoints.forEach((angle, index) => {
      const [min, max] = KUKA_JOINT_RANGES[index]
      expect(angle).toBeGreaterThanOrEqual(min)
      expect(angle).toBeLessThanOrEqual(max)
    })
  })
})
