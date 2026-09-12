import { degToRad, radToDeg } from '@/robot-geometry/math/angle.ts'
import { mat3Mul, rotationMatrixToEulerZYX } from '@/robot-geometry/math/rotation3d.ts'
import { eulerZYXToMatrix } from '@/robot-geometry/math/transform-matrix.ts'
import type { Pose, PoseDisplay } from '@/robot-geometry/robot-types.ts'

/** 页面 Cartesian Jog 使用的坐标系选择。 */
export type CoordinateSystem = 'World' | 'Tool'

/** 页面 Cartesian Jog 支持的平移与旋转轴。 */
export type CartesianAxis = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz'

export const POSITION_STEPS = [0.1, 1, 10, 50] as const

export const ORIENTATION_STEPS = [0.1, 1, 5, 10] as const

export type CartesianDirection = -1 | 1

export type PositionStep = (typeof POSITION_STEPS)[number]

export type OrientationStep = (typeof ORIENTATION_STEPS)[number]

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

export function toRobotPose(pose: PoseDisplay): Pose {
  const euler = pose.orientationDeg.map(degToRad) as [number, number, number]
  return {
    position: pose.positionMm,
    euler,
    rotation: eulerZYXToMatrix(euler),
  }
}
