import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import { planCartesianTarget } from './cartesian-motion-planner.ts'
import type { JointAngles, Pose } from './types.ts'

const JOINT_LABELS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] as const
const ZERO_JOINTS: JointAngles = [0, 0, 0, 0, 0, 0]

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position] as Pose['position'],
    euler: [...pose.euler] as Pose['euler'],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

function formatJoints(joints: JointAngles): string {
  return joints.map((value, index) => `${JOINT_LABELS[index]}=${value.toFixed(2)}°`).join(' ')
}

interface MonitoredStep {
  label: string
  command: string
  joints: JointAngles
  maxInternalStepDeg: number
  tcpPosition: readonly [number, number, number]
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
    allowWristEntry: true,
  })
  if (!result.ok) {
    throw new Error(`${label}: ${result.failure} ${JSON.stringify(result.diagnostic ?? {})}`)
  }

  let previous = joints
  let maxInternalStepDeg = 0
  for (const waypoint of result.waypoints) {
    maxInternalStepDeg = Math.max(
      maxInternalStepDeg,
      ...waypoint.map((value, index) => Math.abs(value - previous[index])),
    )
    previous = waypoint
  }
  const finalPose = ABB_IRB1200_PROFILE.model.forwardKinematics(previous)
  if (!finalPose) throw new Error(`${label}: 末端 FK 失败`)
  const report: MonitoredStep = {
    label,
    command: `${axis === 1 ? 'Y' : 'Z'}${deltaMm >= 0 ? '+' : ''}${deltaMm}mm`,
    joints: previous,
    maxInternalStepDeg,
    tcpPosition: finalPose.position,
  }
  console.log(
    `[MECH-ZERO-JOG] ${report.label} ${report.command} ` +
      `${formatJoints(report.joints)} ` +
      `maxΔ=${report.maxInternalStepDeg.toFixed(2)}° ` +
      `TCP=[${report.tcpPosition.map((value) => value.toFixed(1)).join(', ')}]`,
  )
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
  // 从机械零位 Y±50 后持续 Z+，覆盖约 889→1109 mm 的上升区间。
  for (let step = 1; step <= 22; step += 1) {
    const executed = executeStep(joints, 2, 10, `${signLabel}/Z${step}`)
    joints = executed.joints
    reports.push(executed.report)
  }
  return reports
}

describe('机械零位 Cartesian Jog J1-J6 监控脚本', () => {
  it.each([-1, 1] as const)('Y%+d50 后 Z+ 连续上升不发生 180° 轴跳变', (yDirection) => {
    const reports = runPath(yDirection)
    const maxWristStep = Math.max(
      ...reports.map((report) => Math.max(
        Math.abs(report.joints[3]),
        Math.abs(report.joints[5]),
      )),
    )
    const maxInternalStep = Math.max(...reports.map((report) => report.maxInternalStepDeg))
    expect(maxWristStep).toBeLessThan(180)
    expect(maxInternalStep).toBeLessThan(90)
  })
})
