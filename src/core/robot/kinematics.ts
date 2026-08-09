import { Matrix4x4 } from './matrix4x4'
import type { JointAngles, PoseDisplay, RobotConfig } from './types'

/** 标准 DH 变换；角度参数使用弧度，长度参数使用毫米。 */
export function dhTransform(theta: number, d: number, a: number, alpha: number): Matrix4x4 {
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
/** 正解核心保持历史语义：关节输入为弧度，DH 的偏置仍为弧度。 */
export function forwardKinematics(jointsRad: JointAngles, config: RobotConfig): Matrix4x4 {
  const dhValues = Object.values(config.dhParams)
  return dhValues.reduce(
    (transform, dh, index) => {
      const theta = jointsRad[index] * (dh.thetaSign ?? 1) + (dh.thetaOffset ?? 0)
      return transform.multiply(dhTransform(theta, dh.d, dh.a, dh.alpha))
    },
    Matrix4x4.identity(),
  )
}

/** 供 Vue 控制台使用的角度入口，避免页面重复处理单位转换。 */
export function forwardKinematicsDegrees(jointsDeg: JointAngles, config: RobotConfig): Matrix4x4 {
  const jointsRad = jointsDeg.map((angle) => (angle * Math.PI) / 180) as JointAngles
  return forwardKinematics(jointsRad, config)
}

export function extractPose(matrix: Matrix4x4): {
  position: [number, number, number]
  eulerZYX: [number, number, number]
} {
  const m = matrix.data
  const sy = -m[2][0]
  const cy = Math.sqrt(m[0][0] ** 2 + m[1][0] ** 2)

  let rx: number
  let rz: number
  const ry = Math.atan2(sy, cy)
  if (Math.abs(cy) > 1e-6) {
    rx = Math.atan2(m[2][1], m[2][2])
    rz = Math.atan2(m[1][0], m[0][0])
  } else {
    rx = Math.atan2(-m[1][2], m[1][1])
    rz = 0
  }

  return {
    position: [m[0][3], m[1][3], m[2][3]],
    eulerZYX: [rx, ry, rz],
  }
}

/** 从任意配置的 DH 正解生成页面展示位姿，作为场景模型加载前的回退。 */
export function poseFromJoints(joints: JointAngles, config: RobotConfig): PoseDisplay {
  const pose = extractPose(forwardKinematicsDegrees(joints, config))
  return {
    positionMm: pose.position,
    orientationDeg: pose.eulerZYX.map((value) => (value * 180) / Math.PI) as [number, number, number],
  }
}
