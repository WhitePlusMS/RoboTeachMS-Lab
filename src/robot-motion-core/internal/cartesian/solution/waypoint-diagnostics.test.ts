import { describe, expect, it } from 'vitest'
import type { IKCandidateRecord } from '@/robot-geometry/numerical-ik/candidate-catalog.ts'
import type { JointAngles } from '@/robot-geometry/model/joint-pose.ts'
import {
  buildCandidateLimitFailureDetail,
  buildJointLimitFailureDetail,
  buildStepFailureDetail,
  selectNearestLimitAxis,
  selectStepFailureAxis,
} from './waypoint-diagnostics.ts'

/** ABB IRB 1200 六轴范围，与 candidate-path-planner/joint-solution 两条求解路径共用同一套关节限位。 */
const JOINT_RANGES: readonly (readonly [number, number])[] = [
  [-170, 170],
  [-100, 130],
  [-200, 70],
  [-270, 270],
  [-130, 130],
  [-400, 400],
]

function candidateRecord(joints: JointAngles, overrides: Partial<IKCandidateRecord> = {}): IKCandidateRecord {
  return {
    joints,
    positionErrorMm: 0,
    orientationErrorRad: 0,
    isLeastSquares: false,
    isSingular: false,
    normalizedJoints: joints,
    withinJointRanges: true,
    atJointLimit: false,
    maxJointDeltaDeg: 0,
    distanceFromReferenceDeg: 0,
    ...overrides,
  }
}

/**
 * 特征化测试：candidate-path-planner.ts（批量候选图 DP）与 joint-solution.ts（逐点腕部逃离）
 * 两条求解路径共用本模块的诊断构造，但各自的选轴策略被有意保留，不趁本次收拢统一口径——
 * 诊断只影响失败时的归咎轴与提示文案，不影响候选筛选或运动规划结果本身。
 */
describe('waypoint diagnostics — 两条求解路径的选轴策略逐位保留', () => {
  it('步长诊断：candidate-path-planner 路径（全轴扫描）与 joint-solution 路径（preferredAxes 限定腕部轴）对同一输入给出不同归咎轴', () => {
    const previous: JointAngles = [0, -25, 45, 0, 20, 0]
    const attempted: JointAngles = [12, -25, 45, 8, 20, -8]

    // candidate-path-planner.ts 原 buildStepDiagnostic：全轴扫描，J1 步长最大。
    expect(selectStepFailureAxis(previous, attempted)).toEqual({ axisIndex: 0, deltaDeg: 12 })
    expect(buildStepFailureDetail(previous, attempted, JOINT_RANGES)).toEqual({
      axisIndex: 0,
      previousAngleDeg: 0,
      attemptedAngleDeg: 12,
      deltaDeg: 12,
      limitRangeDeg: [-170, 170],
    })

    // joint-solution.ts 原 buildJointStepDetail：怀疑腕部奇异时只在 [3,5] 中选，J4 步长最大。
    expect(selectStepFailureAxis(previous, attempted, [3, 5])).toEqual({ axisIndex: 3, deltaDeg: 8 })
    expect(buildStepFailureDetail(previous, attempted, JOINT_RANGES, [3, 5])).toEqual({
      axisIndex: 3,
      previousAngleDeg: 0,
      attemptedAngleDeg: 8,
      deltaDeg: 8,
      limitRangeDeg: [-270, 270],
    })
  })

  it('步长诊断：未传 preferredAxes 时退化为全轴扫描，两条调用路径行为一致', () => {
    const previous: JointAngles = [0, -25, 45, 0, 20, 0]
    const attempted: JointAngles = [12, -25, 45, 8, 20, -8]
    expect(buildStepFailureDetail(previous, attempted, JOINT_RANGES, [])).toEqual(
      buildStepFailureDetail(previous, attempted, JOINT_RANGES),
    )
  })

  it('限位诊断：joint-solution 路径（第一个贴近边界的轴）与 candidate-path-planner 路径（越界严重度最大的轴）对同一姿态给出不同归咎轴', () => {
    const previous: JointAngles = [0, -25, 45, 0, 20, 0]
    const attempted: JointAngles = [169.6, -25, 45, 300, 20, 0]

    // joint-solution.ts 原 buildJointLimitDetail：J1 先贴近其 170° 边界（0.5° 容差内），即使 J4 越界更严重也不管。
    expect(selectNearestLimitAxis(attempted, JOINT_RANGES)).toBe(0)
    expect(buildJointLimitFailureDetail(previous, attempted, JOINT_RANGES)).toEqual({
      axisIndex: 0,
      previousAngleDeg: 0,
      attemptedAngleDeg: 169.6,
      deltaDeg: 169.6,
      limitRangeDeg: [-170, 170],
    })

    // candidate-path-planner.ts 原 buildLimitDiagnostic：J4 越界 30°，严重度远超 J1 贴边的 0.5，选 J4。
    const catalog = [candidateRecord(attempted, { normalizedJoints: attempted })]
    expect(buildCandidateLimitFailureDetail(catalog, previous, JOINT_RANGES, 2)).toEqual({
      waypointIndex: 2,
      axisIndex: 3,
      previousAngleDeg: 0,
      attemptedAngleDeg: 300,
      deltaDeg: 300,
      limitRangeDeg: [-270, 270],
    })
  })

  it('限位诊断：候选目录为空时 buildCandidateLimitFailureDetail 返回 undefined', () => {
    expect(buildCandidateLimitFailureDetail([], [0, 0, 0, 0, 0, 0], JOINT_RANGES, 1)).toBeUndefined()
  })

  it('限位诊断：candidate-path-planner 路径优先选夹限位的候选，再在其六轴中比较越界严重度', () => {
    const previous: JointAngles = [0, 0, 0, 0, 0, 0]
    const atLimitCandidate = candidateRecord([171, 0, 0, 0, 0, 0], {
      normalizedJoints: [171, 0, 0, 0, 0, 0],
      atJointLimit: true,
      maxJointDeltaDeg: 171,
    })
    const otherCandidate = candidateRecord([5, 0, 0, 0, 0, 0], {
      normalizedJoints: [5, 0, 0, 0, 0, 0],
      atJointLimit: false,
      maxJointDeltaDeg: 5,
    })
    // atJointLimit=true 的候选排在前面（即使 maxJointDeltaDeg 更大），与原实现排序规则一致：
    // 诊断的目的正是解释为什么会夹限位，应该选中真正触及限位的那个候选。
    expect(buildCandidateLimitFailureDetail([otherCandidate, atLimitCandidate], previous, JOINT_RANGES, 3)).toEqual({
      waypointIndex: 3,
      axisIndex: 0,
      previousAngleDeg: 0,
      attemptedAngleDeg: 171,
      deltaDeg: 171,
      limitRangeDeg: [-170, 170],
    })
  })
})
