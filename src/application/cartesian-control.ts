import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { degToRad, radToDeg } from '../robotics/math/angle.ts'
import { mat3Mul, rotationMatrixToEulerZYX } from '../robotics/math/rotation3d.ts'
import { eulerZYXToMatrix } from '../robotics/matrix4x4.ts'
import { planCartesianPath } from '../robotics/cartesian-path-planner.ts'
import type { RobotModel } from '../robotics/robot-model.ts'
import type {
  CartesianAxis,
  CoordinateSystem,
  JointAngles,
  Pose,
  PoseDisplay,
} from '../robotics/types.ts'

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

function rotationDelta(axis: CartesianAxis, degrees: number): number[][] {
  const angle = degToRad(degrees)
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  if (axis === 'rx') return [[1, 0, 0], [0, cosine, -sine], [0, sine, cosine]]
  if (axis === 'ry') return [[cosine, 0, sine], [0, 1, 0], [-sine, 0, cosine]]
  return [[cosine, -sine, 0], [sine, cosine, 0], [0, 0, 1]]
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
      ? transformVector(eulerZYXToMatrix(pose.orientationDeg.map(degToRad) as [number, number, number]), localDelta)
      : localDelta
    worldDelta.forEach((value, component) => {
      nextPosition[component] += value
    })
  } else {
    const currentRotation = eulerZYXToMatrix(
      pose.orientationDeg.map(degToRad) as [number, number, number],
    )
    const deltaRotation = rotationDelta(axis, delta)
    const nextRotation = coordinateSystem === 'Tool'
      ? mat3Mul(currentRotation, deltaRotation)
      : mat3Mul(deltaRotation, currentRotation)
    const nextEuler = rotationMatrixToEulerZYX(nextRotation).map(radToDeg) as [number, number, number]
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

export interface CartesianControlOptions {
  joints: Ref<JointAngles>
  pose: ComputedRef<PoseDisplay>
  robotModel: Ref<RobotModel>
  jointRanges: readonly (readonly [number, number])[]
  moveToTrajectory: (trajectory: readonly JointAngles[], isContinuous?: boolean) => void
}

function toRobotPose(pose: PoseDisplay): Pose {
  const euler = pose.orientationDeg.map(degToRad) as [number, number, number]
  return {
    position: pose.positionMm,
    euler,
    rotation: eulerZYXToMatrix(euler),
  }
}

/** 笛卡尔控制编排：失败只更新状态，不覆盖最近一次有效关节。 */
export function useCartesianControl(options: CartesianControlOptions) {
  const coordinateSystem = ref<CoordinateSystem>('World')
  const positionStep = ref<PositionStep>(1)
  const orientationStep = ref<OrientationStep>(1)
  const status = ref<CartesianStatus>('ready')

  const statusMessage = computed(() => {
    if (status.value === 'solved') return '笛卡尔路径规划成功，目标运动已提交'
    if (status.value === 'invalid') return '输入无效，已保留最近一次有效姿态'
    if (status.value === 'unreachable') return '路径不可达或接近奇异构型，已保留最近一次有效姿态'
    return '就绪'
  })

  function solveTarget(target: PoseDisplay, isContinuous: boolean): void {
    const trajectory = planCartesianPath(
      toRobotPose(target),
      options.joints.value,
      options.robotModel.value,
      options.jointRanges,
    )
    if (trajectory) {
      options.moveToTrajectory(trajectory, isContinuous)
      status.value = 'solved'
      return
    }
    status.value = 'unreachable'
  }

  function move(axis: CartesianAxis, direction: CartesianDirection, isContinuous = false): void {
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
    solveTarget(target, isContinuous)
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
    solveTarget(target, false)
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
