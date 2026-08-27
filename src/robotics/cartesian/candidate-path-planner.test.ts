import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/index.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/index.ts'
import { planStrictCandidateGraph } from '@/robot-motion-core/internal/cartesian/candidate-path-planner.ts'
import { MAX_CARTESIAN_JOINT_STEP_DEG } from '@/robot-motion-core/internal/cartesian/step-policy.ts'
import type { JointAngles, Pose } from '../model/index.ts'

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position],
    euler: [...pose.euler],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

describe('Cartesian candidate graph', () => {
  it('非奇异路径使用整层候选规划并保持无 180° 腕跳', () => {
    const model = ABB_IRB1200_PROFILE.model
    const initial: JointAngles = [0, -25, 45, 0, 20, 0]
    const start = model.forwardKinematics(initial) as Pose
    const target = clonePose(start)
    target.position[0] += 5
    const path = planStrictCandidateGraph(
      [target],
      initial,
      model,
      ABB_JOINT_RANGES,
      (pose) => pose,
    )

    expect(path.ok).toBe(true)
    if (!path.ok) return
    let maxWristStep = 0
    let previous = initial
    for (const joints of path.waypoints) {
      maxWristStep = Math.max(
        maxWristStep,
        Math.abs(joints[3] - previous[3]),
        Math.abs(joints[5] - previous[5]),
      )
      previous = joints
    }
    expect(maxWristStep).toBeLessThanOrEqual(MAX_CARTESIAN_JOINT_STEP_DEG)
  })

  it('空路径返回无代价结果', () => {
    const result = planStrictCandidateGraph(
      [],
      [0, 0, 0, 0, 0, 0],
      ABB_IRB1200_PROFILE.model,
      ABB_JOINT_RANGES,
      (pose) => pose,
    )
    expect(result).toEqual({ ok: true, waypoints: [], cost: 0 })
  })
})
