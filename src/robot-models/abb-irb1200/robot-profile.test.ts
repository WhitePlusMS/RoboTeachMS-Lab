import { describe, expect, it } from 'vitest'
import type { RobotProfile } from '@/robotics/robot-profile.ts'
import { AbbDhRobotModel } from './dh-robot-model.ts'
import { ABB_IRB1200_PROFILE } from './robot-profile.ts'
import {
  ABB_DEFAULT_JOINTS,
  ABB_IRB1200_5_90_STANDARD_DH,
  ABB_JOINT_RANGES,
} from './robot-config.ts'

// 仅参与 TypeScript 静态检查；不可在测试运行时改写全局 profile 单例。
// eslint-disable-next-line no-constant-condition -- intentional: only a TS static-check block.
if (false) {
  const readonlyProfile: RobotProfile = ABB_IRB1200_PROFILE
  // @ts-expect-error - RobotProfile 字段只读，禁止替换共享模型。
  readonlyProfile.model = new AbbDhRobotModel()
  // @ts-expect-error - homeJoints 为只读六轴 tuple，禁止元素改写。
  readonlyProfile.homeJoints[0] = 10
}

describe('ABB IRB 1200 profile seam', () => {
  it('唯一 profile 复用既有型号名称、一体化 DH 模型、关节范围与回零关节，不复制任何数值', () => {
    const profile: RobotProfile = ABB_IRB1200_PROFILE
    expect(profile.id).toBe('abb-irb1200-5-0.9')
    expect(profile.displayName).toBe(ABB_IRB1200_5_90_STANDARD_DH.name)
    expect(profile.model).toBeInstanceOf(AbbDhRobotModel)
    expect(profile.jointRanges).toBe(ABB_JOINT_RANGES)
    expect(profile.homeJoints).toBe(ABB_DEFAULT_JOINTS)
  })

  it('只聚合契约字段：型号身份、一体模型、关节范围与回零状态', () => {
    const profile = ABB_IRB1200_PROFILE as RobotProfile
    expect(Object.keys(profile).sort()).toEqual([
      'displayName',
      'homeJoints',
      'id',
      'jointRanges',
      'model',
    ])
  })

  it('六轴关节范围结构固定且零位落在范围内', () => {
    expect(ABB_IRB1200_PROFILE.jointRanges).toHaveLength(6)
    ABB_IRB1200_PROFILE.jointRanges.forEach((range) => {
      expect(range[0]).toBeLessThan(range[1])
    })
    ABB_IRB1200_PROFILE.homeJoints.forEach((angle, index) => {
      const [min, max] = ABB_IRB1200_PROFILE.jointRanges[index]
      expect(angle).toBeGreaterThanOrEqual(min)
      expect(angle).toBeLessThanOrEqual(max)
    })
  })

  it('零位正解由 profile 内的单一模型驱动', () => {
    expect(
      ABB_IRB1200_PROFILE.model.forwardKinematics([...ABB_IRB1200_PROFILE.homeJoints]),
    ).not.toBeNull()
  })
})
