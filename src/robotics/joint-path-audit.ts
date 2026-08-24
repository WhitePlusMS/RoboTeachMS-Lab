import type { JointAngles } from './types.ts'

const WRIST_STEP_LOG_THRESHOLD_DEG = 20
const WRIST_ABSOLUTE_LOG_THRESHOLD_DEG = 150
const MAX_AUDIT_POINTS = 8

type WristAxis = 'J4' | 'J6'

export interface JointPathAuditPoint {
  waypointIndex: number
  previous: JointAngles
  current: JointAngles
  next: JointAngles | null
  deltaFromPreviousDeg: JointAngles
  deltaToNextDeg: JointAngles | null
  wristAbsDeg: { J4: number; J6: number }
}

export interface JointPathAudit {
  initialJoints: JointAngles
  waypointCount: number
  initialWristAbsDeg: { J4: number; J6: number }
  maxWristAbsolute: { axis: WristAxis; valueDeg: number; waypointIndex: number }
  maxWristStep: { axis: WristAxis; valueDeg: number; waypointIndex: number }
  maxWristStepPoint: JointPathAuditPoint
  firstHighWristPoint: JointPathAuditPoint | null
  suspiciousPoints: readonly JointPathAuditPoint[]
}

function copyJoints(joints: JointAngles): JointAngles {
  return [...joints] as JointAngles
}

function maxWristValue(joints: JointAngles): { axis: WristAxis; valueDeg: number } {
  const j4 = Math.abs(joints[3])
  const j6 = Math.abs(joints[5])
  return j4 >= j6 ? { axis: 'J4', valueDeg: j4 } : { axis: 'J6', valueDeg: j6 }
}

function maxWristDelta(delta: JointAngles): { axis: WristAxis; valueDeg: number } {
  const j4 = delta[3]
  const j6 = delta[5]
  return j4 >= j6 ? { axis: 'J4', valueDeg: j4 } : { axis: 'J6', valueDeg: j6 }
}

/**
 * 构造低噪声的腕部路径审计：只保留疑似构型切换或接近 ±180° 的 waypoint，
 * 每个点同时给出前一个、当前和后一个完整六轴快照，便于复制到问题报告。
 */
export function buildJointPathAudit(
  initialJoints: JointAngles,
  waypoints: readonly JointAngles[],
): JointPathAudit | null {
  if (waypoints.length === 0) return null
  const sequence = [initialJoints, ...waypoints]
  let maxAbsolute = { axis: 'J4' as WristAxis, valueDeg: -1, waypointIndex: 1 }
  let maxStep = { axis: 'J4' as WristAxis, valueDeg: -1, waypointIndex: 1 }
  let maxStepPoint: JointPathAuditPoint | null = null
  let firstHighWristPoint: JointPathAuditPoint | null = null
  const candidates: Array<{ score: number; point: JointPathAuditPoint }> = []

  for (let index = 1; index < sequence.length; index += 1) {
    const previous = sequence[index - 1]
    const current = sequence[index]
    const next = sequence[index + 1] ?? null
    const deltaFromPrevious = current.map(
      (value, jointIndex) => Math.abs(value - previous[jointIndex]),
    ) as JointAngles
    const deltaToNext = next
      ? next.map((value, jointIndex) => Math.abs(value - current[jointIndex])) as JointAngles
      : null
    const absolute = maxWristValue(current)
    const step = maxWristDelta(deltaFromPrevious)
    if (absolute.valueDeg > maxAbsolute.valueDeg) {
      maxAbsolute = { ...absolute, waypointIndex: index }
    }
    if (step.valueDeg > maxStep.valueDeg) {
      maxStep = { ...step, waypointIndex: index }
    }
    const point: JointPathAuditPoint = {
      waypointIndex: index,
      previous: copyJoints(previous),
      current: copyJoints(current),
      next: next ? copyJoints(next) : null,
      deltaFromPreviousDeg: deltaFromPrevious,
      deltaToNextDeg: deltaToNext,
      wristAbsDeg: { J4: Math.abs(current[3]), J6: Math.abs(current[5]) },
    }
    if (step.valueDeg === maxStep.valueDeg) maxStepPoint = point
    if (
      firstHighWristPoint === null &&
      (point.wristAbsDeg.J4 >= WRIST_ABSOLUTE_LOG_THRESHOLD_DEG ||
        point.wristAbsDeg.J6 >= WRIST_ABSOLUTE_LOG_THRESHOLD_DEG)
    ) {
      firstHighWristPoint = point
    }
    if (
      step.valueDeg < WRIST_STEP_LOG_THRESHOLD_DEG &&
      absolute.valueDeg < WRIST_ABSOLUTE_LOG_THRESHOLD_DEG
    ) {
      continue
    }
    candidates.push({
      score: Math.max(step.valueDeg, absolute.valueDeg),
      point,
    })
  }

  if (candidates.length === 0) return null
  if (maxStepPoint === null) throw new Error('路径审计未生成最大腕部步长点')
  candidates.sort((left, right) => right.score - left.score)
  return {
    initialJoints: copyJoints(initialJoints),
    waypointCount: waypoints.length,
    initialWristAbsDeg: { J4: Math.abs(initialJoints[3]), J6: Math.abs(initialJoints[5]) },
    maxWristAbsolute: maxAbsolute,
    maxWristStep: maxStep,
    maxWristStepPoint: maxStepPoint,
    firstHighWristPoint,
    suspiciousPoints: candidates.slice(0, MAX_AUDIT_POINTS).map(({ point }) => point),
  }
}
