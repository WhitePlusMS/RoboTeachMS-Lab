import { degToRad, radToDeg } from '@/robot-geometry/math/angle.ts'
import { mat3Mul, rotationMatrixToEulerZYX } from '@/robot-geometry/math/rotation3d.ts'
import { eulerZYXToMatrix } from '@/robot-geometry/transform/transform-matrix.ts'
import type { JointAngles, Pose, PoseDisplay } from '@/robot-geometry/model/index.ts'
import type { MotionError, MotionPlanningResult } from '@/robot-motion-core/index.ts'
import type { CartesianAxis, CoordinateSystem } from './cartesian-types.ts'

export const POSITION_STEPS = [0.1, 1, 10, 50] as const
export const ORIENTATION_STEPS = [0.1, 1, 5, 10] as const
export type CartesianDirection = -1 | 1
export type PositionStep = (typeof POSITION_STEPS)[number]
export type OrientationStep = (typeof ORIENTATION_STEPS)[number]
export type CartesianStatus =
  | 'ready'
  | 'planning'
  | 'solved'
  | 'wrist-solved'
  | 'invalid'
  | 'unreachable'
  | 'singularity'
  | 'reconfiguration'
  | 'joint-limit'
  | 'joint-step'
  | 'not-converged'

/** 应用层只保留用于状态呈现的路径结果，不暴露 Core 内部求解器类型。 */
export type CartesianPathFailure =
  | 'wrist-singularity'
  | 'wrist-reconfiguration'
  | 'joint-limit'
  | 'joint-step'
  | 'ik-not-converged'
export interface WaypointFailureDiagnostic {
  waypointIndex: number
  axisIndex: number
  previousAngleDeg: number
  attemptedAngleDeg?: number
  deltaDeg?: number
  limitRangeDeg?: readonly [number, number]
}
export type CartesianPathResult =
  | {
      ok: true
      waypoints: JointAngles[]
      appliedSingularityMode: 'wrist' | null
    }
  | {
      ok: false
      failure: CartesianPathFailure
      diagnostic?: WaypointFailureDiagnostic
      coreError?: MotionError
    }

export function mapPathFailureToStatus(failure: CartesianPathFailure): CartesianStatus {
  if (failure === 'wrist-singularity') return 'singularity'
  if (failure === 'wrist-reconfiguration') return 'reconfiguration'
  if (failure === 'joint-limit') return 'joint-limit'
  if (failure === 'joint-step') return 'joint-step'
  // 普通 IK 不收敛仍归入原有 unreachable 状态；规划器已经保留了更细的 failure 枚举，
  // 这里只保持控制面板状态数量精简，避免为一次数值失败增加重复的 UI 分支。
  return 'unreachable'
}

export function formatFailureDiagnostic(diagnostic: WaypointFailureDiagnostic | null): string {
  if (!diagnostic) return ''
  const waypoint = `第 ${diagnostic.waypointIndex} 个路径点`
  if (diagnostic.axisIndex < 0 || diagnostic.axisIndex > 5) {
    return `${waypoint} 未找到可验收的关节解，无法归因到单个关节`
  }
  const axis = `J${diagnostic.axisIndex + 1}`
  const current = `当前 ${diagnostic.previousAngleDeg.toFixed(2)}°`
  const attempted =
    diagnostic.attemptedAngleDeg === undefined
      ? ''
      : `，尝试 ${diagnostic.attemptedAngleDeg.toFixed(2)}°`
  const delta = diagnostic.deltaDeg === undefined ? '' : `，变化 ${diagnostic.deltaDeg.toFixed(2)}°`
  const limit = diagnostic.limitRangeDeg
    ? `，允许范围 ${diagnostic.limitRangeDeg[0]}°~${diagnostic.limitRangeDeg[1]}°`
    : ''
  return `${waypoint}：${axis} 无法继续（${current}${attempted}${delta}${limit}）`
}

export const AXIS_INDEX: Record<CartesianAxis, number> = {
  x: 0,
  y: 1,
  z: 2,
  rx: 0,
  ry: 1,
  rz: 2,
}

function rotationDelta(axis: CartesianAxis, degrees: number): number[][] {
  const angle = degToRad(degrees)
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  if (axis === 'rx')
    return [
      [1, 0, 0],
      [0, cosine, -sine],
      [0, sine, cosine],
    ]
  if (axis === 'ry')
    return [
      [cosine, 0, sine],
      [0, 1, 0],
      [-sine, 0, cosine],
    ]
  return [
    [cosine, -sine, 0],
    [sine, cosine, 0],
    [0, 0, 1],
  ]
}

function transformVector(
  rotation: number[][],
  vector: [number, number, number],
): [number, number, number] {
  return rotation.map((row) =>
    row.reduce((sum, value, index) => sum + value * vector[index], 0),
  ) as [number, number, number]
}

/** 根据 World/Tool 坐标系计算一次笛卡尔增量，不触碰 Vue 或 Three.js 状态。 */
export function applyCartesianDelta(
  pose: PoseDisplay,
  axis: CartesianAxis,
  direction: CartesianDirection,
  step: number,
  coordinateSystem: CoordinateSystem,
): PoseDisplay {
  if (!Number.isFinite(step) || step < 0) {
    return {
      ...pose,
      positionMm: [...pose.positionMm] as PoseDisplay['positionMm'],
      orientationDeg: [...pose.orientationDeg] as PoseDisplay['orientationDeg'],
    }
  }

  const nextPosition = [...pose.positionMm] as PoseDisplay['positionMm']
  const nextOrientation = [...pose.orientationDeg] as PoseDisplay['orientationDeg']
  const index = AXIS_INDEX[axis]
  const delta = direction * step

  if (axis === 'x' || axis === 'y' || axis === 'z') {
    const localDelta: [number, number, number] = [0, 0, 0]
    localDelta[index] = delta
    const worldDelta =
      coordinateSystem === 'Tool'
        ? transformVector(
            eulerZYXToMatrix(pose.orientationDeg.map(degToRad) as [number, number, number]),
            localDelta,
          )
        : localDelta
    worldDelta.forEach((value, component) => {
      nextPosition[component] += value
    })
  } else {
    const currentRotation = eulerZYXToMatrix(
      pose.orientationDeg.map(degToRad) as [number, number, number],
    )
    const deltaRotation = rotationDelta(axis, delta)
    const nextRotation =
      coordinateSystem === 'Tool'
        ? mat3Mul(currentRotation, deltaRotation)
        : mat3Mul(deltaRotation, currentRotation)
    const nextEuler = rotationMatrixToEulerZYX(nextRotation).map(radToDeg) as [
      number,
      number,
      number,
    ]
    nextOrientation.splice(0, 3, ...nextEuler)
  }

  return { positionMm: nextPosition, orientationDeg: nextOrientation }
}

export function isPositionStep(value: number): value is PositionStep {
  return POSITION_STEPS.some((step) => step === value)
}

export function isOrientationStep(value: number): value is OrientationStep {
  return ORIENTATION_STEPS.some((step) => step === value)
}

export function coreResultToPathResult(result: MotionPlanningResult): CartesianPathResult {
  if (result.ok) {
    return {
      ok: true,
      waypoints: result.waypoints.slice(1).map((point) => [...point.jointsDeg] as JointAngles),
      appliedSingularityMode: result.validation.relaxedConstraints ? 'wrist' : null,
    }
  }
  const failure =
    result.error.code === 'joint-limit'
      ? 'joint-limit'
      : result.error.code === 'path-discontinuity'
        ? 'joint-step'
        : result.error.code === 'wrist-singularity'
          ? 'wrist-singularity'
          : 'ik-not-converged'
  const details = result.error.details
  const diagnostic =
    typeof details.waypointIndex === 'number' &&
    typeof details.axisIndex === 'number' &&
    typeof details.previousAngleDeg === 'number'
      ? {
          waypointIndex: details.waypointIndex,
          axisIndex: details.axisIndex,
          previousAngleDeg: details.previousAngleDeg,
          attemptedAngleDeg:
            typeof details.attemptedAngleDeg === 'number' ? details.attemptedAngleDeg : undefined,
          deltaDeg: typeof details.deltaDeg === 'number' ? details.deltaDeg : undefined,
        }
      : undefined
  return { ok: false, failure, diagnostic, coreError: result.error }
}

export function toRobotPose(pose: PoseDisplay): Pose {
  const euler = pose.orientationDeg.map(degToRad) as [number, number, number]
  return {
    position: pose.positionMm,
    euler,
    rotation: eulerZYXToMatrix(euler),
  }
}
