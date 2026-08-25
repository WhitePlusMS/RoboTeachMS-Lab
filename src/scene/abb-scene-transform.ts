import { Matrix4x4 } from '@/robotics/kinematics/transform-matrix.ts'

/**
 * ABB 机器人基座坐标到 Three.js 场景世界坐标的固定显示旋转。
 * ABB/机器人机构坐标以 Z 为上方向，Three.js 场景以 Y 为上方向。
 * 这里不加入 dizuo 的支架高度，官方 DH 的基座原点仍是机器人安装面；
 * 支架高度由场景加载逻辑单独处理，不属于运动学真值。
 */
export const ABB_BASE_TO_SCENE = new Matrix4x4([
  [1, 0, 0, 0],
  [0, 0, 1, 0],
  [0, -1, 0, 0],
  [0, 0, 0, 1],
])

/**
 * FBX joint6 是机械法兰，joint7 是其后的夹具/TCP 节点。
 * joint7 在 joint6 局部 -Y 方向偏移 93.902208 mm，且 FBX 零位坐标轴为单位旋转；
 * 此固定变换仅在需要与 FBX joint7 对照或显示工具节点时组合，不参与六轴关节运动。
 */
export const ABB_FLANGE_TO_FBX_TOOL = new Matrix4x4([
  [1, 0, 0, 0],
  [0, 0, 1, 0],
  [0, -1, 0, 93.902208],
  [0, 0, 0, 1],
])

/** 把 ABB 基座 frame（Z 上）映射为 Three.js 显示 frame（Y 上）；纯函数，便于平面测试。 */
export function abbBaseFrameToSceneFrame(frame: Matrix4x4): Matrix4x4 {
  return ABB_BASE_TO_SCENE.multiply(frame)
}
