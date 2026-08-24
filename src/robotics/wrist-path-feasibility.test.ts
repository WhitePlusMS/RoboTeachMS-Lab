import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/robot-config.ts'
import { robTargetToPose } from '@/rapid/plan-shared.ts'
import {
  quaternionToRotationMatrix,
  rotationMatrixToEulerZYX,
  rotationMatrixToQuaternion,
} from './math/rotation3d.ts'
import { buildIKCandidateCatalog } from './ik-candidate-catalog.ts'
import { analyzeWristPathFeasibility } from './wrist-path-feasibility.ts'
import type { JointAngles, Pose } from './types.ts'

type Quaternion = [number, number, number, number]

const INITIAL_JOINTS: JointAngles = [
  -6.307847835192381,
  16.292950527815194,
  -54.558081266587656,
  9.625626835816357,
  40.274761160031616,
  -7.546830569638908,
]

function normalizeQuaternion(quaternion: Quaternion): Quaternion {
  const length = Math.hypot(...quaternion)
  return quaternion.map((value) => value / length) as Quaternion
}

function slerp(start: Quaternion, target: Quaternion, progress: number): Quaternion {
  let end = target
  let dot = start.reduce((sum, value, index) => sum + value * target[index], 0)
  if (dot < 0) {
    end = target.map((value) => -value) as Quaternion
    dot = -dot
  }
  if (dot > 0.9995) {
    return normalizeQuaternion(
      start.map((value, index) => value + (end[index] - value) * progress) as Quaternion,
    )
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
  const denominator = Math.sin(angle)
  const startWeight = Math.sin((1 - progress) * angle) / denominator
  const endWeight = Math.sin(progress * angle) / denominator
  return start.map((value, index) => value * startWeight + end[index] * endWeight) as Quaternion
}

function buildPath(start: Pose, target: Pose, waypointCount: number): Pose[] {
  const startQuaternion = rotationMatrixToQuaternion(start.rotation)
  const targetQuaternion = rotationMatrixToQuaternion(target.rotation)
  return Array.from({ length: waypointCount }, (_, index) => {
    const progress = (index + 1) / waypointCount
    const rotation = quaternionToRotationMatrix(
      slerp(startQuaternion, targetQuaternion, progress),
    )
    return {
      position: start.position.map(
        (value, axis) => value + (target.position[axis] - value) * progress,
      ) as Pose['position'],
      euler: rotationMatrixToEulerZYX(rotation),
      rotation,
    }
  })
}

describe('整条路径腕部支路可行性分析', () => {
  it('比较严格姿态、J5 初始侧和腕部最小运动指标', () => {
    const model = ABB_IRB1200_PROFILE.model
    const start = model.forwardKinematics(INITIAL_JOINTS) as Pose
    const target = robTargetToPose({
      trans: [533, -50, -310.9],
      rot: [0.000608391, 0.716910335, -0.000625622, 0.697164837],
      robconf: [0, 0, 0, 0],
      extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
    })
    const poses = buildPath(start, target, 400)
    const report = analyzeWristPathFeasibility(
      poses,
      INITIAL_JOINTS,
      model,
      ABB_JOINT_RANGES,
      (pose) => pose,
      { solverConfig: { posTolerance: 0.05, oriTolerance: 0.001 } },
    )

    expect(report.strictAll.pathFound).toBe(true)
    expect(report.strictInitialJ5Side.pathFound).toBe(true)
    expect(report.optimized.minMaxDeltaFromInitial.pathFound).toBe(true)

    const compact = {
      waypointCount: report.waypointCount,
      strictCandidateCountRange: [
        Math.min(...report.strictCandidateCountPerWaypoint),
        Math.max(...report.strictCandidateCountPerWaypoint),
      ],
      strictAll: report.strictAll.metrics,
      strictInitialJ5Side: report.strictInitialJ5Side.metrics,
      minMaxAbsolute: report.optimized.minMaxAbsolute.metrics,
      minMaxDeltaFromInitial: report.optimized.minMaxDeltaFromInitial.metrics,
      minTotalTravel: report.optimized.minTotalTravel.metrics,
      thresholds: report.thresholds,
    }
    console.info('[WRIST-PATH-FEASIBILITY]', JSON.stringify(compact))

    const snapshotIndices = [1, 74, 97, 330, 400]
    const snapshots = snapshotIndices.map((waypointIndex) => ({
      waypointIndex,
      candidates: buildIKCandidateCatalog(
        poses[waypointIndex - 1],
        INITIAL_JOINTS,
        model,
        ABB_JOINT_RANGES,
      )
        .filter(
          (candidate) =>
            candidate.normalizedJoints !== null &&
            candidate.withinJointRanges &&
            !candidate.atJointLimit &&
            candidate.positionErrorMm <= 0.05 &&
            candidate.orientationErrorRad <= 0.001,
        )
        .map((candidate) => ({
          joints: candidate.normalizedJoints,
          positionErrorMm: candidate.positionErrorMm,
          orientationErrorDeg: (candidate.orientationErrorRad * 180) / Math.PI,
        })),
    }))
    console.info('[WRIST-PATH-CANDIDATE-SNAPSHOTS]', JSON.stringify(snapshots))
  })
})
