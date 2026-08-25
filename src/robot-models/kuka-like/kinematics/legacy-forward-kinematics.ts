import { Matrix4x4 } from '@/robotics/kinematics/transform-matrix.ts'
import { extractPose } from '@/robotics/kinematics/pose-conversion.ts'
import type { JointAngles, PoseDisplay } from '@/robotics/model/joint-pose.ts'
import type { RobotConfig } from '@/robotics/kinematics/dh-types.ts'

/** KUKA 回退模型使用的历史 DH 变换；角度为弧度，长度为毫米。 */
function dhTransform(theta: number, d: number, a: number, alpha: number): Matrix4x4 {
  const cosTheta = Math.cos(theta)
  const sinTheta = Math.sin(theta)
  const cosAlpha = Math.cos(alpha)
  const sinAlpha = Math.sin(alpha)

  return new Matrix4x4([
    [cosTheta, -sinTheta, 0, a],
    [sinTheta * cosAlpha, cosTheta * cosAlpha, -sinAlpha, -d * sinAlpha],
    [sinTheta * sinAlpha, cosTheta * sinAlpha, cosAlpha, d * cosAlpha],
    [0, 0, 0, 1],
  ])
}

/** 历史 KUKA DH 正解核心：关节输入为弧度，DH 偏置仍为弧度。 */
export function forwardKinematics(jointsRad: JointAngles, config: RobotConfig): Matrix4x4 {
  const dhValues = Object.values(config.dhParams)
  return dhValues.reduce((transform, dh, index) => {
    const theta = jointsRad[index] * (dh.thetaSign ?? 1) + (dh.thetaOffset ?? 0)
    return transform.multiply(dhTransform(theta, dh.d, dh.a, dh.alpha))
  }, Matrix4x4.identity())
}

export function forwardKinematicsDegrees(jointsDeg: JointAngles, config: RobotConfig): Matrix4x4 {
  const jointsRad = jointsDeg.map((angle) => (angle * Math.PI) / 180) as JointAngles
  return forwardKinematics(jointsRad, config)
}

export function poseFromJoints(joints: JointAngles, config: RobotConfig): PoseDisplay {
  const pose = extractPose(forwardKinematicsDegrees(joints, config))
  return {
    positionMm: pose.position,
    orientationDeg: pose.eulerZYX.map((value) => (value * 180) / Math.PI) as [
      number,
      number,
      number,
    ],
  }
}
