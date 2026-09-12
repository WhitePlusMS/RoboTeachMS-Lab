import type { RobotProfile } from '@/robot-geometry/robot-types.ts'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import { rotationDistanceRad } from '@/robot-geometry/math/rotation3d.ts'
import type {
  JointVector6,
  ToolData,
  ABBConfigurationData,
  MotionPlanningResultOk,
} from './contracts.ts'
import { frameMatrix, multiplyRigid, poseFromMatrix, poseToFrameData } from './pose-frames.ts'

/** 统一生成规划结果、残差与教学时间；仅依赖当前机型，不持有宿主状态。 */
export function createPlanOutput(profile: RobotProfile) {
  function configurationData(joints: JointAngles): ABBConfigurationData | undefined {
    const config = profile.model.deriveConfiguration?.(joints)
    return config && config.length >= 4
      ? { cf1: config[0], cf4: config[1], cf6: config[2], cfx: config[3] }
      : undefined
  }

  function makePlan(
    waypoints: readonly JointAngles[],
    initial: JointVector6,
    targetPose?: Pose,
    relaxedConstraints?: readonly string[],
    tool?: ToolData,
  ): MotionPlanningResultOk {
    const all = [
      [...initial] as JointVector6,
      ...waypoints.map((joints) => [...joints] as JointVector6),
    ]
    const unique = all.filter(
      (point, index) =>
        index === 0 || point.some((value, axis) => Math.abs(value - all[index - 1][axis]) > 1e-9),
    )
    const timed = unique.map((joints, index) => ({
      timeMs: unique.length === 1 ? 0 : (index * 800) / (unique.length - 1),
      jointsDeg: joints,
    }))
    const end = timed.at(-1)?.jointsDeg ?? initial
    const endPose = tool
      ? tcpPoseForJoints(end as JointAngles, tool)
      : profile.model.forwardKinematics(end as JointAngles)
    const tcpResidualMm =
      targetPose && endPose
        ? Math.hypot(...targetPose.position.map((value, axis) => value - endPose.position[axis]))
        : undefined
    const orientationResidualDeg =
      targetPose && endPose
        ? (rotationDistanceRad(targetPose.rotation, endPose.rotation) * 180) / Math.PI
        : undefined
    const configuration = configurationData(end as JointAngles)
    return {
      ok: true,
      waypoints: timed,
      end: { jointsDeg: end, ...(configuration ? { configuration } : {}) },
      validation: { tcpResidualMm, orientationResidualDeg, relaxedConstraints },
    }
  }

  function tcpPoseForJoints(joints: JointAngles, tool: ToolData): Pose | null {
    const flange = profile.model.forwardKinematics(joints)
    return flange
      ? poseFromMatrix(
          multiplyRigid(frameMatrix(poseToFrameData(flange)), frameMatrix(tool.tcpInFlange)),
        )
      : null
  }

  /** 依据 TCP 点列累计距离分配时间，最终总时长严格等于几何长度/速度。 */
  function retimeByTcpPathLength(
    plan: MotionPlanningResultOk,
    initial: JointVector6,
    tool: ToolData,
    pathLengthMm: number | undefined,
    speedMmPerSec: number,
    speedOriDegPerSec = 90,
  ): MotionPlanningResultOk {
    if (plan.waypoints.length <= 1) return plan
    const tcpPoints = plan.waypoints.map(
      (point, index) =>
        tcpPoseForJoints(point.jointsDeg as JointAngles, tool) ??
        (index === 0 ? tcpPoseForJoints(initial as JointAngles, tool) : null),
    )
    const cumulative = [0]
    const angular = [0]
    for (let index = 1; index < tcpPoints.length; index += 1) {
      const previous = tcpPoints[index - 1]
      const current = tcpPoints[index]
      const segment =
        previous && current
          ? Math.hypot(...current.position.map((value, axis) => value - previous.position[axis]))
          : 0
      cumulative.push(cumulative[index - 1] + (Number.isFinite(segment) ? segment : 0))
      angular.push(
        angular[index - 1] +
          (previous && current
            ? (rotationDistanceRad(previous.rotation, current.rotation) * 180) / Math.PI
            : 0),
      )
    }
    const measuredLength = cumulative.at(-1) ?? 0
    const angle = angular.at(-1) ?? 0
    const linearDuration = ((pathLengthMm ?? measuredLength) / speedMmPerSec) * 1000
    const angularDuration = (angle / speedOriDegPerSec) * 1000
    // 教学时序，不宣称控制器伺服模型；姿态速度和 TCP 速度取更慢约束。
    const duration = Math.max(1, linearDuration, angularDuration)
    const distances = angularDuration > linearDuration ? angular : cumulative
    const total = distances.at(-1) ?? 0
    return {
      ...plan,
      waypoints: plan.waypoints.map((point, index) => ({
        ...point,
        timeMs:
          duration *
          (total > 1e-9 ? distances[index] / total : index / (plan.waypoints.length - 1)),
      })),
    }
  }
  return { configurationData, makePlan, retimeByTcpPathLength }
}
