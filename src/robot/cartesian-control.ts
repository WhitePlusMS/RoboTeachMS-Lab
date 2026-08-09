import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { solveIK, solvePositionOnlyIK } from '../core/robot/ik-solver'
import type {
  CartesianAxis,
  CoordinateSystem,
  JointAngles,
  PoseDisplay,
} from '../core/robot/types'
import { KUKA_LIKE } from '../robots/kuka-like/robot-config'

export const POSITION_STEPS = [0.1, 1, 10, 50] as const
export const ORIENTATION_STEPS = [0.1, 1, 5, 10] as const
export type CartesianDirection = -1 | 1
export type PositionStep = (typeof POSITION_STEPS)[number]
export type OrientationStep = (typeof ORIENTATION_STEPS)[number]
export type CartesianStatus = 'ready' | 'solved' | 'invalid' | 'unreachable'

const AXIS_INDEX: Record<CartesianAxis, number> = {
  x: 0,
  y: 1,
  z: 2,
  rx: 0,
  ry: 1,
  rz: 2,
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI
}

function rotationFromEulerZYX(orientationDeg: [number, number, number]): number[][] {
  const [rx, ry, rz] = orientationDeg.map(degreesToRadians)
  const crx = Math.cos(rx)
  const srx = Math.sin(rx)
  const cry = Math.cos(ry)
  const sry = Math.sin(ry)
  const crz = Math.cos(rz)
  const srz = Math.sin(rz)

  return [
    [cry * crz, crz * sry * srx - srz * crx, crz * sry * crx + srz * srx],
    [cry * srz, srz * sry * srx + crz * crx, srz * sry * crx - crz * srx],
    [-sry, cry * srx, cry * crx],
  ]
}

function multiplyRotation(left: number[][], right: number[][]): number[][] {
  return Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) =>
      left[row].reduce((sum, value, index) => sum + value * right[index][column], 0),
    ),
  )
}

function rotationDelta(axis: CartesianAxis, degrees: number): number[][] {
  const angle = degreesToRadians(degrees)
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  if (axis === 'rx') return [[1, 0, 0], [0, cosine, -sine], [0, sine, cosine]]
  if (axis === 'ry') return [[cosine, 0, sine], [0, 1, 0], [-sine, 0, cosine]]
  return [[cosine, -sine, 0], [sine, cosine, 0], [0, 0, 1]]
}

function eulerZYXFromRotation(rotation: number[][]): [number, number, number] {
  const sy = -rotation[2][0]
  const cy = Math.sqrt(rotation[0][0] ** 2 + rotation[1][0] ** 2)
  const ry = Math.atan2(sy, cy)
  if (cy > 1e-6) {
    return [
      radiansToDegrees(Math.atan2(rotation[2][1], rotation[2][2])),
      radiansToDegrees(ry),
      radiansToDegrees(Math.atan2(rotation[1][0], rotation[0][0])),
    ]
  }
  return [
    radiansToDegrees(Math.atan2(-rotation[1][2], rotation[1][1])),
    radiansToDegrees(ry),
    0,
  ]
}

function transformVector(rotation: number[][], vector: [number, number, number]): [number, number, number] {
  return rotation.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0)) as [
    number,
    number,
    number,
  ]
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
    const worldDelta = coordinateSystem === 'Tool'
      ? transformVector(rotationFromEulerZYX(pose.orientationDeg), localDelta)
      : localDelta
    worldDelta.forEach((value, component) => {
      nextPosition[component] += value
    })
  } else {
    const currentRotation = rotationFromEulerZYX(pose.orientationDeg)
    const deltaRotation = rotationDelta(axis, delta)
    const nextRotation = coordinateSystem === 'Tool'
      ? multiplyRotation(currentRotation, deltaRotation)
      : multiplyRotation(deltaRotation, currentRotation)
    nextOrientation.splice(0, 3, ...eulerZYXFromRotation(nextRotation))
  }

  return { positionMm: nextPosition, orientationDeg: nextOrientation }
}

export function isPositionStep(value: number): value is PositionStep {
  return POSITION_STEPS.some((step) => step === value)
}

export function isOrientationStep(value: number): value is OrientationStep {
  return ORIENTATION_STEPS.some((step) => step === value)
}

export interface CartesianControlOptions {
  joints: Ref<JointAngles>
  pose: ComputedRef<PoseDisplay>
  setJoints: (joints: JointAngles) => void
}

/** 笛卡尔控制编排：失败只更新状态，不覆盖最近一次有效关节。 */
export function useCartesianControl(options: CartesianControlOptions) {
  const coordinateSystem = ref<CoordinateSystem>('World')
  const positionStep = ref<PositionStep>(1)
  const orientationStep = ref<OrientationStep>(1)
  const status = ref<CartesianStatus>('ready')

  const statusMessage = computed(() => {
    if (status.value === 'solved') return '逆解完成，机器人已更新'
    if (status.value === 'invalid') return '输入无效，已保留最近一次有效姿态'
    if (status.value === 'unreachable') return '目标不可达，已保留最近一次有效姿态'
    return '就绪'
  })

  function solveTarget(target: PoseDisplay, positionOnlyFallback: boolean): void {
    const solved = solveIK(target, options.joints.value, KUKA_LIKE)
    const fallback = solved ?? (positionOnlyFallback
      ? solvePositionOnlyIK(target.positionMm, options.joints.value, KUKA_LIKE)
      : null)
    if (!fallback) {
      status.value = 'unreachable'
      return
    }
    options.setJoints(fallback)
    status.value = 'solved'
  }

  function move(axis: CartesianAxis, direction: CartesianDirection): void {
    const step = axis === 'rx' || axis === 'ry' || axis === 'rz'
      ? orientationStep.value
      : positionStep.value
    const target = applyCartesianDelta(
      options.pose.value,
      axis,
      direction,
      step,
      coordinateSystem.value,
    )
    solveTarget(target, axis === 'x' || axis === 'y' || axis === 'z')
  }

  function setField(axis: CartesianAxis, value: number): void {
    if (!Number.isFinite(value)) {
      status.value = 'invalid'
      return
    }
    const target = {
      positionMm: [...options.pose.value.positionMm] as PoseDisplay['positionMm'],
      orientationDeg: [...options.pose.value.orientationDeg] as PoseDisplay['orientationDeg'],
    }
    if (axis === 'x' || axis === 'y' || axis === 'z') target.positionMm[AXIS_INDEX[axis]] = value
    else target.orientationDeg[AXIS_INDEX[axis]] = value
    solveTarget(target, axis === 'x' || axis === 'y' || axis === 'z')
  }

  function setCoordinateSystem(value: CoordinateSystem): void {
    coordinateSystem.value = value
  }

  function setPositionStep(value: number): void {
    if (isPositionStep(value)) positionStep.value = value
  }

  function setOrientationStep(value: number): void {
    if (isOrientationStep(value)) orientationStep.value = value
  }

  return {
    coordinateSystem,
    positionStep,
    orientationStep,
    status,
    statusMessage,
    move,
    setField,
    setCoordinateSystem,
    setPositionStep,
    setOrientationStep,
  }
}
