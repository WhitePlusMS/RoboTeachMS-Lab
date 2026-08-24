import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/robot-config.ts'
import { analyzeWristPathFeasibility } from './wrist-path-feasibility.ts'
import { buildIKCandidateCatalog } from './ik-candidate-catalog.ts'
import { solveGizmoTarget } from './ik-waypoint-solver.ts'
import { planCartesianPath } from './cartesian-path-planner.ts'
import type { JointAngles, Pose } from './types.ts'

const INITIAL_JOINTS: JointAngles = [-0.7, 114.4, -142.7, 1.6, 28.3, -1.4]
const OBSERVED_BOTTOM_JOINTS: JointAngles = [
  -0.7432467734464336,
  83.29437916491835,
  -36.64420247288309,
  -1.1022663325751978,
  -46.6647951436813,
  0.7653497219606556,
]
const TARGET_POSITION: Pose['position'] = [867, -10.1, 152.3]

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position] as Pose['position'],
    euler: [...pose.euler] as Pose['euler'],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

function interpolateFixedOrientation(start: Pose, target: Pose, count: number): Pose[] {
  return Array.from({ length: count }, (_, index) => {
    const progress = (index + 1) / count
    return {
      position: start.position.map(
        (value, axis) => value + (target.position[axis] - value) * progress,
      ) as Pose['position'],
      euler: [...start.euler] as Pose['euler'],
      rotation: start.rotation.map((row) => [...row]),
    }
  })
}

function maxStep(waypoints: readonly JointAngles[], initial: JointAngles): {
  value: number
  index: number
  axis: number
} {
  let previous = initial
  let result = { value: 0, index: 0, axis: 0 }
  waypoints.forEach((current, index) => {
    current.forEach((value, axis) => {
      const delta = Math.abs(value - previous[axis])
      if (delta > result.value) result = { value: delta, index: index + 1, axis }
    })
    previous = current
  })
  return result
}

describe('867/-10.1 Z 直线腕部支路诊断', () => {
  it('记录规划路径、J5 穿越和严格支路可行性', () => {
    const model = ABB_IRB1200_PROFILE.model
    const startPose = model.forwardKinematics(INITIAL_JOINTS) as Pose
    const targetPose = clonePose(startPose)
    targetPose.position = TARGET_POSITION
    const result = planCartesianPath(targetPose, INITIAL_JOINTS, model, ABB_JOINT_RANGES)

    console.info('[Z-SINGULARITY-DIAGNOSTIC-RESULT]', JSON.stringify(result))
    if (!result.ok) {
      const poses = interpolateFixedOrientation(startPose, targetPose, 200)
      const report = analyzeWristPathFeasibility(
        poses,
        INITIAL_JOINTS,
        model,
        ABB_JOINT_RANGES,
        (pose) => pose,
        { solverConfig: { posTolerance: 0.05, oriTolerance: 0.001 } },
      )
      const reportWithoutSoftLimit = analyzeWristPathFeasibility(
        poses,
        INITIAL_JOINTS,
        model,
        ABB_JOINT_RANGES,
        (pose) => pose,
        {
          solverConfig: { posTolerance: 0.05, oriTolerance: 0.001 },
          rejectAtJointLimit: false,
        },
      )
      const snapshotIndices = [153, 154, 155, 156]
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
              candidate.positionErrorMm <= 0.05 &&
              candidate.orientationErrorRad <= 0.001,
          )
          .map((candidate) => ({
            joints: candidate.normalizedJoints,
            j5Sign: Math.sign(candidate.normalizedJoints?.[4] ?? 0),
            withinJointRanges: candidate.withinJointRanges,
            atJointLimit: candidate.atJointLimit,
            maxDeltaFromInitialDeg: candidate.maxJointDeltaDeg,
          })),
      }))
      const targetCandidates = buildIKCandidateCatalog(
        targetPose,
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
        .map((candidate) => candidate.normalizedJoints)
      const gizmoSolution = solveGizmoTarget(
        targetPose,
        INITIAL_JOINTS,
        model,
        ABB_JOINT_RANGES,
        { posTolerance: 0.05, oriTolerance: 0.001 },
      )
      console.info(
        '[Z-SINGULARITY-DIAGNOSTIC]',
        JSON.stringify({
          startPose,
          result,
          strictAll: report.strictAll,
          strictInitialJ5Side: report.strictInitialJ5Side,
          strictAllWithoutSoftLimit: reportWithoutSoftLimit.strictAll,
          strictInitialJ5SideWithoutSoftLimit: reportWithoutSoftLimit.strictInitialJ5Side,
          snapshots,
          targetCandidates,
          gizmoSolution,
          joint2SoftLimitDeg: 129.5,
        }),
      )
      expect(result.failure).toBe('joint-step')
      return
    }

    const waypoints = result.waypoints
    const j5Crossings = waypoints.flatMap((current, index) => {
      const previous = index === 0 ? INITIAL_JOINTS : waypoints[index - 1]
      return previous[4] * current[4] <= 0
        ? [{ waypointIndex: index + 1, previous, current }]
        : []
    })
    const report = analyzeWristPathFeasibility(
      interpolateFixedOrientation(startPose, targetPose, waypoints.length),
      INITIAL_JOINTS,
      model,
      ABB_JOINT_RANGES,
      (pose) => pose,
      { solverConfig: { posTolerance: 0.05, oriTolerance: 0.001 } },
    )
    const audit = {
      startJoints: INITIAL_JOINTS,
      startPose: { position: startPose.position, eulerDeg: startPose.euler.map((v) => (v * 180) / Math.PI) },
      targetPosition: TARGET_POSITION,
      waypointCount: waypoints.length,
      endpoint: waypoints[waypoints.length - 1],
      maxStep: maxStep(waypoints, INITIAL_JOINTS),
      endpointDelta: waypoints[waypoints.length - 1].map(
        (value, axis) => value - INITIAL_JOINTS[axis],
      ),
      j5Crossings,
      strictAll: report.strictAll.metrics,
      strictInitialJ5Side: report.strictInitialJ5Side.metrics,
      strictInitialJ5SideFailure: report.strictInitialJ5Side.failure,
      strictInitialJ5SideFailureWaypoint: report.strictInitialJ5Side.firstFailureWaypointIndex,
    }
    console.info('[Z-SINGULARITY-DIAGNOSTIC]', JSON.stringify(audit))
    expect(maxStep(waypoints, INITIAL_JOINTS).value).toBeLessThanOrEqual(5 + 1e-6)
  })

  it('从实际底部单点支路反向回到顶部时记录可逆性失败点', () => {
    const model = ABB_IRB1200_PROFILE.model
    const bottomPose = model.forwardKinematics(OBSERVED_BOTTOM_JOINTS) as Pose
    const topTarget = clonePose(bottomPose)
    topTarget.position = [867, -10.1, 464.8]
    const result = planCartesianPath(
      topTarget,
      OBSERVED_BOTTOM_JOINTS,
      model,
      ABB_JOINT_RANGES,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const endpoint = result.waypoints[result.waypoints.length - 1]
    console.info(
      '[Z-SINGULARITY-REVERSE-DIAGNOSTIC]',
      JSON.stringify({
        bottomPosition: bottomPose.position,
        targetPosition: topTarget.position,
        waypointCount: result.waypoints.length,
        endpoint,
        endpointDeltaFromOriginalTop: endpoint.map(
          (value, axis) => value - INITIAL_JOINTS[axis],
        ),
      }),
    )
  })
})
