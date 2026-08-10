import { Matrix4x4 } from '../../core/robot/matrix4x4'
import type { JointAngles, RobotConfig } from '../../core/robot/types'
import { ABB_IRB1200_5_90_STANDARD_DH } from './robot-config'

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

/** 当前项目把 joint7 作为法兰坐标；暂不叠加未经验证的 ROS tool0 固定旋转。 */
export const ABB_FLANGE_TO_TOOL = Matrix4x4.identity()

/** ABB 候选标准 DH 正解；不调用 KUKA 历史 kinematics.ts。 */
export function forwardAbbKinematics(
  jointsRad: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4 {
  const dhValues = Object.values(config.dhParams)
  return dhValues.reduce(
    (transform, dh, index) => {
      const theta = jointsRad[index] * (dh.thetaSign ?? 1) + (dh.thetaOffset ?? 0)
      return transform.multiply(standardDhTransform(theta, dh.d, dh.a, dh.alpha))
    },
    ABB_DH_BASE_TO_SCENE.multiply(Matrix4x4.identity()),
  ).multiply(ABB_FLANGE_TO_TOOL)
}

/** ABB 页面入口使用角度，适配器内部统一转换为弧度。 */
export function forwardAbbKinematicsDegrees(
  jointsDeg: JointAngles,
  config: RobotConfig = ABB_IRB1200_5_90_STANDARD_DH,
): Matrix4x4 {
  const jointsRad = jointsDeg.map((angle) => (angle * Math.PI) / 180) as JointAngles
  return forwardAbbKinematics(jointsRad, config)
}
