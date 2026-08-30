import { rotationDistanceRad, mat3Mul } from '@/robot-geometry/math/rotation3d.ts'
import type { JointAngles, Pose } from '@/robot-geometry/model/joint-pose.ts'
import type { IKCandidate } from '@/robot-geometry/numerical-ik/types.ts'
import { ABB_FLANGE_CORRECTION, forwardAbbKinematicsFramesDegrees } from './forward-kinematics.ts'
import { ABB_IRB1200_5_90_STANDARD_DH, ABB_WRIST_SINGULARITY_THRESHOLD_DEG } from '../parameters.ts'
import { abbConfigurationFromBranch, abbQuadrant, type ABBConfiguration } from './configuration.ts'

/** ABB IRB1200 候选 DH 链的几何解析逆解。
 *
 * 该实现采用 IK-Geo 的 spherical + two-parallel-axes 分解思想：前三轴先求腕心，
 * 后三轴再从 R36 求球腕分支。它只负责生成完整 6D 位姿候选，不负责选择构型；
 * 连续性、限位和 J4 偏好由上层统一处理。
 */

type Vector3 = [number, number, number]
type Rotation3 = [Vector3, Vector3, Vector3]

const EPSILON = 1e-8
const POSITION_EPSILON_MM = 1e-5
const ORIENTATION_EPSILON_RAD = 1e-8

/** 解析几何只从运行时 DH profile 读取，避免 FK 与 IK 各自维护一套长度常量。 */
const ABB_DH = ABB_IRB1200_5_90_STANDARD_DH.dhParams
const D1_MM = ABB_DH.joint1.d
const A2_MM = ABB_DH.joint2.a
const A3_MM = ABB_DH.joint3.a
const D4_MM = ABB_DH.joint4.d
const D6_MM = ABB_DH.joint6.d
const L3_MM = Math.hypot(A3_MM, D4_MM)
const L3_PHASE_RAD = Math.atan2(D4_MM, A3_MM)
const WRIST_SINGULAR_SINE_THRESHOLD = Math.sin(
  (ABB_WRIST_SINGULARITY_THRESHOLD_DEG * Math.PI) / 180,
)

function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(value: Vector3, factor: number): Vector3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function transpose(rotation: Rotation3): Rotation3 {
  return [
    [rotation[0][0], rotation[1][0], rotation[2][0]],
    [rotation[0][1], rotation[1][1], rotation[2][1]],
    [rotation[0][2], rotation[1][2], rotation[2][2]],
  ]
}

function multiplyRotation3(a: Rotation3, b: Rotation3): Rotation3 {
  return a.map((row) =>
    b[0].map((_, column) => row[0] * b[0][column] + row[1] * b[1][column] + row[2] * b[2][column]),
  ) as Rotation3
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

function wrapRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value))
}

function angleDistance(a: number, b: number): number {
  return Math.abs(wrapRadians(a - b))
}

function uniqueAngles(values: readonly number[]): number[] {
  const unique: number[] = []
  for (const value of values) {
    const wrapped = wrapRadians(value)
    if (!unique.some((other) => angleDistance(other, wrapped) < 1e-7)) unique.push(wrapped)
  }
  return unique
}

function getRotation(pose: Pose): Rotation3 {
  return pose.rotation as Rotation3
}

interface PlanarBranch {
  joints: JointAngles
  elbowBit: 0 | 1
}

function solvePlanarBranches(q1: number, wrist: Vector3): PlanarBranch[] {
  const radial = Math.cos(q1) * wrist[0] + Math.sin(q1) * wrist[1]
  const vertical = wrist[2] - D1_MM
  const distance = Math.hypot(radial, vertical)
  if (distance < EPSILON) return []

  const cosine = clampUnit(
    (A2_MM * A2_MM + distance * distance - L3_MM * L3_MM) / (2 * A2_MM * distance),
  )
  const elbowAngle = Math.acos(cosine)
  const targetAngle = Math.atan2(radial, vertical)
  const branches: PlanarBranch[] = []

  for (const [index, sign] of ([1, -1] as const).entries()) {
    // DH 链的向量形式是 (r,z)=(L sin(q),L cos(q))，所以目标夹角直接对应 q2。
    const q2 = targetAngle + sign * elbowAngle
    const remainingRadial = radial - A2_MM * Math.sin(q2)
    const remainingVertical = vertical - A2_MM * Math.cos(q2)
    const wristPlanarAngle = Math.atan2(remainingRadial, remainingVertical)
    const q3 = wristPlanarAngle - q2 - L3_PHASE_RAD
    // 第一个分支（+elbowAngle）对应 elbow up(0)，第二个对应 elbow down(1)。
    branches.push({ joints: [q1, q2, q3, 0, 0, 0], elbowBit: index as 0 | 1 })
  }
  return branches
}

interface WristBranch {
  joints: JointAngles
  wristBit: 0 | 1
}

function solveWristBranches(
  targetRotation: Rotation3,
  q123: JointAngles,
  referenceJoints: JointAngles | undefined,
): WristBranch[] {
  const frames = forwardAbbKinematicsFramesDegrees(
    q123.map((value, index) => (index < 3 ? (value * 180) / Math.PI : 0)) as JointAngles,
  )
  const r03 = frames[3].getRotation() as Rotation3
  const r36 = multiplyRotation3(transpose(r03), targetRotation)
  const cosine5 = clampUnit(r36[2][2])
  const sineMagnitude5 = Math.sqrt(Math.max(0, 1 - cosine5 * cosine5))
  const branches: WristBranch[] = []
  const q4Reference = referenceJoints ? (referenceJoints[3] * Math.PI) / 180 : 0

  if (sineMagnitude5 <= EPSILON) {
    // 腕部奇异时 J4/J6 只确定和（q5≈0）或差（q5≈pi）。选择离参考姿态最近
    // 的 J4，再由目标 R36 反算另一轴；不丢弃姿态，也不擅自固定 J4=0。
    // 奇异时 no-flip/flip 已无几何区分，约定 q4 取参考值的记 no-flip(0)，
    // q4 取参考值 + π 的记 flip(1)，保证同一参考下的构型标签确定。
    if (cosine5 >= 0) {
      const qSum = Math.atan2(r36[1][0], r36[0][0])
      for (const [index, q4] of [q4Reference, q4Reference + Math.PI].entries()) {
        branches.push({
          joints: [q123[0], q123[1], q123[2], q4, 0, qSum - q4],
          wristBit: index as 0 | 1,
        })
      }
    } else {
      const qDifference = Math.atan2(-r36[1][0], -r36[0][0])
      for (const [index, q4] of [q4Reference, q4Reference + Math.PI].entries()) {
        branches.push({
          joints: [q123[0], q123[1], q123[2], q4, Math.PI, q4 - qDifference],
          wristBit: index as 0 | 1,
        })
      }
    }
    return branches
  }

  // q4/q6 的分子同时含有 sin(q5)，除以一个接近零的数不会提供额外信息，
  // 只会放大浮点噪声。直接把同一比例的分子交给 atan2，保留腕部等价分支的
  // 符号关系，再由上层按参考关节选择连续表示。
  const q4PositiveSine = Math.atan2(-r36[1][2], -r36[0][2])
  const q6PositiveSine = Math.atan2(-r36[2][1], r36[2][0])
  for (const sine5 of [sineMagnitude5, -sineMagnitude5]) {
    const branchSign = sine5 >= 0 ? 1 : -1
    const q4 = branchSign > 0 ? q4PositiveSine : q4PositiveSine + Math.PI
    const q5 = Math.atan2(sine5, cosine5)
    const q6 = branchSign > 0 ? q6PositiveSine : q6PositiveSine + Math.PI
    // sin(q5) 符号即 ABB wrist no-flip(0)/flip(1) 位。
    branches.push({
      joints: [q123[0], q123[1], q123[2], q4, q5, q6],
      wristBit: sine5 >= 0 ? 0 : 1,
    })
  }

  if (sineMagnitude5 <= WRIST_SINGULAR_SINE_THRESHOLD) {
    // J5 接近零时，姿态主要只决定 q4+q6。补充以参考 J4 为中心的耦合候选，
    // 供局部 SingArea\Wrist 选择使用；严格姿态仍由上面的精确分支优先验收。
    const qSum =
      cosine5 >= 0 ? Math.atan2(r36[1][0], r36[0][0]) : Math.atan2(-r36[1][0], -r36[0][0])
    const q5Positive = Math.atan2(sineMagnitude5, cosine5)
    branches.push(
      {
        joints: [q123[0], q123[1], q123[2], q4Reference, q5Positive, qSum - q4Reference],
        wristBit: 0,
      },
      {
        joints: [
          q123[0],
          q123[1],
          q123[2],
          q4Reference + Math.PI,
          -q5Positive,
          qSum - q4Reference - Math.PI,
        ],
        wristBit: 1,
      },
    )
  }
  return branches
}

/**
 * 将用户侧（已对齐 ABB tool0）的目标位姿转换回解析几何使用的原始 DH 链末帧。
 * 纯旋转修正，不影响腕心位置计算。
 */
function toUncorrectedTargetPose(targetPose: Pose): Pose {
  // R_corrected = R_raw · C，且 C=Rz(180°) 满足 C⁻¹=C，所以原始 DH 帧为 R_corrected·C。
  const rotationUncorrected = mat3Mul(getRotation(targetPose), ABB_FLANGE_CORRECTION.getRotation())
  return {
    ...targetPose,
    rotation: rotationUncorrected,
  }
}

/**
 * 残差在用户侧（已对齐 ABB tool0）坐标系中计算：公共 FK 输出的就是修正后法兰帧。
 * 右乘同一修正矩阵不改变旋转距离，结果与在原始 DH 帧中比较完全一致。
 */
function candidateResidual(
  targetPose: Pose,
  joints: JointAngles,
): {
  positionErrorMm: number
  orientationErrorRad: number
} {
  const matrix = forwardAbbKinematicsFramesDegrees(joints)[6]
  const data = matrix.data
  const positionErrorMm = Math.hypot(
    data[0][3] - targetPose.position[0],
    data[1][3] - targetPose.position[1],
    data[2][3] - targetPose.position[2],
  )
  const orientationErrorRad = rotationDistanceRad(targetPose.rotation, matrix.getRotation())
  return { positionErrorMm, orientationErrorRad }
}

function isFiniteJointVector(joints: JointAngles): boolean {
  return joints.every(Number.isFinite)
}

/** 返回 ABB 候选 DH 链的全部解析分支；结果已按 FK 残差标记精确性。 */
export function solveAbbAnalyticIK(targetPose: Pose, referenceJoints?: JointAngles): IKCandidate[] {
  const target = toUncorrectedTargetPose(targetPose)
  const targetRotation = getRotation(target)
  const wristCenter = subtract(
    target.position,
    scale([targetRotation[0][2], targetRotation[1][2], targetRotation[2][2]], D6_MM),
  )
  const radial = Math.hypot(wristCenter[0], wristCenter[1])
  const baseAngle =
    radial <= EPSILON
      ? referenceJoints
        ? (referenceJoints[0] * Math.PI) / 180
        : 0
      : Math.atan2(wristCenter[1], wristCenter[0])
  const firstAxisBranches = uniqueAngles([baseAngle, baseAngle + Math.PI])
  const candidates: IKCandidate[] = []

  for (const [q1BranchIndex, q1] of firstAxisBranches.entries()) {
    // q1 分支索引即 ABB arm 位：0 = baseAngle（front），1 = baseAngle + π（back）。
    const armBit = q1BranchIndex as 0 | 1
    for (const planar of solvePlanarBranches(q1, wristCenter)) {
      for (const wristBranch of solveWristBranches(
        targetRotation,
        planar.joints,
        referenceJoints,
      )) {
        const joints = wristBranch.joints.map((value) => (value * 180) / Math.PI) as JointAngles
        if (!isFiniteJointVector(joints)) continue
        const residual = candidateResidual(targetPose, joints)
        candidates.push({
          joints,
          positionErrorMm: residual.positionErrorMm,
          orientationErrorRad: residual.orientationErrorRad,
          isLeastSquares:
            residual.positionErrorMm > POSITION_EPSILON_MM ||
            residual.orientationErrorRad > ORIENTATION_EPSILON_RAD,
          isSingular:
            Math.abs(wristBranch.joints[4]) <=
            (ABB_WRIST_SINGULARITY_THRESHOLD_DEG * Math.PI) / 180,
          configuration: abbConfigurationFromBranch(
            joints,
            armBit,
            planar.elbowBit,
            wristBranch.wristBit,
          ),
        })
      }
    }
  }
  return candidates
}

/**
 * 由实际关节姿态反推 ABB 构型 [cf1, cf4, cf6, cfx]。
 * 做法：FK 得到当前位姿后重新枚举解析分支，取与当前关节（按 ±180° 回绕）最接近
 * 的分支的构型标签。标签与求解器出自同一分支规则，保证 confdata 语义一致，
 * 可供多解选择“保持当前构型”使用。
 */
export function abbConfigurationFromJoints(jointsDeg: JointAngles): ABBConfiguration | null {
  const matrix = forwardAbbKinematicsFramesDegrees(jointsDeg)[6]
  const data = matrix.data
  const pose: Pose = {
    position: [data[0][3], data[1][3], data[2][3]],
    euler: [0, 0, 0],
    rotation: matrix.getRotation(),
  }
  let best: ABBConfiguration | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of solveAbbAnalyticIK(pose, jointsDeg)) {
    if (!candidate.configuration) continue
    const distance = Math.max(
      ...candidate.joints.map((value, index) =>
        Math.abs(wrapRadians(((value - jointsDeg[index]) * Math.PI) / 180)),
      ),
    )
    if (distance < bestDistance) {
      bestDistance = distance
      best = [
        abbQuadrant(jointsDeg[0]),
        abbQuadrant(jointsDeg[3]),
        abbQuadrant(jointsDeg[5]),
        candidate.configuration[3],
      ]
    }
  }
  return best
}
