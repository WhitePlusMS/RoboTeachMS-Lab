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

/**
 * ABB robtarget 构型参数 [cf1, cf4, cf6, cfx]。
 * cf1/cf4/cf6 是 J1/J4/J6 所在象限（每 90° 一档，含负值）；
 * cfx 是 arm/elbow/wrist 三个二进制位的 0-7 十进制值。
 */
export type ABBConfiguration = [cf1: number, cf4: number, cf6: number, cfx: number]

/** 解析/几何逆解返回的单个构型候选；候选必须通过 FK 残差验收后才可执行。 */
export interface IKCandidate {
  joints: JointAngles
  positionErrorMm: number
  orientationErrorRad: number
  isLeastSquares: boolean
  isSingular: boolean
  /** 候选分支对应的 ABB 构型参数；不提供解析逆解的模型可省略。 */
  configuration?: ABBConfiguration
}

/** 机器人关节动画参数；速度单位为度/秒，时长单位为毫秒。 */
export interface MotionConfig {
  jointSpeedLimit: number
  ikAnimDuration: number
  snapThreshold: number
}

/** 六轴逆解关节锁定目标；null 表示该轴仍由逆解求解，数值单位为度。 */
export type IKLockedJointTargets = readonly [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
]

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
  /**
   * 位置优先模式下保留的姿态任务权重；0 表示完全位置优先，1 表示完整姿态权重。
   * 仅与显式 positionOnly 搭配使用，默认值不改变既有严格 IK 与纯 position-only 行为。
   */
  orientationWeight?: number
  /** 在迭代全过程固定指定关节；用于 LockAxis4，而不是在求解后破坏性改写关节结果。 */
  lockedJointTargetsDeg?: IKLockedJointTargets
  /**
   * 位置优先逆解的软连续性参考；仅在显式 positionOnly 时生效。
   * 与 lockedJointTargetsDeg 不同，该约束不会固定关节，只会在位置解存在冗余时
   * 优先靠近参考姿态。单位为度，权重为非负的数值正则化系数。
   */
  jointContinuityReferenceDeg?: JointAngles
  jointContinuityWeights?: readonly number[]
}

export type CoordinateSystem = 'World' | 'Tool'
export type CartesianAxis = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz'
