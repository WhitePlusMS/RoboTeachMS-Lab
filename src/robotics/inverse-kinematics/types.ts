import type { JointAngles } from '../model/joint-pose.ts'

/** ABB robtarget 构型参数 [cf1, cf4, cf6, cfx]。 */
export type ABBConfiguration = [cf1: number, cf4: number, cf6: number, cfx: number]

/** 解析/几何逆解返回的单个构型候选。 */
export interface IKCandidate {
  joints: JointAngles
  positionErrorMm: number
  orientationErrorRad: number
  isLeastSquares: boolean
  isSingular: boolean
  configuration?: ABBConfiguration
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
}
