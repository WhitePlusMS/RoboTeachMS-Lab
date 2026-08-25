/** 机器人核心关节与末端位姿类型；不依赖 Vue、Three.js 或具体厂家。 */
export type JointAngles = [number, number, number, number, number, number]

/** 面板展示的末端位姿；位置沿用机器人模型的毫米单位。 */
export interface PoseDisplay {
  positionMm: [number, number, number]
  orientationDeg: [number, number, number]
}

/** 逆解模型使用的位姿；旋转矩阵是唯一的姿态误差计算来源。 */
export interface Pose {
  position: [number, number, number]
  euler: [number, number, number]
  rotation: number[][]
}
