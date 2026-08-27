import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/index.ts'
import { rotationDistanceRad } from '../math/rotation3d.ts'
import { createMotionRunner, type MotionClock } from '../motion/runner.ts'
import { planCartesianPath } from '@/robot-motion-core/internal/cartesian/path-planner.ts'
import type { RobotProfile } from '../model/robot-profile.ts'
import type { JointAngles, Pose } from '../model/index.ts'

const planCartesianTarget = (
  target: Pose,
  joints: JointAngles,
  profile: RobotProfile,
  options?: Parameters<typeof planCartesianPath>[4],
) => planCartesianPath(target, joints, profile.model, profile.jointRanges, options)

class ManualMotionClock implements MotionClock {
  private currentTime = 0
  private nextFrameId = 1
  private readonly frames = new Map<number, () => void>()

  now(): number {
    return this.currentTime
  }

  requestFrame(callback: () => void): number {
    const id = this.nextFrameId
    this.nextFrameId += 1
    this.frames.set(id, callback)
    return id
  }

  cancelFrame(id: number): void {
    this.frames.delete(id)
  }

  advanceBy(milliseconds: number): void {
    this.currentTime += milliseconds
    const callbacks = [...this.frames.values()]
    this.frames.clear()
    callbacks.forEach((callback) => callback())
  }
}

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position] as Pose['position'],
    euler: [...pose.euler] as Pose['euler'],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

function moveCartesianStep(
  joints: JointAngles,
  axis: 1 | 2,
  delta: number,
): { joints: JointAngles; positionErrorMm: number; orientationErrorRad: number } {
  const model = ABB_IRB1200_PROFILE.model
  const current = model.forwardKinematics(joints)
  expect(current).not.toBeNull()
  if (!current) throw new Error('Cartesian baseline current FK unexpectedly failed')
  const target = clonePose(current)
  target.position[axis] += delta
  const result = planCartesianTarget(target, joints, ABB_IRB1200_PROFILE, {
    preserveConfiguration: false,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`Cartesian baseline step failed: ${result.failure}`)

  const next = result.waypoints[result.waypoints.length - 1]
  const solved = model.forwardKinematics(next)
  expect(solved).not.toBeNull()
  if (!solved) throw new Error('Cartesian baseline FK unexpectedly failed')
  return {
    joints: [...next] as JointAngles,
    positionErrorMm: Math.hypot(
      solved.position[0] - target.position[0],
      solved.position[1] - target.position[1],
      solved.position[2] - target.position[2],
    ),
    orientationErrorRad: rotationDistanceRad(target.rotation, solved.rotation),
  }
}

describe('Cartesian Jog baseline', () => {
  it('通过统一 RAF 轨迹 retarget 连续推进而不倒退', () => {
    const clock = new ManualMotionClock()
    let joints: JointAngles = [0, 0, 0, 0, 0, 0]
    const samples: number[] = []
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
        samples.push(joints[0])
      },
    })

    runner.startTrajectory([[10, 10, 10, 10, 10, 10]], 140)
    clock.advanceBy(70)
    runner.startTrajectory([[20, 20, 20, 20, 20, 20]], 140)
    clock.advanceBy(70)
    clock.advanceBy(70)

    expect(samples.length).toBeGreaterThan(1)
    expect(samples.every((value, index) => index === 0 || value >= samples[index - 1])).toBe(true)
    expect(joints).toEqual([20, 20, 20, 20, 20, 20])
  })

  it.each([-1, 1] as const)('机械零位 Y 侧 %s50 后 Z≈700→1100 保持 TCP 直线', (yDirection) => {
    let joints: JointAngles = [0, 0, 0, 0, 30, 0]
    let maxWristStep = 0
    let maxPositionError = 0
    let maxOrientationError = 0

    const move = (axis: 1 | 2, delta: number, count: number): void => {
      for (let index = 0; index < count; index += 1) {
        const previous = joints
        const result = moveCartesianStep(previous, axis, delta)
        maxWristStep = Math.max(
          maxWristStep,
          Math.abs(result.joints[3] - previous[3]),
          Math.abs(result.joints[5] - previous[5]),
        )
        maxPositionError = Math.max(maxPositionError, result.positionErrorMm)
        maxOrientationError = Math.max(maxOrientationError, result.orientationErrorRad)
        joints = result.joints
      }
    }

    move(1, yDirection * 10, 5)
    move(2, -10, 20)
    const lowerPose = ABB_IRB1200_PROFILE.model.forwardKinematics(joints)
    expect(lowerPose).not.toBeNull()
    if (!lowerPose) throw new Error('Cartesian baseline lower-Z FK unexpectedly failed')
    const lowerZ = lowerPose.position[2]
    move(2, 10, 45)
    const finalPose = ABB_IRB1200_PROFILE.model.forwardKinematics(joints)
    expect(finalPose).not.toBeNull()
    if (!finalPose) throw new Error('Cartesian baseline final FK unexpectedly failed')

    expect(lowerZ).toBeCloseTo(648.1, 0)
    expect(finalPose.position[2]).toBeCloseTo(1098.1, 0)
    // 当前 5391 串行基线允许有限的大幅腕部过渡；候选图票据再将该上限收紧到 5°。
    expect(maxWristStep).toBeLessThan(90)
    expect(maxPositionError).toBeLessThan(0.2)
    expect(maxOrientationError).toBeLessThanOrEqual((2 * Math.PI) / 180 + 1e-8)
  })
})
