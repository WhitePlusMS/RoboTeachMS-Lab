import { forwardAbbKinematicsFramesDegrees } from './forward-kinematics.ts'

/** 当前 FBX 的视觉映射；与几何模型分离，局部轴/偏置不进入 FK/IK。 */
export const IRB1200_VISUAL = {
  assetPath: 'models/ABB_IRB1200_5_90.fbx',
  scale: 0.01,
  baseNode: 'dizuo',
  jointNodes: ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'],
  flangeNode: 'joint6',
  toolNode: 'joint7',
  // FBX 局部轴与 ABB 关节正方向不同，只在显示映射中纠正。
  axes: [
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, -1],
    [1, 0, 0],
    [0, 0, -1],
    [0, -1, 0],
  ],
  offsetsDeg: [0, 0, 0, 0, -90, 0],
  forwardFrames: forwardAbbKinematicsFramesDegrees,
} as const
