import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/robot-config.ts'
import { solveGizmoTarget } from './ik-waypoint-solver.ts'
import { planCartesianPath } from './cartesian-path-planner.ts'
import type { JointAngles, Pose } from './types.ts'

const CURRENT_JOINTS: JointAngles = [24.7, 111.1, -77.9, -1.6, 54.2, 25.6]

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position] as Pose['position'],
    euler: [...pose.euler] as Pose['euler'],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

describe('操作轴与笛卡尔 Jog 逆解入口对照', () => {
  it('同一 Z 目标分别记录单点 IK 与整条路径 IK 结果', () => {
    const model = ABB_IRB1200_PROFILE.model
    const currentPose = model.forwardKinematics(CURRENT_JOINTS) as Pose
    const targetPose = clonePose(currentPose)
    targetPose.position = [747.5, 341.1, 695]

    const gizmoJoints = solveGizmoTarget(
      targetPose,
      CURRENT_JOINTS,
      model,
      ABB_JOINT_RANGES,
    )
    const jog = planCartesianPath(targetPose, CURRENT_JOINTS, model, ABB_JOINT_RANGES)

    expect(gizmoJoints).not.toBeNull()
    expect(jog.ok).toBe(true)
    if (!gizmoJoints || !jog.ok) return
    const gizmoPose = model.forwardKinematics(gizmoJoints) as Pose
    const jogEnd = jog.waypoints[jog.waypoints.length - 1]
    const jogPose = model.forwardKinematics(jogEnd) as Pose
    console.info(
      '[GIZMO-JOG-PARITY]',
      JSON.stringify({
        currentJoints: CURRENT_JOINTS,
        currentPosition: currentPose.position,
        targetPosition: targetPose.position,
        gizmoJoints,
        gizmoPosition: gizmoPose.position,
        jogEnd,
        jogPosition: jogPose.position,
        jogWaypointCount: jog.waypoints.length,
      }),
    )
  })
})
