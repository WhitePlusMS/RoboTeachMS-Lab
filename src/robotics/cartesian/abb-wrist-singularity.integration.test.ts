import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/index.ts'
import { planCartesianPath } from '@/robot-motion-core/internal/cartesian/path-planner.ts'
import type { RobotProfile } from '../model/robot-profile.ts'
import type { JointAngles, Pose } from '../model/index.ts'

const planCartesianTarget = (
  target: Pose,
  joints: JointAngles,
  profile: RobotProfile,
  options?: Parameters<typeof planCartesianPath>[4],
) => planCartesianPath(target, joints, profile.model, profile.jointRanges, options)

const ZERO_JOINTS: JointAngles = [0, 0, 0, 0, 30, 0]

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position] as Pose['position'],
    euler: [...pose.euler] as Pose['euler'],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

interface MonitoredStep {
  label: string
  joints: JointAngles
  maxInternalStepDeg: number
  maxWristStepDeg: number
}

function executeStep(
  joints: JointAngles,
  axis: 1 | 2,
  deltaMm: number,
  label: string,
): { joints: JointAngles; report: MonitoredStep } {
  const currentPose = ABB_IRB1200_PROFILE.model.forwardKinematics(joints)
  if (!currentPose) throw new Error(`${label}: FK 失败`)
  const target = clonePose(currentPose)
  target.position[axis] += deltaMm
  const result = planCartesianTarget(target, joints, ABB_IRB1200_PROFILE, {
    preserveConfiguration: false,
  })
  if (!result.ok) {
    throw new Error(`${label}: ${result.failure} ${JSON.stringify(result.diagnostic ?? {})}`)
  }

  let previous = joints
  let maxInternalStepDeg = 0
  let maxWristStepDeg = 0
  for (const waypoint of result.waypoints) {
    maxInternalStepDeg = Math.max(
      maxInternalStepDeg,
      ...waypoint.map((value, index) => Math.abs(value - previous[index])),
    )
    maxWristStepDeg = Math.max(
      maxWristStepDeg,
      Math.abs(waypoint[3] - previous[3]),
      Math.abs(waypoint[5] - previous[5]),
    )
    previous = waypoint
  }
  const report: MonitoredStep = {
    label,
    joints: previous,
    maxInternalStepDeg,
    maxWristStepDeg,
  }
  return { joints: previous, report }
}

function runPath(yDirection: -1 | 1): MonitoredStep[] {
  let joints = [...ZERO_JOINTS] as JointAngles
  const reports: MonitoredStep[] = []
  const signLabel = yDirection > 0 ? 'Y+50' : 'Y-50'

  for (let step = 1; step <= 5; step += 1) {
    const executed = executeStep(joints, 1, yDirection * 10, `${signLabel}/Y${step}`)
    joints = executed.joints
    reports.push(executed.report)
  }
  // 先降到显示值约 700 mm，再完整覆盖最低点→最高点的 Z 上升区间。
  for (let step = 1; step <= 19; step += 1) {
    const executed = executeStep(joints, 2, -10, `${signLabel}/Z-${step}`)
    joints = executed.joints
    reports.push(executed.report)
  }
  for (let step = 1; step <= 40; step += 1) {
    const executed = executeStep(joints, 2, 10, `${signLabel}/Z+${step}`)
    joints = executed.joints
    reports.push(executed.report)
  }
  return reports
}

describe('机械零位 Cartesian Jog 路径约束', () => {
  it.each([-1, 1] as const)('Y%+d50 后 Z+ 连续上升保持 5° 相邻步长', (yDirection) => {
    const reports = runPath(yDirection)
    const maxWristAbsolute = Math.max(
      ...reports.map((report) => Math.max(Math.abs(report.joints[3]), Math.abs(report.joints[5]))),
    )
    const maxInternalStep = Math.max(...reports.map((report) => report.maxInternalStepDeg))
    const maxWristStep = Math.max(...reports.map((report) => report.maxWristStepDeg))
    expect(maxWristAbsolute).toBeLessThan(180)
    expect(maxInternalStep).toBeLessThanOrEqual(5 + 1e-6)
    expect(maxWristStep).toBeLessThanOrEqual(5 + 1e-6)
  })
})
