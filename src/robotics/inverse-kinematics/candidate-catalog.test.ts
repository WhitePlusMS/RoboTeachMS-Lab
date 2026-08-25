import { describe, expect, it } from 'vitest'
import { AbbRobotModelAdapter } from '@/robot-models/abb-irb1200/kinematics/abb-robot-model-adapter.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/parameters.ts'
import { buildIKCandidateCatalog, selectBestIKCandidate } from './candidate-catalog.ts'
import type { IKCandidateRecord } from './candidate-catalog.ts'
import type { JointAngles, Pose } from '../model/joint-pose.ts'
import type { ABBConfiguration } from '@/robot-models/abb-irb1200/kinematics/configuration.ts'

describe('IK candidate catalog', () => {
  const model = new AbbRobotModelAdapter()

  it('保留完整解析分支并统一提供残差、奇异和限位元数据', () => {
    const source: JointAngles = [25, -20, 35, 15, -25, 30]
    const target = model.forwardKinematics(source) as Pose
    const catalog = buildIKCandidateCatalog(target, [0, 0, 0, 0, 0, 0], model, ABB_JOINT_RANGES)

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

  it('提供参考构型时优先保持 cf1/cf4/cf6/cfx 一致，即使异构型候选更近', () => {
    const makeRecord = (
      configuration: ABBConfiguration,
      distanceFromReferenceDeg: number,
    ): IKCandidateRecord => ({
      joints: [0, 0, 0, 0, 0, 0],
      positionErrorMm: 0,
      orientationErrorRad: 0,
      isLeastSquares: false,
      isSingular: false,
      configuration,
      normalizedJoints: [0, 0, 0, 0, 0, 0],
      withinJointRanges: true,
      atJointLimit: false,
      maxJointDeltaDeg: distanceFromReferenceDeg,
      distanceFromReferenceDeg,
    })
    const referenceConfiguration: ABBConfiguration = [0, 0, 1, 2]
    const catalog = [makeRecord([0, 0, 0, 0], 5), makeRecord(referenceConfiguration, 80)]
    const options = { positionTolerance: 1, orientationTolerance: 1, referenceConfiguration }

    expect(selectBestIKCandidate(catalog, options)?.configuration).toEqual(referenceConfiguration)
    // 没有参考构型时退化为纯距离最近。
    expect(
      selectBestIKCandidate(catalog, { positionTolerance: 1, orientationTolerance: 1 })
        ?.distanceFromReferenceDeg,
    ).toBe(5)
  })

  it('当前构型无任何合法候选时返回无解，不静默切换构型', () => {
    const source: JointAngles = [25, -20, 35, 15, -25, 30]
    const target = model.forwardKinematics(source) as Pose
    const catalog = buildIKCandidateCatalog(target, source, model, ABB_JOINT_RANGES)
    // 构造一个目录中不存在的构型（cfx 位全部取反）。
    const impossible: ABBConfiguration = [99, 99, 99, 7]
    const selected = selectBestIKCandidate(catalog, {
      positionTolerance: 0.05,
      orientationTolerance: 0.001,
      referenceConfiguration: impossible,
    })
    expect(selected).toBeNull()
  })

  it('多圈关节的候选构型使用实际圈数计算 ABB 象限', () => {
    const source: JointAngles = [20, -30, 35, 40, 25, 300]
    const target = model.forwardKinematics(source) as Pose
    const catalog = buildIKCandidateCatalog(target, source, model, ABB_JOINT_RANGES)
    const fullTurn = catalog.find((candidate) => candidate.normalizedJoints?.[5] === 300)

    expect(fullTurn?.configuration?.[2]).toBe(3)
    expect(model.deriveConfiguration?.(source)?.[2]).toBe(3)
  })

  it('deriveConfiguration 与解析分支的构型标签一致', () => {
    const source: JointAngles = [20, -30, 35, 40, 25, -50]
    const target = model.forwardKinematics(source) as Pose
    const derived = model.deriveConfiguration?.(source)
    expect(derived).toBeDefined()

    const catalog = buildIKCandidateCatalog(target, source, model, ABB_JOINT_RANGES)
    const selected = selectBestIKCandidate(catalog, {
      positionTolerance: 0.05,
      orientationTolerance: 0.001,
      referenceConfiguration: derived ?? undefined,
    })
    expect(selected?.configuration).toEqual(derived)
    selected?.normalizedJoints?.forEach((value, index) => {
      expect(value).toBeCloseTo(source[index], 8)
    })
  })

  it('Cartesian 微小位移仍保留连续合法候选，不被象限标签误判', () => {
    const source: JointAngles = [0, 0, 0, 0, 30, 0]
    const target = model.forwardKinematics(source) as Pose
    target.position[1] += 1
    const catalog = buildIKCandidateCatalog(target, source, model, ABB_JOINT_RANGES)
    const continuous = catalog.filter(
      (candidate) =>
        candidate.normalizedJoints !== null &&
        candidate.withinJointRanges &&
        !candidate.atJointLimit &&
        candidate.maxJointDeltaDeg <= 5,
    )

    expect(continuous.length).toBeGreaterThan(0)
  })
})
