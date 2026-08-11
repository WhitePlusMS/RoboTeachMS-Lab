import { Matrix4x4 } from '../../robotics/matrix4x4.ts'
import type { JointAngles, RobotConfig } from '../../robotics/types.ts'
import { ABB_IRB1200_5_90_STANDARD_DH } from './robot-config.ts'

/**
 * 标准 DH 齐次变换；与 KUKA 历史矩阵约定隔离，长度单位为毫米，角度使用弧度。
 */
export function standardDhTransform(
  theta: number,
  d: number,
  a: number,
  alpha: number,
): Matrix4x4 {
  const cosTheta = Math.cos(theta)
  const sinTheta = Math.sin(theta)
  const cosAlpha = Math.cos(alpha)
  const sinAlpha = Math.sin(alpha)

  return new Matrix4x4([
    [cosTheta, -sinTheta * cosAlpha, sinTheta * sinAlpha, a * cosTheta],
    [sinTheta, cosTheta * cosAlpha, -cosTheta * sinAlpha, a * sinTheta],
    [0, sinAlpha, cosAlpha, d],
    [0, 0, 0, 1],
  ])
}

/**
 * 候选 ABB DH 基座坐标到项目 Three.js 世界坐标的固定旋转。
 * ABB/ROS 机构坐标以 Z 为上方向，项目场景以 Y 为上方向。
 * 这里不加入 dizuo 的支架高度，官方 DH 的基座原点仍是机器人安装面。
 */
export const ABB_DH_BASE_TO_SCENE = new Matrix4x4([
  [1, 0, 0, 0],
  [0, 0, 1, 0],
  [0, -1, 0, 0],
  [0, 0, 0, 1],
])

/**
 * FBX joint6 是机械法兰，joint7 是其后夹具/TCP 节点。
 * joint7 在 joint6 局部 -Y 方向偏移 93.902208 mm，且 FBX 零位坐标轴为单位旋转；
 * 此固定变换同时把标准 DH frame6 的坐标轴转换到 FBX tool 坐标，不参与六轴关节运动。
 */
export const ABB_FLANGE_TO_TOOL = new Matrix4x4([
  [1, 0, 0, 0],
  [0, 0, 1, 0],
  [0, -1, 0, 93.902208],
  [0, 0, 0, 1],
])

/**
 * 返回 ABB 候选 DH 链的各级坐标原点：基座/J1 轴前、J2 轴前……J6 轴前、法兰。
 * 每个矩阵已经转换到项目 Three.js 世界坐标，位置单位仍为毫米。
 */
export function forwardAbbKinematicsFrames(
  jointsRad: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4[] {
  const dhValues = Object.values(config.dhParams)
  const frames = [ABB_DH_BASE_TO_SCENE.multiply(Matrix4x4.identity())]
  let transform = frames[0]

  dhValues.forEach((dh, index) => {
    const theta = jointsRad[index] * (dh.thetaSign ?? 1) + (dh.thetaOffset ?? 0)
    transform = transform.multiply(standardDhTransform(theta, dh.d, dh.a, dh.alpha))
    frames.push(transform)
  })

  return frames
}

/** ABB 候选标准 DH 正解，输出 FBX joint7 对应的工具/TCP；不调用 KUKA 历史 kinematics.ts。 */
export function forwardAbbKinematics(
  jointsRad: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4 {
  const frames = forwardAbbKinematicsFrames(jointsRad, config)
  return frames[frames.length - 1].multiply(ABB_FLANGE_TO_TOOL)
}

/** ABB 页面入口使用角度，适配器内部统一转换为弧度。 */
export function forwardAbbKinematicsDegrees(
  jointsDeg: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4 {
  const jointsRad = jointsDeg.map((angle) => (angle * Math.PI) / 180) as JointAngles
  return forwardAbbKinematics(jointsRad, config)
}

/** ABB 页面入口使用角度，返回可视化 DH 参考链的各级 frame。 */
export function forwardAbbKinematicsFramesDegrees(
  jointsDeg: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4[] {
  const jointsRad = jointsDeg.map((angle) => (angle * Math.PI) / 180) as JointAngles
  return forwardAbbKinematicsFrames(jointsRad, config)
}
