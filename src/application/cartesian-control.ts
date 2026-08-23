import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from 'vue'
import { degToRad, radToDeg } from '@/robotics/math/angle.ts'
import { mat3Mul, rotationMatrixToEulerZYX } from '@/robotics/math/rotation3d.ts'
import { eulerZYXToMatrix } from '@/robotics/matrix4x4.ts'
import type {
  CartesianPathFailure,
  CartesianPathResult,
  WaypointFailureDiagnostic,
} from '@/robotics/cartesian-path-planner.ts'
import { planCartesianTarget } from '@/robotics/cartesian-motion-planner.ts'
import { createCartesianJogSession } from './cartesian-jog-session.ts'
import type { RobotProfile } from '@/robotics/robot-profile.ts'
import type {
  CartesianAxis,
  CoordinateSystem,
  JointAngles,
  Pose,
  PoseDisplay,
} from '@/robotics/types.ts'

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

function mapPathFailureToStatus(failure: CartesianPathFailure): CartesianStatus {
  if (failure === 'wrist-singularity') return 'singularity'
  if (failure === 'wrist-reconfiguration') return 'reconfiguration'
  if (failure === 'joint-limit') return 'joint-limit'
  if (failure === 'joint-step') return 'joint-step'
  // 普通 IK 不收敛仍归入原有 unreachable 状态；规划器已经保留了更细的 failure 枚举，
  // 这里只保持控制面板状态数量精简，避免为一次数值失败增加重复的 UI 分支。
  return 'unreachable'
}

function formatFailureDiagnostic(diagnostic: WaypointFailureDiagnostic | null): string {
  if (!diagnostic) return ''
  const waypoint = `第 ${diagnostic.waypointIndex} 个路径点`
  if (diagnostic.axisIndex < 0 || diagnostic.axisIndex > 5) {
    return `${waypoint} 未找到可验收的关节解，无法归因到单个关节`
  }
  const axis = `J${diagnostic.axisIndex + 1}`
  const current = `当前 ${diagnostic.previousAngleDeg.toFixed(2)}°`
  const attempted = diagnostic.attemptedAngleDeg === undefined
    ? ''
    : `，尝试 ${diagnostic.attemptedAngleDeg.toFixed(2)}°`
  const delta = diagnostic.deltaDeg === undefined
    ? ''
    : `，变化 ${diagnostic.deltaDeg.toFixed(2)}°`
  const limit = diagnostic.limitRangeDeg
    ? `，允许范围 ${diagnostic.limitRangeDeg[0]}°~${diagnostic.limitRangeDeg[1]}°`
    : ''
  return `${waypoint}：${axis} 无法继续（${current}${attempted}${delta}${limit}）`
}

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

export interface CartesianControlOptions {
  joints: Ref<JointAngles>
  pose: ComputedRef<PoseDisplay>
  profile: RobotProfile
  moveToTrajectory: (
    trajectory: readonly JointAngles[],
    isContinuous?: boolean,
    generation?: number,
  ) => void
  /** 可替换规划 adapter；缺省为同步实现，生产 App 注入 Worker adapter。 */
  planTarget?: (
    targetPose: Pose,
    initialJoints: JointAngles,
    context: CartesianPlanningContext,
  ) => CartesianPathResult | Promise<CartesianPathResult | null>
  cancelPlanning?: () => void
}

export interface CartesianPlanningContext {
  isContinuous: boolean
  allowWristEntry: boolean
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
  const failureDiagnostic = ref<WaypointFailureDiagnostic | null>(null)
  const jogSession = createCartesianJogSession()
  let planningVersion = 0
  let continuousPlanning = false
  let queuedContinuousTarget: { target: PoseDisplay; context: CartesianPlanningContext } | null = null
  let continuousTimer: ReturnType<typeof setInterval> | null = null
  const planTarget =
    options.planTarget ??
    ((target: Pose, initial: JointAngles, context: CartesianPlanningContext) =>
      planCartesianTarget(target, initial, options.profile, context))

  const statusMessage = computed(() => {
    const detail = formatFailureDiagnostic(failureDiagnostic.value)
    const withDetail = (message: string) => (detail ? `${message}；${detail}` : message)
    if (status.value === 'solved') return '笛卡尔路径规划成功，严格姿态目标运动已提交'
    if (status.value === 'planning') return '笛卡尔路径规划中，正在等待最新目标'
    if (status.value === 'wrist-solved') {
      return '机械零位腕部奇异已自动进入 SingArea\\Wrist：TCP 路径保持线性，姿态允许局部误差'
    }
    if (status.value === 'invalid') return '输入无效，未执行目标'
    if (status.value === 'singularity') {
      return withDetail('自动腕部插补仍无法连续通过奇异（J5≈0°）；请修改目标姿态，或先用关节 Jog 脱离')
    }
    if (status.value === 'reconfiguration') {
      return withDetail('目标将导致机器人构型重新配置，请修改奇异点另一侧第一个目标的姿态，或先用关节 Jog 脱离')
    }
    if (status.value === 'joint-limit') return withDetail('目标会触及关节限位，未执行目标')
    if (status.value === 'joint-step') return withDetail('路径需要跨越非腕部构型跳变，未执行目标')
    if (status.value === 'not-converged') return withDetail('逆解未收敛，未执行目标')
    if (status.value === 'unreachable') return withDetail('路径不可达，未执行目标')
    return '就绪'
  })

  function commitPlanResult(
    result: CartesianPathResult | null,
    isContinuous: boolean,
    target: PoseDisplay,
  ): boolean {
    failureDiagnostic.value = null
    if (result === null) {
      if (isContinuous) jogSession.rollback()
      status.value = 'unreachable'
      return false
    }
    if (result.ok) {
      if (isContinuous) {
        const tail = result.waypoints[result.waypoints.length - 1]
        if (tail) jogSession.commit(target, tail)
      }
      options.moveToTrajectory(
        result.waypoints,
        isContinuous,
        isContinuous ? jogSession.getGeneration() : undefined,
      )
      status.value = result.appliedSingularityMode === 'wrist' ? 'wrist-solved' : 'solved'
      return true
    }
    failureDiagnostic.value = result.diagnostic ?? null
    if (isContinuous) jogSession.rollback()
    status.value = mapPathFailureToStatus(result.failure)
    return false
  }

  function solveTarget(
    target: PoseDisplay,
    context: CartesianPlanningContext,
  ): boolean | null {
    if (context.isContinuous && continuousPlanning) {
      queuedContinuousTarget = { target, context }
      return null
    }
    const robotTarget = toRobotPose(target)
    const currentVersion = ++planningVersion
    const currentGeneration = context.isContinuous ? jogSession.getGeneration() : null
    if (context.isContinuous) continuousPlanning = true
    const planningJoints = context.isContinuous
      ? jogSession.getPlanningJoints(options.joints.value)
      : [...options.joints.value] as JointAngles
    const planned = planTarget(robotTarget, planningJoints, context)
    if (planned instanceof Promise) {
      status.value = 'planning'
      void planned.then((result) => {
        if (context.isContinuous) continuousPlanning = false
        if (currentVersion !== planningVersion) return
        if (context.isContinuous && currentGeneration !== jogSession.getGeneration()) return
        if (queuedContinuousTarget && currentVersion === planningVersion) {
          const queuedTarget = queuedContinuousTarget
          queuedContinuousTarget = null
          solveTarget(queuedTarget.target, queuedTarget.context)
          return
        }
        commitPlanResult(result, context.isContinuous, target)
      })
      return null
    }
    if (context.isContinuous) continuousPlanning = false
    return commitPlanResult(planned, context.isContinuous, target)
  }

  function beginContinuous(axis: CartesianAxis, direction: CartesianDirection): void {
    if (!jogSession.isActive()) jogSession.begin(options.pose.value, options.joints.value)
    if (continuousTimer !== null) return

    // 首步立即规划，后续由控制器统一节拍；面板不再自行创建重复定时器。
    move(axis, direction, true)
    continuousTimer = setInterval(() => move(axis, direction, true), 100)
  }

  function endContinuous(): void {
    if (continuousTimer !== null) {
      clearInterval(continuousTimer)
      continuousTimer = null
    }
    planningVersion += 1
    queuedContinuousTarget = null
    continuousPlanning = false
    options.cancelPlanning?.()
    jogSession.end()
  }

  function move(axis: CartesianAxis, direction: CartesianDirection, isContinuous = false): void {
    if (!isContinuous) {
      endContinuous()
    }
    const step =
      axis === 'rx' || axis === 'ry' || axis === 'rz' ? orientationStep.value : positionStep.value
    const isTranslation = axis === 'x' || axis === 'y' || axis === 'z'
    if (isContinuous && !jogSession.isActive()) {
      jogSession.begin(options.pose.value, options.joints.value)
    }
    const basePose = isContinuous
      ? jogSession.getAnchor(options.pose.value)
      : options.pose.value
    const target = applyCartesianDelta(
      basePose,
      axis,
      direction,
      step,
      coordinateSystem.value,
    )
    if (isContinuous) jogSession.request(target)
    solveTarget(target, {
      isContinuous,
      allowWristEntry: isTranslation,
    })
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
    endContinuous()
    solveTarget(target, {
      isContinuous: false,
      allowWristEntry: false,
    })
  }

  function setCoordinateSystem(value: CoordinateSystem): void {
    coordinateSystem.value = value
    planningVersion += 1
    options.cancelPlanning?.()
  }

  function setPositionStep(value: number): void {
    if (isPositionStep(value)) positionStep.value = value
  }

  function setOrientationStep(value: number): void {
    if (isOrientationStep(value)) orientationStep.value = value
  }

  onBeforeUnmount(endContinuous)

  return {
    coordinateSystem,
    positionStep,
    orientationStep,
    status,
    statusMessage,
    move,
    beginContinuous,
    endContinuous,
    setField,
    setCoordinateSystem,
    setPositionStep,
    setOrientationStep,
  }
}
