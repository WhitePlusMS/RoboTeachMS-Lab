import { extractPose, forwardKinematicsDegrees } from './kinematics'
import type { JointAngles, PoseDisplay, RobotConfig } from './types'

/** 数值 DLS 逆解配置；位置单位毫米，角度单位度。 */
export interface IKSolverConfig {
  maxIterations: number
  positionToleranceMm: number
  orientationToleranceDeg: number
  jacobianStepDeg: number
  maxJointStepDeg: number
  damping: number
  lambdaDecay: number
  lambdaGrow: number
  maxLambda: number
  orientationScale: number
}

export const DEFAULT_IK_CONFIG: IKSolverConfig = {
  maxIterations: 120,
  positionToleranceMm: 1,
  orientationToleranceDeg: 0.5,
  jacobianStepDeg: 0.25,
  maxJointStepDeg: 4,
  damping: 1,
  lambdaDecay: 0.7,
  lambdaGrow: 2,
  maxLambda: 100000,
  orientationScale: 20,
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function normalizeDegrees(value: number): number {
  let result = value % 360
  if (result > 180) result -= 360
  if (result < -180) result += 360
  return result
}

/** 从 DH 正解提取页面统一使用的毫米/度位姿。 */
export function poseFromJoints(joints: JointAngles, config: RobotConfig): PoseDisplay {
  const pose = extractPose(forwardKinematicsDegrees(joints, config))
  return {
    positionMm: pose.position,
    orientationDeg: pose.eulerZYX.map(toDegrees) as [number, number, number],
  }
}

function getJointRanges(config: RobotConfig): readonly (readonly [number, number])[] {
  return Object.values(config.dhParams).map((dh) => dh.thetaRange)
}

function clampJoints(joints: JointAngles, ranges: readonly (readonly [number, number])[]): JointAngles {
  return joints.map((value, index) => {
    const [min, max] = ranges[index]
    return Math.min(max, Math.max(min, value))
  }) as JointAngles
}

function isFinitePose(pose: PoseDisplay): boolean {
  return [...pose.positionMm, ...pose.orientationDeg].every(Number.isFinite)
}

function buildError(target: PoseDisplay, current: PoseDisplay, includeOrientation: boolean): number[] {
  const positionError = target.positionMm.map((value, index) => value - current.positionMm[index])
  if (!includeOrientation) return positionError
  const orientationError = target.orientationDeg.map((value, index) =>
    normalizeDegrees(value - current.orientationDeg[index]),
  )
  return [...positionError, ...orientationError]
}

function weightedError(error: readonly number[], orientationScale: number): number {
  return Math.hypot(
    ...error.map((value, index) => (index < 3 ? value : value * orientationScale)),
  )
}

function calculateJacobian(
  joints: JointAngles,
  config: RobotConfig,
  stepDeg: number,
  includeOrientation: boolean,
): number[][] {
  const rows = includeOrientation ? 6 : 3
  const jacobian = Array.from({ length: rows }, () => Array<number>(6).fill(0))

  for (let jointIndex = 0; jointIndex < 6; jointIndex += 1) {
    const plus = [...joints] as JointAngles
    const minus = [...joints] as JointAngles
    plus[jointIndex] += stepDeg
    minus[jointIndex] -= stepDeg
    const plusPose = poseFromJoints(plus, config)
    const minusPose = poseFromJoints(minus, config)
    const denominator = stepDeg * 2

    for (let axis = 0; axis < 3; axis += 1) {
      jacobian[axis][jointIndex] =
        (plusPose.positionMm[axis] - minusPose.positionMm[axis]) / denominator
    }
    if (includeOrientation) {
      for (let axis = 0; axis < 3; axis += 1) {
        jacobian[axis + 3][jointIndex] =
          normalizeDegrees(plusPose.orientationDeg[axis] - minusPose.orientationDeg[axis]) /
          denominator
      }
    }
  }

  return jacobian
}

/** 解小型方阵；失败时返回 null，避免把奇异矩阵传播到关节状态。 */
function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length
  const augmented = matrix.map((row, index) => [...row, vector[index]])

  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null
    ;[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]

    const pivotValue = augmented[column][column]
    for (let index = column; index <= size; index += 1) {
      augmented[column][index] /= pivotValue
    }

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = augmented[row][column]
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index]
      }
    }
  }

  return augmented.map((row) => row[size])
}

function maximumReach(config: RobotConfig): number {
  return Object.values(config.dhParams).reduce(
    (sum, dh) => sum + Math.abs(dh.a) + Math.abs(dh.d),
    Math.abs(config.baseHeight),
  )
}

function solveDls(
  target: PoseDisplay,
  initialJoints: JointAngles,
  config: RobotConfig,
  solverConfig: Partial<IKSolverConfig>,
  includeOrientation: boolean,
): JointAngles | null {
  const cfg = { ...DEFAULT_IK_CONFIG, ...solverConfig }
  if (!isFinitePose(target)) return null
  if (Math.hypot(...target.positionMm) > maximumReach(config) + 200) return null

  const ranges = getJointRanges(config)
  let joints = clampJoints([...initialJoints] as JointAngles, ranges)
  let lambda = cfg.damping

  for (let iteration = 0; iteration < cfg.maxIterations; iteration += 1) {
    const current = poseFromJoints(joints, config)
    const error = buildError(target, current, includeOrientation)
    const positionNorm = Math.hypot(error[0], error[1], error[2])
    const orientationNorm = includeOrientation ? Math.hypot(error[3], error[4], error[5]) : 0
    if (
      positionNorm <= cfg.positionToleranceMm &&
      orientationNorm <= cfg.orientationToleranceDeg
    ) {
      return joints
    }

    const jacobian = calculateJacobian(
      joints,
      config,
      cfg.jacobianStepDeg,
      includeOrientation,
    )
    const scaledError = error.map((value, index) =>
      index < 3 ? value : value * cfg.orientationScale,
    )
    const normal = Array.from({ length: 6 }, () => Array<number>(6).fill(0))
    const rhs = Array<number>(6).fill(0)

    for (let row = 0; row < jacobian.length; row += 1) {
      const rowScale = includeOrientation && row >= 3 ? cfg.orientationScale : 1
      const scaledRow = jacobian[row].map((value) => value * rowScale)
      for (let column = 0; column < 6; column += 1) {
        rhs[column] += scaledRow[column] * scaledError[row]
        for (let other = 0; other < 6; other += 1) {
          normal[column][other] += scaledRow[column] * scaledRow[other]
        }
      }
    }
    for (let index = 0; index < 6; index += 1) normal[index][index] += lambda

    const delta = solveLinearSystem(normal, rhs)
    if (!delta || delta.some((value) => !Number.isFinite(value))) return null
    const candidate = clampJoints(
      joints.map((value, index) =>
        value + Math.max(-cfg.maxJointStepDeg, Math.min(cfg.maxJointStepDeg, delta[index])),
      ) as JointAngles,
      ranges,
    )
    const candidateError = weightedError(
      buildError(target, poseFromJoints(candidate, config), includeOrientation),
      cfg.orientationScale,
    )
    const currentError = weightedError(error, cfg.orientationScale)

    if (candidateError < currentError) {
      joints = candidate
      lambda = Math.max(lambda * cfg.lambdaDecay, 1e-6)
    } else {
      lambda *= cfg.lambdaGrow
    }
    if (lambda > cfg.maxLambda) return null
  }

  return null
}

/** 六维位姿逆解；失败返回 null，调用方必须保留最近一次有效关节状态。 */
export function solveIK(
  target: PoseDisplay,
  initialJoints: JointAngles,
  config: RobotConfig,
  solverConfig: Partial<IKSolverConfig> = {},
): JointAngles | null {
  return solveDls(target, initialJoints, config, solverConfig, true)
}

/** 仅位置逆解，供姿态约束过紧时的平移控制回退使用。 */
export function solvePositionOnlyIK(
  targetPositionMm: [number, number, number],
  initialJoints: JointAngles,
  config: RobotConfig,
  solverConfig: Partial<IKSolverConfig> = {},
): JointAngles | null {
  const current = poseFromJoints(initialJoints, config)
  return solveDls(
    { positionMm: targetPositionMm, orientationDeg: current.orientationDeg },
    initialJoints,
    config,
    solverConfig,
    false,
  )
}
