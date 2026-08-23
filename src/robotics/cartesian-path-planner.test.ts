import { describe, expect, it } from 'vitest'
import { AbbDhRobotModel } from '@/robot-models/abb-irb1200/dh-robot-model.ts'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/robot-config.ts'
import type { JointAngles, Pose } from './types.ts'
import { planCartesianPath } from './cartesian-path-planner.ts'
import { planCartesianTarget } from './cartesian-motion-planner.ts'
import { mat3Mul, mat3Transpose, rotationMatrixToEulerZYX } from '@/robotics/math/rotation3d.ts'

function clonePose(pose: Pose): Pose {
  return {
    position: [...pose.position],
    euler: [...pose.euler],
    rotation: pose.rotation.map((row) => [...row]),
  }
}

function rotationDistanceDegrees(left: number[][], right: number[][]): number {
  const relative = mat3Mul(left, mat3Transpose(right))
  const cosine = Math.max(
    -1,
    Math.min(1, (relative[0][0] + relative[1][1] + relative[2][2] - 1) / 2),
  )
  return (Math.acos(cosine) * 180) / Math.PI
}

describe('Cartesian path planner', () => {
  it('ABB 自动 wrist 邻域严格限制为机械零位 5° 且 J5 1° 内', () => {
    const model = new AbbDhRobotModel()

    expect(model.isMechanicalZeroSingularityNeighborhood([5, -5, 5, -5, 1, 5])).toBe(true)
    expect(model.isMechanicalZeroSingularityNeighborhood([5.01, 0, 0, 0, 0, 0])).toBe(false)
    expect(model.isMechanicalZeroSingularityNeighborhood([0, 0, 0, 0, 1.01, 0])).toBe(false)
    expect(model.isMechanicalZeroSingularityNeighborhood([0, 0, 0, 0, 0, -300])).toBe(false)
  })

  it('让 ABB 的 5 mm 世界坐标点动保持直线并准确到达终点', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
    const startPose = model.forwardKinematics(startJoints)
    const targetPose = clonePose(startPose)
    targetPose.position[0] += 5

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES)

    expect(path.ok).toBe(true)
    if (!path.ok) return
    const poses = path.waypoints.map((joints) => model.forwardKinematics(joints))
    const maxCrossTrackError = Math.max(
      ...poses.map((pose) =>
        Math.hypot(
          pose.position[1] - startPose.position[1],
          pose.position[2] - startPose.position[2],
        ),
      ),
    )
    const endpoint = poses[poses.length - 1]
    expect(maxCrossTrackError).toBeLessThan(0.5)
    expect(
      Math.hypot(
        endpoint.position[0] - targetPose.position[0],
        endpoint.position[1] - targetPose.position[1],
        endpoint.position[2] - targetPose.position[2],
      ),
    ).toBeLessThan(0.2)
  })

  it('非机械零位的 J5=0 大步长不得误报机械零位腕部重构', () => {
    const model = new AbbDhRobotModel()
    // J5=0° 且 J6 位于另一构型时，X 点动会迫使 IK 在相邻采样点间跨构型。
    const startJoints: JointAngles = [15, -20, 30, 0, 0, -300]
    const targetPose = clonePose(model.forwardKinematics(startJoints))
    targetPose.position[0] += 5

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES)

    expect(path).toMatchObject({ ok: false, failure: 'ik-not-converged' })
    if (!path.ok) {
      expect(path.diagnostic?.axisIndex).toBe(3)
      expect(path.diagnostic?.waypointIndex).toBe(1)
    }
  })

  it('非机械零位邻域即使 J5=0 也禁止 SingArea\\Wrist 回退', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [15, -20, 30, 0, 0, -300]
    const targetPose = clonePose(model.forwardKinematics(startJoints))
    targetPose.position[0] += 5

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES, {
      orientationMode: 'wrist',
    })

    expect(path).toMatchObject({ ok: false, failure: 'ik-not-converged' })
    if (!path.ok) expect(path.diagnostic?.axisIndex).toBe(3)
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

    expect(path.ok).toBe(true)
    if (!path.ok) return
    const rotations = [
      startPose.rotation,
      ...path.waypoints.map((joints) => model.forwardKinematics(joints).rotation),
    ]
    const maxOrientationStep = Math.max(
      ...rotations
        .slice(1)
        .map((rotation, index) => rotationDistanceDegrees(rotation, rotations[index])),
    )
    expect(path.waypoints.length).toBeGreaterThanOrEqual(10)
    expect(maxOrientationStep).toBeLessThan(1.5)
  })

  it('机械零位的 Y 点动报告腕部构型重分配，而不是普通不可达', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [0, 0, 0, 0, 0, 0]
    const targetPose = clonePose(model.forwardKinematics(startJoints))
    targetPose.position[1] += 1

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES)
    expect(path).toMatchObject({ ok: false, failure: 'wrist-reconfiguration' })
    if (!path.ok) expect([3, 5]).toContain(path.diagnostic?.axisIndex)
  })

  it('SingArea\\Wrist 在腕部奇异处保持 TCP 位置并允许姿态误差', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [0, 0, 0, 0, 0, 0]
    const startPose = model.forwardKinematics(startJoints)
    const targetPose = clonePose(startPose)
    targetPose.position[1] += 1

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES, {
      orientationMode: 'wrist',
    })

    expect(path.ok).toBe(true)
    if (!path.ok) return
    expect(path.appliedSingularityMode).toBe('wrist')
    const endpoint = model.forwardKinematics(path.waypoints[path.waypoints.length - 1])
    expect(endpoint.position[1]).toBeCloseTo(targetPose.position[1], 1)
    const maxOrientationError = Math.max(
      ...path.waypoints.map((joints) =>
        rotationDistanceDegrees(model.forwardKinematics(joints).rotation, targetPose.rotation),
      ),
    )
    expect(maxOrientationError).toBeLessThanOrEqual(2.01)
  })

  it('SingArea\\Wrist 在非奇异路径优先保持原目标姿态', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
    const startPose = model.forwardKinematics(startJoints)
    const targetPose = clonePose(startPose)
    targetPose.position[0] += 5

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES, {
      orientationMode: 'wrist',
    })

    expect(path.ok).toBe(true)
    if (!path.ok) return
    expect(path.appliedSingularityMode).toBeNull()
    const endpoint = model.forwardKinematics(path.waypoints[path.waypoints.length - 1])
    expect(rotationDistanceDegrees(endpoint.rotation, targetPose.rotation)).toBeLessThan(0.5)
  })

  it('SingArea\\Wrist 在非奇异的平移加姿态路径不应全局退化为 position-only', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [15, -20, 30, 10, 25, -15]
    const startPose = model.forwardKinematics(startJoints)
    const targetPose = clonePose(startPose)
    targetPose.position[0] += 5
    const angle = (25 * Math.PI) / 180
    targetPose.rotation = mat3Mul(
      [
        [Math.cos(angle), -Math.sin(angle), 0],
        [Math.sin(angle), Math.cos(angle), 0],
        [0, 0, 1],
      ],
      startPose.rotation,
    )
    targetPose.euler = rotationMatrixToEulerZYX(targetPose.rotation)

    const path = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES, {
      orientationMode: 'wrist',
    })

    expect(path.ok).toBe(true)
    if (!path.ok) return
    expect(path.appliedSingularityMode).toBeNull()
    const endpoint = model.forwardKinematics(path.waypoints[path.waypoints.length - 1])
    expect(rotationDistanceDegrees(endpoint.rotation, targetPose.rotation)).toBeLessThan(1)
  })

  it('非奇异教学 Home 的 XYZ 六方向均可规划 1 mm 点动', () => {
    const model = new AbbDhRobotModel()
    const startJoints: JointAngles = [0, -25, 45, 0, 20, 0]
    const startPose = model.forwardKinematics(startJoints)

    for (const axis of [0, 1, 2]) {
      for (const direction of [-1, 1]) {
        const targetPose = clonePose(startPose)
        targetPose.position[axis] += direction
        const result = planCartesianPath(targetPose, startJoints, model, ABB_JOINT_RANGES, {
          orientationMode: 'wrist',
        })
        expect(result.ok, `axis=${axis}, direction=${direction}`).toBe(true)
        if (result.ok) expect(result.appliedSingularityMode, `axis=${axis}, direction=${direction}`).toBeNull()
      }
    }
  })

  it('机械零位 Y 每次 10 mm 可连续走到 +500 再回到 -500，且只局部触发腕部插补', () => {
    const model = new AbbDhRobotModel()
    let joints: JointAngles = [0, 0, 0, 0, 0, 0]
    const startY = model.forwardKinematics(joints).position[1]
    const wristRequests: string[] = []

    const move = (direction: -1 | 1, steps: number, label: string): number => {
      for (let step = 1; step <= steps; step += 1) {
        const current = model.forwardKinematics(joints)
        const target: Pose = {
          position: [
            current.position[0],
            current.position[1] + direction * 10,
            current.position[2],
          ],
          euler: [...current.euler],
          rotation: current.rotation.map((row) => [...row]),
        }
        const result = planCartesianTarget(target, joints, ABB_IRB1200_PROFILE)
        expect(result.ok, `${label} step ${step}`).toBe(true)
        if (!result.ok) return current.position[1]
        if (result.appliedSingularityMode === 'wrist') {
          wristRequests.push(`${label}:${step}`)
        }
        for (const waypoint of result.waypoints) {
          joints = [...waypoint]
        }
      }
      return model.forwardKinematics(joints).position[1]
    }

    const plusY = move(1, 50, 'plus')
    expect(plusY).toBeCloseTo(startY + 500, 0)

    const minusY = move(-1, 100, 'minus')
    expect(minusY).toBeCloseTo(startY - 500, 0)
    expect(wristRequests.length).toBeGreaterThan(0)
    expect(wristRequests.length).toBeLessThan(150)
  })

  it('全零位先 Y±50 再沿 +Z 步进时不发生 J4/J6 180°构型跳变', () => {
    const model = new AbbDhRobotModel()

    const run = (yDirection: -1 | 1): void => {
      let joints: JointAngles = [0, 0, 0, 0, 0, 0]
      let maxWristStep = 0

      const move = (axis: 1 | 2, delta: number, count: number): void => {
        for (let step = 0; step < count; step += 1) {
          const current = model.forwardKinematics(joints)
          const target: Pose = {
            position: current.position.map(
              (value, index) => (index === axis ? value + delta : value),
            ) as Pose['position'],
            euler: [...current.euler],
            rotation: current.rotation.map((row) => [...row]),
          }
          const result = planCartesianTarget(target, joints, ABB_IRB1200_PROFILE)
          expect(result.ok, `axis=${axis}, direction=${yDirection}, step=${step + 1}`).toBe(true)
          if (!result.ok) return
          for (const waypoint of result.waypoints) {
            const j4Step = Math.abs(waypoint[3] - joints[3])
            const j6Step = Math.abs(waypoint[5] - joints[5])
            maxWristStep = Math.max(maxWristStep, j4Step, j6Step)
            joints = [...waypoint]
          }
        }
      }

      move(1, yDirection * 10, 5)
      move(2, 10, 10)
      expect(maxWristStep).toBeLessThan(90)
    }

    run(1)
    run(-1)
  })

  it('Y=-50 后从 Z≈700 上行到 Z≈1100 优先保持 J4/J6 腕部侧', () => {
    const model = new AbbDhRobotModel()
    let joints: JointAngles = [0, 0, 0, 0, 0, 0]
    let maxStep = 0

    const move = (axis: 1 | 2, delta: number, count: number): void => {
      for (let step = 0; step < count; step += 1) {
        const current = model.forwardKinematics(joints)
        const target: Pose = {
          position: current.position.map(
            (value, index) => (index === axis ? value + delta : value),
          ) as Pose['position'],
          euler: [...current.euler],
          rotation: current.rotation.map((row) => [...row]),
        }
        const result = planCartesianTarget(target, joints, ABB_IRB1200_PROFILE)
        expect(result.ok, `axis=${axis}, step=${step + 1}`).toBe(true)
        if (!result.ok) return
        for (const waypoint of result.waypoints) {
          maxStep = Math.max(
            maxStep,
            ...waypoint.map((value, jointIndex) => Math.abs(value - joints[jointIndex])),
          )
          joints = [...waypoint]
        }
      }
    }

    move(1, -10, 5)
    move(2, -10, 20)
    const lowerZ = model.forwardKinematics(joints).position[2]
    move(2, 10, 45)
    const finalPose = model.forwardKinematics(joints)

    expect(lowerZ).toBeCloseTo(689.1, 0)
    expect(finalPose.position[2]).toBeCloseTo(1139.1, 0)
    expect(maxStep).toBeLessThan(5)
    // 负 Y 侧不能在上行过程中落回 J4/J6 约 ±170° 的腕部翻转分支。
    expect(Math.abs(joints[3])).toBeLessThan(45)
    expect(Math.abs(joints[5])).toBeLessThan(45)
    expect(joints[4]).toBeGreaterThan(20)
  })

})
