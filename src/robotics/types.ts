/** 机器人核心领域类型；不依赖 Vue、Three.js 或具体页面。 */
export interface DHParams {
  a: number
  alpha: number
  d: number
  thetaOffset?: number
  thetaSign?: 1 | -1
  thetaRange: readonly [number, number]
}

export interface RobotConfig {
  name: string
  dhParams: {
    joint1: DHParams
    joint2: DHParams
    joint3: DHParams
    joint4: DHParams
    joint5: DHParams
    joint6: DHParams
  }
  baseHeight: number
  linkColors: readonly string[]
}

/** 关节控制界面统一使用角度；DH 正解内部在入口处转换为弧度。 */
export type JointAngles = [number, number, number, number, number, number]

/** 面板展示的末端位姿；位置沿用机器人模型的毫米单位。 */
export interface PoseDisplay {
  positionMm: [number, number, number]
  orientationDeg: [number, number, number]
}

/** 逆解模型使用的位姿：旋转矩阵是唯一的姿态误差计算来源。 */
export interface Pose {
  position: [number, number, number]
  euler: [number, number, number]
  rotation: number[][]
}

/** 机器人关节动画参数；速度单位为度/秒，时长单位为毫秒。 */
export interface MotionConfig {
  jointSpeedLimit: number
  ikAnimDuration: number
  snapThreshold: number
}

export interface IKSolverConfig {
  maxIterations: number
  posTolerance: number
  oriTolerance: number
  damping: number
  lambdaDecay: number
  lambdaGrow: number
  maxLambda: number
  maxStepRad: number
  errorClampPos: number
  errorClampOri: number
  orientationScale: number
  /** SingArea\\Wrist 仅约束 TCP 位置，允许控制器在腕部奇异附近产生姿态误差。 */
  positionOnly?: boolean
}

export type CoordinateSystem = 'World' | 'Tool'
export type CartesianAxis = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz'
