import { Matrix, solve } from 'ml-matrix'
import { clampDegStep, clampVectorMagnitude } from './math/vector'
import { radToDeg } from './math/angle'
import { orientationError } from './math/rotation3d'
import type { RobotModel } from './robot-model'
import type { IKSolverConfig, JointAngles, Pose } from './types'

/** 原项目使用的 Levenberg-Marquardt 阻尼最小二乘配置。 */
export const DEFAULT_IK_CONFIG: IKSolverConfig = {
  maxIterations: 100,
  tolerance: 1e-3,
  posTolerance: 1,
  oriTolerance: 0.01,
  damping: 0.1,
  lambdaDecay: 0.7,
  lambdaGrow: 2,
  maxLambda: 1000,
  maxStepRad: 0.1,
  errorClampPos: 500,
  errorClampOri: 0.5,
  orientationScale: 100,
}

export function isReachable(
  targetPos: [number, number, number],
  model: RobotModel,
  margin = 50,
): boolean {
  if (!model.isAvailable()) return true
  const seeds: JointAngles[] = [
    [0, 0, 0, 0, 0, 0],
    [0, -30, 60, 0, 0, 0],
    [0, -45, 90, 0, 0, 0],
    [90, -30, 60, 0, 0, 0],
    [-90, -30, 60, 0, 0, 0],
  ]
  let maxReach = 0
  for (const seed of seeds) {
    const pose = model.forwardKinematics(seed)
    if (pose) maxReach = Math.max(maxReach, Math.hypot(...pose.position))
  }
  return Math.hypot(...targetPos) <= maxReach + margin
}

function clampJoints(
  joints: JointAngles,
  ranges: readonly (readonly [number, number])[] | undefined,
): JointAngles {
  if (!ranges) return joints
  return joints.map((value, index) => {
    const [min, max] = ranges[index]
    return Math.max(min, Math.min(max, value))
  }) as JointAngles
}

/** 完整复制原项目的 6D 位姿 IK 入口。 */
export function solveIK(
  targetPose: Pose,
  initialJointsDeg: JointAngles,
  model: RobotModel,
  solverConfig: Partial<IKSolverConfig> = {},
  jointRanges?: readonly (readonly [number, number])[],
): JointAngles | null {
  if (!model.isAvailable()) return null

  const cfg = { ...DEFAULT_IK_CONFIG, ...solverConfig }
  const joints = clampJoints([...initialJointsDeg] as JointAngles, jointRanges)
  let lambda = cfg.damping
  const targetRotation = targetPose.rotation

  for (let iter = 0; iter < cfg.maxIterations; iter += 1) {
    const currentPose = model.forwardKinematics(joints)
    if (!currentPose) return null

    let ePos = [
      targetPose.position[0] - currentPose.position[0],
      targetPose.position[1] - currentPose.position[1],
      targetPose.position[2] - currentPose.position[2],
    ]
    ePos = clampVectorMagnitude(ePos, cfg.errorClampPos)

    const eOriRaw = orientationError(targetRotation, currentPose.rotation)
    const eOri = clampVectorMagnitude(eOriRaw, cfg.errorClampOri)
    const posNorm = Math.hypot(
      targetPose.position[0] - currentPose.position[0],
      targetPose.position[1] - currentPose.position[1],
      targetPose.position[2] - currentPose.position[2],
    )
    const oriNorm = Math.hypot(...eOriRaw)

    if (posNorm < cfg.posTolerance && oriNorm < cfg.oriTolerance) return joints

    const jacobian = model.estimateJacobian(joints)
    if (!jacobian) return null
    const jacobianRows = jacobian.map((row, rowIndex) =>
      row.map((value) => (rowIndex >= 3 ? value * cfg.orientationScale : value)),
    )
    const matrix = new Matrix(jacobianRows)
    const transpose = matrix.transpose()
    const errorVector = Matrix.columnVector([
      ...ePos,
      eOri[0] * cfg.orientationScale,
      eOri[1] * cfg.orientationScale,
      eOri[2] * cfg.orientationScale,
    ])
    const lhs = transpose.mmul(matrix).add(Matrix.eye(6).mul(lambda))
    const rhs = transpose.mmul(errorVector)
    let delta = solve(lhs, rhs, true).to1DArray()
    delta = clampDegStep(delta, radToDeg(cfg.maxStepRad))

    const candidate = clampJoints(
      joints.map((value, index) => value + delta[index]) as JointAngles,
      jointRanges,
    )
    const candidatePose = model.forwardKinematics(candidate)
    if (!candidatePose) return null

    const positionError = [
      targetPose.position[0] - candidatePose.position[0],
      targetPose.position[1] - candidatePose.position[1],
      targetPose.position[2] - candidatePose.position[2],
    ]
    const candidatePositionError = clampVectorMagnitude(positionError, cfg.errorClampPos)
    const candidateOrientationRaw = orientationError(targetRotation, candidatePose.rotation)
    const candidateOrientation = clampVectorMagnitude(candidateOrientationRaw, cfg.errorClampOri)
    const errorNorm = Math.hypot(
      ...ePos,
      eOri[0] * cfg.orientationScale,
      eOri[1] * cfg.orientationScale,
      eOri[2] * cfg.orientationScale,
    )
    const candidateErrorNorm = Math.hypot(
      ...candidatePositionError,
      candidateOrientation[0] * cfg.orientationScale,
      candidateOrientation[1] * cfg.orientationScale,
      candidateOrientation[2] * cfg.orientationScale,
    )

    if (candidateErrorNorm < errorNorm) {
      for (let index = 0; index < 6; index += 1) joints[index] = candidate[index]
      lambda = Math.max(lambda * cfg.lambdaDecay, 1e-6)
    } else {
      lambda *= cfg.lambdaGrow
    }
    if (lambda > cfg.maxLambda) return null
  }
  return null
}

/** 原项目的 3-DOF 位置-only IK 回退。 */
export function solvePositionOnlyIK(
  targetPos: [number, number, number],
  initialJointsDeg: JointAngles,
  model: RobotModel,
  solverConfig: Partial<IKSolverConfig> = {},
  jointRanges?: readonly (readonly [number, number])[],
): JointAngles | null {
  if (!model.isAvailable()) return null

  const cfg = { ...DEFAULT_IK_CONFIG, ...solverConfig }
  const joints = clampJoints([...initialJointsDeg] as JointAngles, jointRanges)
  let lambda = cfg.damping

  for (let iter = 0; iter < cfg.maxIterations; iter += 1) {
    const currentPose = model.forwardKinematics(joints)
    if (!currentPose) return null
    let error = [
      targetPos[0] - currentPose.position[0],
      targetPos[1] - currentPose.position[1],
      targetPos[2] - currentPose.position[2],
    ]
    error = clampVectorMagnitude(error, cfg.errorClampPos)
    const errorNorm = Math.hypot(...error)
    if (errorNorm < cfg.posTolerance) return joints

    const fullJacobian = model.estimateJacobian(joints)
    if (!fullJacobian) return null
    const matrix = new Matrix([fullJacobian[0], fullJacobian[1], fullJacobian[2]])
    const transpose = matrix.transpose()
    const lhs = transpose.mmul(matrix).add(Matrix.eye(6).mul(lambda))
    const rhs = transpose.mmul(Matrix.columnVector(error))
    let delta = solve(lhs, rhs, true).to1DArray()
    delta = clampDegStep(delta, radToDeg(cfg.maxStepRad))
    const candidate = clampJoints(
      joints.map((value, index) => value + delta[index]) as JointAngles,
      jointRanges,
    )
    const candidatePose = model.forwardKinematics(candidate)
    if (!candidatePose) return null
    const candidateError = clampVectorMagnitude([
      targetPos[0] - candidatePose.position[0],
      targetPos[1] - candidatePose.position[1],
      targetPos[2] - candidatePose.position[2],
    ], cfg.errorClampPos)
    const candidateNorm = Math.hypot(...candidateError)
    if (candidateNorm < errorNorm) {
      for (let index = 0; index < 6; index += 1) joints[index] = candidate[index]
      lambda = Math.max(lambda * cfg.lambdaDecay, 1e-6)
    } else {
      lambda *= cfg.lambdaGrow
    }
    if (lambda > cfg.maxLambda) return null
  }
  return null
}
