import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/robot-config.ts'
import { planCartesianPath } from './cartesian-path-planner.ts'
import type { JointAngles, Pose } from './types.ts'

const TOP_JOINTS: JointAngles = [24.7, 66.7, -86.9, -1.4, 107.6, 24.2]
const INDEPENDENT_BOTTOM_JOINTS: JointAngles = [24.7, 120.9, -131.9, -1.3, 98.4, 24.4]
const OBSERVED_DOWN_END: JointAngles = [24.7, 114.6, -84.7, -1.6, 57.5, 25.5]
const OBSERVED_SNAPSHOTS: readonly JointAngles[] = [
  [24.7, 66.7, -86.9, -1.4, 107.6, 24.2],
  [24.7, 85.5, -45.7, -1.8, 47.6, 25.8],
  [24.7, 114.6, -84.7, -1.6, 57.5, 25.5],
  [24.7, 120.9, -131.9, -1.3, 98.4, 24.4],
  [24.7, 91.0, -120.6, -1.5, 117.0, 24.0],
]

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position] as Pose['position'],
    euler: [...pose.euler] as Pose['euler'],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

function maxJointDelta(left: JointAngles, right: JointAngles): number {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])))
}

function closestWaypointAtZ(
  waypoints: readonly JointAngles[],
  model: typeof ABB_IRB1200_PROFILE.model,
  targetZ: number,
): { joints: JointAngles; z: number } | null {
  let best: { joints: JointAngles; z: number; distance: number } | null = null
  for (const joints of waypoints) {
    const pose = model.forwardKinematics(joints)
    if (!pose) continue
    const distance = Math.abs(pose.position[2] - targetZ)
    if (best === null || distance < best.distance) {
      best = { joints, z: pose.position[2], distance }
    }
  }
  return best ? { joints: best.joints, z: best.z } : null
}

describe('笛卡尔 Z 直线正反向构型一致性诊断', () => {
  it('从真实下行末端反向规划时应保持同一关节支路', () => {
    const model = ABB_IRB1200_PROFILE.model
    const topPose = model.forwardKinematics(TOP_JOINTS) as Pose
    const bottomPose = clonePose(topPose)
    bottomPose.position = [749.5, 342, -55.8]

    const down = planCartesianPath(
      bottomPose,
      TOP_JOINTS,
      model,
      ABB_JOINT_RANGES,
    )
    expect(down.ok).toBe(true)
    if (!down.ok) return

    const downEnd = down.waypoints[down.waypoints.length - 1]
    const up = planCartesianPath(
      topPose,
      downEnd,
      model,
      ABB_JOINT_RANGES,
    )
    expect(up.ok).toBe(true)
    if (!up.ok) return

    const upEnd = up.waypoints[up.waypoints.length - 1]
    const independentBottomPose = model.forwardKinematics(INDEPENDENT_BOTTOM_JOINTS) as Pose
    const independentUp = planCartesianPath(
      topPose,
      INDEPENDENT_BOTTOM_JOINTS,
      model,
      ABB_JOINT_RANGES,
    )
    expect(independentUp.ok).toBe(true)
    const observedBottomPose = model.forwardKinematics(OBSERVED_DOWN_END) as Pose
    const observedUp = planCartesianPath(
      topPose,
      OBSERVED_DOWN_END,
      model,
      ABB_JOINT_RANGES,
    )
    expect(observedUp.ok).toBe(true)
    console.info(
      '[CARTESIAN-REVERSIBILITY]',
      JSON.stringify({
        topInitial: TOP_JOINTS,
        topInitialPose: topPose.position,
        topInitialEulerDeg: topPose.euler.map((value) => (value * 180) / Math.PI),
        downEnd,
        upEnd,
        roundTripMaxDeltaDeg: maxJointDelta(TOP_JOINTS, upEnd),
        downWaypointCount: down.waypoints.length,
        upWaypointCount: up.waypoints.length,
        independentBottomPose: independentBottomPose.position,
        independentBottomEulerDeg: independentBottomPose.euler.map((value) => (value * 180) / Math.PI),
        independentBottomToTopEnd: independentUp.ok
          ? independentUp.waypoints[independentUp.waypoints.length - 1]
          : independentUp,
        observedBottomPose: observedBottomPose.position,
        observedBottomToTopEnd: observedUp.ok
          ? observedUp.waypoints[observedUp.waypoints.length - 1]
          : observedUp,
        snapshotFkPositions: OBSERVED_SNAPSHOTS.map((joints) => ({
          joints,
          position: (model.forwardKinematics(joints) as Pose).position,
        })),
        forwardPathAtObservedZ: [214.4, 568.7].map((targetZ) => ({
          targetZ,
          closest: closestWaypointAtZ(down.waypoints, model, targetZ),
        })),
      }),
    )
  })
})
