import { Matrix4x4 } from '@/robot-geometry/transform/transform-matrix.ts'
import type { JointAngles } from '@/robot-geometry/model/joint-pose.ts'
import type { RobotConfig } from '@/robot-geometry/transform/dh-types.ts'
import { ABB_IRB1200_5_90_STANDARD_DH } from '../parameters.ts'

/**
 * 标准 DH 齐次变换；与 KUKA 历史矩阵约定隔离，长度单位为毫米，角度使用弧度。
 */
export function standardDhTransform(theta: number, d: number, a: number, alpha: number): Matrix4x4 {
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
 * ABB 真实 tool0 法兰坐标系修正矩阵：绕法兰 Z 轴旋转 180°。
 * 项目 DH 链末端帧与 ABB/RPI 标定的 tool0 帧在 XY 平面相差 180°；
 * 该修正已用 RPI ARM 真实轨迹数据集验证（修正后 FK 姿态误差 < 1e-11 rad）。
 */
export const ABB_FLANGE_CORRECTION = new Matrix4x4([
  [-1, 0, 0, 0],
  [0, -1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
])

/**
 * 返回 ABB 候选 DH 链的各级坐标原点：基座/J1 轴前、J2 轴前……J6 轴前、机械法兰。
 * 所有 frame 均处于 ABB 机器人基座坐标（右手坐标、Z 轴向上），由基座单位矩阵开始累乘；
 * 不再预乘 ABB→Three.js 的显示旋转，也不乘入 FBX joint7 的视觉工具偏移。
 *
 * 末级机械法兰帧固定叠加 {@link ABB_FLANGE_CORRECTION}，与 ABB 真实 tool0 /
 * RPI 数据集坐标系一致；本模块对外不存在未修正的法兰帧。
 */
export function forwardAbbKinematicsFrames(
  jointsRad: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4[] {
  const dhValues = Object.values(config.dhParams)
  const frames = [Matrix4x4.identity()]
  let transform = frames[0]

  dhValues.forEach((dh, index) => {
    const theta = jointsRad[index] * (dh.thetaSign ?? 1) + (dh.thetaOffset ?? 0)
    transform = transform.multiply(standardDhTransform(theta, dh.d, dh.a, dh.alpha))
    frames.push(transform)
  })

  // 末级机械法兰帧对齐 ABB 真实 tool0 坐标系
  frames[frames.length - 1] = frames[frames.length - 1].multiply(ABB_FLANGE_CORRECTION)
  return frames
}

/** ABB 候选标准 DH 正解，返回第六轴机械法兰 frame（ABB 基座坐标，已对齐真实 tool0）。 */
export function forwardAbbKinematics(
  jointsRad: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4 {
  const frames = forwardAbbKinematicsFrames(jointsRad, config)
  return frames[frames.length - 1]
}

/** ABB 页面入口使用角度，适配器内部统一转换为弧度。 */
export function forwardAbbKinematicsDegrees(
  jointsDeg: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4 {
  const jointsRad = jointsDeg.map((angle) => (angle * Math.PI) / 180) as JointAngles
  return forwardAbbKinematics(jointsRad, config)
}

/** ABB 页面入口使用角度，返回可视化 DH 参考链的各级 frame（ABB 基座坐标）。 */
export function forwardAbbKinematicsFramesDegrees(
  jointsDeg: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4[] {
  const jointsRad = jointsDeg.map((angle) => (angle * Math.PI) / 180) as JointAngles
  return forwardAbbKinematicsFrames(jointsRad, config)
}
