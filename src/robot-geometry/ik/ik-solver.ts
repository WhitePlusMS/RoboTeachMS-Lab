import { Matrix, solve } from 'ml-matrix'
import { clampDegStep, clampVectorMagnitude } from '@/robot-geometry/math/vector.ts'
import { radToDeg } from '@/robot-geometry/math/angle.ts'
import { orientationError } from '@/robot-geometry/math/rotation3d.ts'
import { buildIKCandidateCatalog, selectBestIKCandidate } from './candidate-catalog.ts'
import type { RobotModel } from '../robot-types.ts'
import type { JointAngles, Pose } from '../robot-types.ts'
import type { IKLockedJointTargets, IKSolverConfig } from './ik-types.ts'

/** 原项目使用的 Levenberg-Marquardt 阻尼最小二乘配置。 */
export const DEFAULT_IK_CONFIG: IKSolverConfig = {
  maxIterations: 100,
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

/** 在 FK、Jacobian 和候选验收前统一恢复锁定关节，保证约束贯穿整个数值迭代。 */
function enforceLockedJoints(
  joints: JointAngles,
  lockedTargets: IKLockedJointTargets | undefined,
): JointAngles {
  if (!lockedTargets) return joints
  return joints.map((value, index) => lockedTargets[index] ?? value) as JointAngles
}

function solveAnalyticCandidate(
  targetPose: Pose,
  initialJointsDeg: JointAngles,
  model: RobotModel,
  solverConfig: IKSolverConfig,
  jointRanges: readonly (readonly [number, number])[] | undefined,
  preserveConfiguration = true,
): JointAngles | null | undefined {
  if (!model.solveAllIK || solverConfig.positionOnly || solverConfig.lockedJointTargetsDeg) {
    return undefined
  }
  const candidates = buildIKCandidateCatalog(targetPose, initialJointsDeg, model, jointRanges)
  const best = selectBestIKCandidate(candidates, {
    positionTolerance: solverConfig.posTolerance,
    orientationTolerance: solverConfig.oriTolerance,
    referenceConfiguration: preserveConfiguration
      ? (model.deriveConfiguration?.(initialJointsDeg) ?? undefined)
      : undefined,
  })
  return best?.normalizedJoints ?? null
}

/**
 * 在位置优先 IK 的冗余自由度中加入软关节连续性目标。
 *
 * 位置 Jacobian 只有 3 行，腕部奇异附近存在多个同样有效的关节解；仅靠阻尼项
 * 会让数值求解器自行选择 J4/J6 分配。该正则项把“靠近上一 waypoint”加入同一个
 * 正规方程，但不会像 lockedJointTargetsDeg 那样把关节硬锁死，也不会改变位置误差。
 */
function applyJointContinuityPenalty(
  lhs: Matrix,
  rhs: Matrix,
  joints: JointAngles,
  reference: JointAngles | undefined,
  weights: readonly number[] | undefined,
  lockedTargets: IKLockedJointTargets | undefined,
): void {
  if (!reference || !weights) return
  for (let index = 0; index < joints.length; index += 1) {
    const weight = weights[index]
    if (
      !Number.isFinite(weight) ||
      weight <= 0 ||
      !Number.isFinite(reference[index]) ||
      (lockedTargets?.[index] !== null && lockedTargets?.[index] !== undefined)
    ) {
      continue
    }
    lhs.set(index, index, lhs.get(index, index) + weight)
    rhs.set(index, 0, rhs.get(index, 0) + weight * (reference[index] - joints[index]))
  }
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
  const analytic = solveAnalyticCandidate(
    targetPose,
    initialJointsDeg,
    model,
    cfg,
    jointRanges,
    cfg.preserveConfiguration !== false,
  )
  if (analytic !== undefined) {
    // 解析法可用时直接返回其结论；失败时不自行切换到数值法，避免 ABB 等
    // 可解析模型在奇异/限位附近被 DLS 拉到错误构型分支。
    return analytic
  }
  const joints = clampJoints(
    enforceLockedJoints([...initialJointsDeg] as JointAngles, cfg.lockedJointTargetsDeg),
    jointRanges,
  )
  let lambda = cfg.damping
  const targetRotation = targetPose.rotation
  const orientationWeight =
    cfg.positionOnly === true ? Math.max(0, Math.min(1, cfg.orientationWeight ?? 0)) : 1

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
    const orientationSatisfied =
      (cfg.positionOnly === true && orientationWeight === 0) || oriNorm < cfg.oriTolerance

    if (posNorm < cfg.posTolerance && orientationSatisfied) {
      return joints
    }

    const jacobian = model.estimateJacobian(joints)
    if (!jacobian) return null
    const jacobianRows = jacobian.map((row, rowIndex) =>
      row.map((value, jointIndex) =>
        cfg.lockedJointTargetsDeg?.[jointIndex] !== null &&
        cfg.lockedJointTargetsDeg?.[jointIndex] !== undefined
          ? 0
          : rowIndex < 3
            ? value
            : cfg.positionOnly === true
              ? value * cfg.orientationScale * orientationWeight
              : value * cfg.orientationScale,
      ),
    )
    const matrix = new Matrix(jacobianRows)
    const transpose = matrix.transpose()
    const errorVector = Matrix.columnVector([
      ...ePos,
      cfg.positionOnly === true
        ? eOri[0] * cfg.orientationScale * orientationWeight
        : eOri[0] * cfg.orientationScale,
      cfg.positionOnly === true
        ? eOri[1] * cfg.orientationScale * orientationWeight
        : eOri[1] * cfg.orientationScale,
      cfg.positionOnly === true
        ? eOri[2] * cfg.orientationScale * orientationWeight
        : eOri[2] * cfg.orientationScale,
    ])
    const lhs = transpose.mmul(matrix).add(Matrix.eye(6).mul(lambda))
    const rhs = transpose.mmul(errorVector)
    // 仅由调用方显式传入的 position-only wrist 回退会启用该软目标；严格 6D IK
    // 不设置 reference，因此不会改变普通工作区的解析分支选择。
    applyJointContinuityPenalty(
      lhs,
      rhs,
      joints,
      cfg.jointContinuityReferenceDeg,
      cfg.jointContinuityWeights,
      cfg.lockedJointTargetsDeg,
    )
    let delta = solve(lhs, rhs, true).to1DArray()
    delta = clampDegStep(delta, radToDeg(cfg.maxStepRad))

    const candidate = clampJoints(
      enforceLockedJoints(
        joints.map((value, index) => value + delta[index]) as JointAngles,
        cfg.lockedJointTargetsDeg,
      ),
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
      cfg.positionOnly === true ? 0 : eOri[0] * cfg.orientationScale,
      cfg.positionOnly === true ? 0 : eOri[1] * cfg.orientationScale,
      cfg.positionOnly === true ? 0 : eOri[2] * cfg.orientationScale,
    )
    const candidateErrorNorm = Math.hypot(
      ...candidatePositionError,
      cfg.positionOnly === true
        ? candidateOrientation[0] * cfg.orientationScale * orientationWeight
        : candidateOrientation[0] * cfg.orientationScale,
      cfg.positionOnly === true
        ? candidateOrientation[1] * cfg.orientationScale * orientationWeight
        : candidateOrientation[1] * cfg.orientationScale,
      cfg.positionOnly === true
        ? candidateOrientation[2] * cfg.orientationScale * orientationWeight
        : candidateOrientation[2] * cfg.orientationScale,
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
