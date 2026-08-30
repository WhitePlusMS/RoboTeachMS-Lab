import type { JointAngles } from '../model/joint-pose.ts'

/** 型号适配器提供的构型标签；具体字段语义由机器人型号模块拥有。 */
export type RobotConfiguration = readonly number[]

/** 解析/几何逆解返回的单个构型候选。 */
export interface IKCandidate {
  joints: JointAngles
  positionErrorMm: number
  orientationErrorRad: number
  isLeastSquares: boolean
  isSingular: boolean
  configuration?: RobotConfiguration
}

/** 六轴逆解关节锁定目标；null 表示该轴仍由逆解求解。 */
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
  positionOnly?: boolean
  orientationWeight?: number
  lockedJointTargetsDeg?: IKLockedJointTargets
  jointContinuityReferenceDeg?: JointAngles
  jointContinuityWeights?: readonly number[]
  /** 是否要求解析候选保持参考关节的型号构型；默认 true，显式重放外部轨迹时可关闭。 */
  preserveConfiguration?: boolean
}
