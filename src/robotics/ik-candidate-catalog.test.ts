import { describe, expect, it } from 'vitest'
import { AbbDhRobotModel } from '@/robot-models/abb-irb1200/dh-robot-model.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/robot-config.ts'
import { buildIKCandidateCatalog, selectBestIKCandidate } from './ik-candidate-catalog.ts'
import type { JointAngles, Pose } from './types.ts'

describe('IK candidate catalog', () => {
  const model = new AbbDhRobotModel()

  it('保留完整解析分支并统一提供残差、奇异和限位元数据', () => {
    const source: JointAngles = [25, -20, 35, 15, -25, 30]
    const target = model.forwardKinematics(source) as Pose
    const catalog = buildIKCandidateCatalog(
      target,
      [0, 0, 0, 0, 0, 0],
      model,
      ABB_JOINT_RANGES,
    )

    expect(catalog.length).toBeGreaterThanOrEqual(4)
    expect(catalog.every((candidate) => Number.isFinite(candidate.positionErrorMm))).toBe(true)
    expect(catalog.every((candidate) => Number.isFinite(candidate.orientationErrorRad))).toBe(true)
    expect(catalog.some((candidate) => candidate.isSingular === false)).toBe(true)
    expect(catalog.some((candidate) => candidate.normalizedJoints !== null)).toBe(true)
    expect(catalog.some((candidate) => !candidate.withinJointRanges)).toBe(true)
    expect(
      catalog.every(
        (candidate) => candidate.withinJointRanges === (candidate.normalizedJoints !== null),
      ),
    ).toBe(true)
  })

  it('候选目录不替调用方做最近分支选择', () => {
    const source: JointAngles = [0, -80, 60, 0, 30, 0]
    const target = model.forwardKinematics(source) as Pose
    const catalog = buildIKCandidateCatalog(target, source, model, ABB_JOINT_RANGES)

    const distances = catalog
      .filter((candidate) => candidate.normalizedJoints !== null)
      .map((candidate) => candidate.distanceFromReferenceDeg)
    expect(new Set(distances).size).toBeGreaterThan(1)
  })

  it('统一选择器按残差、限位和连续步长筛选最近候选', () => {
    const source: JointAngles = [0, -25, 45, 0, 20, 0]
    const target = model.forwardKinematics(source) as Pose
    const catalog = buildIKCandidateCatalog(target, source, model, ABB_JOINT_RANGES)
    const selected = selectBestIKCandidate(catalog, {
      positionTolerance: 0.05,
      orientationTolerance: 0.001,
      maxJointStepDeg: 5,
      rejectAtJointLimit: true,
    })
    expect(selected?.normalizedJoints).toBeDefined()
    selected?.normalizedJoints?.forEach((value, index) => {
      expect(value).toBeCloseTo(source[index], 8)
    })
  })
})
