import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/robot-config.ts'
import { buildIKCandidateCatalog } from './ik-candidate-catalog.ts'
import { solveAbbAnalyticIK } from '@/robot-models/abb-irb1200/abb-analytic-ik.ts'
import { degToRad } from '@/robotics/math/angle.ts'
import { eulerZYXToMatrix } from '@/robotics/matrix4x4.ts'
import { mat3Mul, rotationDistanceRad, rotationMatrixToEulerZYX } from './math/rotation3d.ts'
import { planCartesianPath } from './cartesian-path-planner.ts'
import { planCartesianTarget } from './cartesian-motion-planner.ts'
import { resolveJointSolution } from './ik-waypoint-solver.ts'
import { analyzeWristPathFeasibility } from './wrist-path-feasibility.ts'
import type { JointAngles, Pose } from './types.ts'

const INITIAL_JOINTS: JointAngles = [-2.5, 26.7, -20.8, -203.4, 6.3, 203.3]
const Z_STEP_MM = 50

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position] as Pose['position'],
    euler: [...pose.euler] as Pose['euler'],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

function buildFixedOrientationPath(start: Pose, target: Pose, count: number): Pose[] {
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

function axisRotation(axis: 0 | 1 | 2, angleRad: number): number[][] {
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  if (axis === 0) return [[1, 0, 0], [0, c, -s], [0, s, c]]
  if (axis === 1) return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]]
}

describe('J5≈6° 姿态向上点动诊断', () => {
  it('复现 Z+50 时 J3 115° 分支跳变，并输出相邻候选', () => {
    const model = ABB_IRB1200_PROFILE.model
    const startPose = model.forwardKinematics(INITIAL_JOINTS) as Pose
    const targetPose = clonePose(startPose)
    targetPose.position[2] += Z_STEP_MM
    const result = planCartesianPath(targetPose, INITIAL_JOINTS, model, ABB_JOINT_RANGES)
    const displayTargetPose = clonePose(targetPose)
    displayTargetPose.euler = [180, -90, 0].map(degToRad) as Pose['euler']
    displayTargetPose.rotation = eulerZYXToMatrix(displayTargetPose.euler)
    const displayResult = planCartesianPath(
      displayTargetPose,
      INITIAL_JOINTS,
      model,
      ABB_JOINT_RANGES,
    )
    const motionResult = planCartesianTarget(
      displayTargetPose,
      INITIAL_JOINTS,
      ABB_IRB1200_PROFILE,
      { allowWristEntry: true },
    )
    let positionOnlyJoints = [...INITIAL_JOINTS] as JointAngles
    let positionOnlyFailure: unknown = null
    const positionOnlySnapshots: Array<{ waypointIndex: number; joints: JointAngles }> = []
    let positionOnlyMaxOrientationErrorDeg = 0
    const positionOnlyPoses = buildFixedOrientationPath(startPose, targetPose, 50)
    for (let index = 0; index < positionOnlyPoses.length; index += 1) {
      const solved = resolveJointSolution(
        positionOnlyPoses[index],
        positionOnlyJoints,
        model,
        ABB_JOINT_RANGES,
        {
          positionOnly: true,
          posTolerance: 0.05,
          jointContinuityReferenceDeg: positionOnlyJoints,
          jointContinuityWeights: [0, 0, 0, 100, 0, 100],
        },
      )
      if ('failure' in solved) {
        positionOnlyFailure = { waypointIndex: index + 1, ...solved }
        break
      }
      positionOnlyJoints = solved.joints
      const actualPose = model.forwardKinematics(positionOnlyJoints)
      if (actualPose) {
        positionOnlyMaxOrientationErrorDeg = Math.max(
          positionOnlyMaxOrientationErrorDeg,
          (rotationDistanceRad(positionOnlyPoses[index].rotation, actualPose.rotation) * 180) / Math.PI,
        )
      }
      if (index === 0 || index === 24 || index === 44 || index === 49) {
        positionOnlySnapshots.push({ waypointIndex: index + 1, joints: [...positionOnlyJoints] })
      }
    }
    const continuityWeightReports = [0, 1, 5, 10, 25, 50, 100].map((continuityWeight) => {
      let joints = [...INITIAL_JOINTS] as JointAngles
      let maxOrientationErrorDeg = 0
      let maxWristDeltaDeg = 0
      let failure: unknown = null
      for (const [waypointIndex, pose] of positionOnlyPoses.entries()) {
        const solved = resolveJointSolution(
          pose,
          joints,
          model,
          ABB_JOINT_RANGES,
          {
            positionOnly: true,
            posTolerance: 0.05,
            jointContinuityReferenceDeg: joints,
            jointContinuityWeights: [0, 0, 0, continuityWeight, 0, continuityWeight],
          },
        )
        if ('failure' in solved) {
          failure = { waypointIndex: waypointIndex + 1, ...solved }
          break
        }
        maxWristDeltaDeg = Math.max(
          maxWristDeltaDeg,
          Math.abs(solved.joints[3] - joints[3]),
          Math.abs(solved.joints[5] - joints[5]),
        )
        joints = solved.joints
        const actualPose = model.forwardKinematics(joints)
        if (actualPose) {
          maxOrientationErrorDeg = Math.max(
            maxOrientationErrorDeg,
            (rotationDistanceRad(pose.rotation, actualPose.rotation) * 180) / Math.PI,
          )
        }
      }
      return { continuityWeight, maxOrientationErrorDeg, maxWristDeltaDeg, failure }
    })
    const orientationWeightReports = [0.05, 0.1, 0.2, 0.35, 0.5, 0.75].map((orientationWeight) => {
      let joints = [...INITIAL_JOINTS] as JointAngles
      let maxOrientationErrorDeg = 0
      let maxWristStepDeg = 0
      let maxWristDeltaDeg = 0
      let failure: unknown = null
      for (const [waypointIndex, pose] of positionOnlyPoses.entries()) {
        const previous = joints
        const solved = resolveJointSolution(
          pose,
          joints,
          model,
          ABB_JOINT_RANGES,
          {
            positionOnly: true,
            orientationWeight,
            posTolerance: 0.05,
            oriTolerance: (2 * Math.PI) / 180,
            jointContinuityReferenceDeg: joints,
            jointContinuityWeights: [0, 0, 0, 0.01, 0, 0.01],
          },
        )
        if ('failure' in solved) {
          failure = { waypointIndex: waypointIndex + 1, ...solved }
          break
        }
        maxWristStepDeg = Math.max(
          maxWristStepDeg,
          Math.abs(solved.joints[3] - previous[3]),
          Math.abs(solved.joints[5] - previous[5]),
        )
        maxWristDeltaDeg = Math.max(
          maxWristDeltaDeg,
          Math.abs(solved.joints[3] - INITIAL_JOINTS[3]),
          Math.abs(solved.joints[5] - INITIAL_JOINTS[5]),
        )
        joints = solved.joints
        const actualPose = model.forwardKinematics(joints)
        if (actualPose) {
          maxOrientationErrorDeg = Math.max(
            maxOrientationErrorDeg,
            (rotationDistanceRad(pose.rotation, actualPose.rotation) * 180) / Math.PI,
          )
        }
      }
      return { orientationWeight, maxOrientationErrorDeg, maxWristStepDeg, maxWristDeltaDeg, failure }
    })
    const poseTransitionReports = [0, 1, 2].flatMap((offsetDeg) =>
      ([0, 1, 2] as const).flatMap((axis) =>
        ([-1, 1] as const).map((direction) => {
          const transitionedTarget = clonePose(targetPose)
          transitionedTarget.rotation = mat3Mul(
            axisRotation(axis, (direction * offsetDeg * Math.PI) / 180),
            targetPose.rotation,
          )
          transitionedTarget.euler = rotationMatrixToEulerZYX(transitionedTarget.rotation)
          const planned = planCartesianPath(
            transitionedTarget,
            INITIAL_JOINTS,
            model,
            ABB_JOINT_RANGES,
          )
          return {
            axis,
            offsetDeg: direction * offsetDeg,
            ok: planned.ok,
            failure: planned.ok ? null : planned.failure,
            diagnostic: planned.ok ? null : planned.diagnostic,
          }
        }),
      ),
    )
    console.info(
      '[UPWARD-WRIST-DIAGNOSTIC-RESULT]',
      JSON.stringify({
        startPose,
        targetPose,
        result,
        displayResult,
        motionResult,
        positionOnlyFailure,
        positionOnlySnapshots,
        positionOnlyMaxOrientationErrorDeg,
        continuityWeightReports,
        orientationWeightReports,
        poseTransitionReports,
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok || !result.diagnostic) return

    const waypointCount = Math.max(result.diagnostic.waypointIndex, 50)
    const poses = buildFixedOrientationPath(startPose, targetPose, waypointCount)
    const stepReports = [5, 10, 15].map((maxJointStepDeg) => {
      const report = analyzeWristPathFeasibility(
        poses,
        INITIAL_JOINTS,
        model,
        ABB_JOINT_RANGES,
        (pose) => pose,
        { maxJointStepDeg, solverConfig: { posTolerance: 0.05, oriTolerance: 0.001 } },
      )
      return {
        maxJointStepDeg,
        strictAll: report.strictAll,
      }
    })
    const snapshots = [43, 44, 45, 46].map((waypointIndex) => ({
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
          withinJointRanges: candidate.withinJointRanges,
          atJointLimit: candidate.atJointLimit,
          j5Deg: candidate.normalizedJoints?.[4],
          wristDeltaDeg: candidate.normalizedJoints
            ? Math.max(
                Math.abs(candidate.normalizedJoints[3] - INITIAL_JOINTS[3]),
                Math.abs(candidate.normalizedJoints[5] - INITIAL_JOINTS[5]),
              )
            : null,
        })),
      rawCandidates: solveAbbAnalyticIK(poses[waypointIndex - 1])
        .filter((candidate) => candidate.positionErrorMm <= 0.05 && candidate.orientationErrorRad <= 0.001)
        .map((candidate) => candidate.joints),
    }))
    console.info(
      '[UPWARD-WRIST-DIAGNOSTIC]',
      JSON.stringify({
        failure: result.failure,
        diagnostic: result.diagnostic,
        stepReports,
        snapshots,
      }),
    )
  })
})
