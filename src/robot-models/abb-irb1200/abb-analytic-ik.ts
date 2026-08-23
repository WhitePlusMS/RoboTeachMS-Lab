import { rotationDistanceRad } from '@/robotics/math/rotation3d.ts'
import type { IKCandidate, JointAngles, Pose } from '@/robotics/types.ts'
import { forwardAbbKinematicsFramesDegrees } from './abb-kinematics.ts'
import {
  ABB_IRB1200_5_90_STANDARD_DH,
  ABB_WRIST_SINGULARITY_THRESHOLD_DEG,
} from './robot-config.ts'

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
    b[0].map((_, column) =>
      row[0] * b[0][column] + row[1] * b[1][column] + row[2] * b[2][column],
    ),
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

function solvePlanarBranches(q1: number, wrist: Vector3): JointAngles[] {
  const radial = Math.cos(q1) * wrist[0] + Math.sin(q1) * wrist[1]
  const vertical = wrist[2] - D1_MM
  const distance = Math.hypot(radial, vertical)
  if (distance < EPSILON) return []

  const cosine = clampUnit(
    (A2_MM * A2_MM + distance * distance - L3_MM * L3_MM) /
      (2 * A2_MM * distance),
  )
  const elbowAngle = Math.acos(cosine)
  const targetAngle = Math.atan2(radial, vertical)
  const branches: JointAngles[] = []

  for (const sign of [1, -1] as const) {
    // DH 链的向量形式是 (r,z)=(L sin(q),L cos(q))，所以目标夹角直接对应 q2。
    const q2 = targetAngle + sign * elbowAngle
    const remainingRadial = radial - A2_MM * Math.sin(q2)
    const remainingVertical = vertical - A2_MM * Math.cos(q2)
    const wristPlanarAngle = Math.atan2(remainingRadial, remainingVertical)
    const q3 = wristPlanarAngle - q2 - L3_PHASE_RAD
    branches.push([q1, q2, q3, 0, 0, 0])
  }
  return branches
}

function solveWristBranches(
  targetRotation: Rotation3,
  q123: JointAngles,
  referenceJoints: JointAngles | undefined,
): JointAngles[] {
  const frames = forwardAbbKinematicsFramesDegrees(
    q123.map((value, index) => (index < 3 ? (value * 180) / Math.PI : 0)) as JointAngles,
  )
  const r03 = frames[3].getRotation() as Rotation3
  const r36 = multiplyRotation3(transpose(r03), targetRotation)
  const cosine5 = clampUnit(r36[2][2])
  const sineMagnitude5 = Math.sqrt(Math.max(0, 1 - cosine5 * cosine5))
  const branches: JointAngles[] = []
  const q4Reference = referenceJoints ? (referenceJoints[3] * Math.PI) / 180 : 0

  if (sineMagnitude5 <= EPSILON) {
    // 腕部奇异时 J4/J6 只确定和（q5≈0）或差（q5≈pi）。选择离参考姿态最近
    // 的 J4，再由目标 R36 反算另一轴；不丢弃姿态，也不擅自固定 J4=0。
    if (cosine5 >= 0) {
      const qSum = Math.atan2(r36[1][0], r36[0][0])
      for (const q4 of [q4Reference, q4Reference + Math.PI]) {
        branches.push([
          q123[0],
          q123[1],
          q123[2],
          q4,
          0,
          qSum - q4,
        ])
      }
    } else {
      const qDifference = Math.atan2(-r36[1][0], -r36[0][0])
      for (const q4 of [q4Reference, q4Reference + Math.PI]) {
        branches.push([
          q123[0],
          q123[1],
          q123[2],
          q4,
          Math.PI,
          q4 - qDifference,
        ])
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
    branches.push([q123[0], q123[1], q123[2], q4, q5, q6])
  }

  if (sineMagnitude5 <= WRIST_SINGULAR_SINE_THRESHOLD) {
    // J5 接近零时，姿态主要只决定 q4+q6。补充以参考 J4 为中心的耦合候选，
    // 供局部 SingArea\Wrist 选择使用；严格姿态仍由上面的精确分支优先验收。
    const qSum = cosine5 >= 0
      ? Math.atan2(r36[1][0], r36[0][0])
      : Math.atan2(-r36[1][0], -r36[0][0])
    const q5Positive = Math.atan2(sineMagnitude5, cosine5)
    branches.push(
      [q123[0], q123[1], q123[2], q4Reference, q5Positive, qSum - q4Reference],
      [
        q123[0],
        q123[1],
        q123[2],
        q4Reference + Math.PI,
        -q5Positive,
        qSum - q4Reference - Math.PI,
      ],
    )
  }
  return branches
}

function candidateResidual(targetPose: Pose, joints: JointAngles): {
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
export function solveAbbAnalyticIK(
  targetPose: Pose,
  referenceJoints?: JointAngles,
): IKCandidate[] {
  const targetRotation = getRotation(targetPose)
  const wristCenter = subtract(
    targetPose.position,
    scale([targetRotation[0][2], targetRotation[1][2], targetRotation[2][2]], D6_MM),
  )
  const radial = Math.hypot(wristCenter[0], wristCenter[1])
  const baseAngle = radial <= EPSILON
    ? referenceJoints
      ? (referenceJoints[0] * Math.PI) / 180
      : 0
    : Math.atan2(wristCenter[1], wristCenter[0])
  const firstAxisBranches = uniqueAngles([baseAngle, baseAngle + Math.PI])
  const candidates: IKCandidate[] = []

  for (const q1 of firstAxisBranches) {
    for (const q123 of solvePlanarBranches(q1, wristCenter)) {
      for (const jointsRad of solveWristBranches(targetRotation, q123, referenceJoints)) {
        const joints = jointsRad.map((value) => (value * 180) / Math.PI) as JointAngles
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
            Math.abs(jointsRad[4]) <= (ABB_WRIST_SINGULARITY_THRESHOLD_DEG * Math.PI) / 180,
        })
      }
    }
  }
  return candidates
}
