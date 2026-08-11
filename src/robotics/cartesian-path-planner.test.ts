import { describe, expect, it } from 'vitest'
import { AbbDhRobotModel } from '../robot-models/abb-irb1200/dh-robot-model.ts'
import { ABB_JOINT_RANGES } from '../robot-models/abb-irb1200/robot-config.ts'
import type { JointAngles, Pose } from './types.ts'
import { planCartesianPath } from './cartesian-path-planner.ts'
import { mat3Mul, mat3Transpose, rotationMatrixToEulerZYX } from './math/rotation3d.ts'

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position],
    euler: [...pose.euler],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

function rotationDistanceDegrees(left: number[][], right: number[][]): number {
  const relative = mat3Mul(left, mat3Transpose(right))
  const cosine = Math.max(-1, Math.min(1, (relative[0][0] + relative[1][1] + relative[2][2] - 1) / 2))
  return (Math.acos(cosine) * 180) / Math.PI
}

describe('Cartesian path planner', () => {
  it('让 ABB 的 5 mm 世界坐标点动保持直线并准确到达终点', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
    const startPose = model.forwardKinematics(startJoints)
    const targetPose = clonePose(startPose)
    targetPose.position[0] += 5

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES)

    expect(path).not.toBeNull()
    if (!path) return
    const poses = path.map((joints) => model.forwardKinematics(joints))
    const maxCrossTrackError = Math.max(...poses.map((pose) => Math.hypot(
      pose.position[1] - startPose.position[1],
      pose.position[2] - startPose.position[2],
    )))
    const endpoint = poses[poses.length - 1]
    expect(maxCrossTrackError).toBeLessThan(0.5)
    expect(Math.hypot(
      endpoint.position[0] - targetPose.position[0],
      endpoint.position[1] - targetPose.position[1],
      endpoint.position[2] - targetPose.position[2],
    )).toBeLessThan(0.2)
  })

  it('拒绝会让 ABB 关节跨构型跳变的 5 mm 目标', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [-129.4, 58.4, -30.4, -148.6, -66.7, 35.2]
    const targetPose = clonePose(model.forwardKinematics(startJoints))
    targetPose.position[2] += 5

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES)

    expect(path).toBeNull()
  })

  it('把 ABB 的 10 度姿态点动拆成连续的小角度 waypoint', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
    const startPose = model.forwardKinematics(startJoints)
    const targetPose = clonePose(startPose)
    const angle = (10 * Math.PI) / 180
    const worldZRotation = [
      [Math.cos(angle), -Math.sin(angle), 0],
      [Math.sin(angle), Math.cos(angle), 0],
      [0, 0, 1],
    ]
    targetPose.rotation = mat3Mul(worldZRotation, startPose.rotation)
    targetPose.euler = rotationMatrixToEulerZYX(targetPose.rotation)

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES)

    expect(path).not.toBeNull()
    if (!path) return
    const rotations = [startPose.rotation, ...path.map((joints) => model.forwardKinematics(joints).rotation)]
    const maxOrientationStep = Math.max(...rotations.slice(1).map((rotation, index) =>
      rotationDistanceDegrees(rotation, rotations[index]),
    ))
    expect(path.length).toBeGreaterThanOrEqual(10)
    expect(maxOrientationStep).toBeLessThan(1.5)
  })
})
