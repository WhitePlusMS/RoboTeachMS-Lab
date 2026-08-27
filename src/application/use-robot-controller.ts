import { inject, provide, type InjectionKey } from 'vue'
import type {
  JointAngles,
  PoseDisplay,
} from '@/robotics/model/index.ts'
import type { CartesianAxis, CoordinateSystem } from './cartesian-types.ts'
import type { JointRange } from '@/robotics/model/robot-profile.ts'
import type { JointDirection, JointStep } from '@/application/joint-control.ts'
import type {
  CartesianDirection,
  CartesianStatus,
  OrientationStep,
  PositionStep,
} from '@/application/cartesian-control.ts'

/**
 * 只读 ref：面板只读展示控制器提供的状态切片，因此只要求可读的 .value。
 * 既接受 Ref 也接受 ComputedRef，避免把控制器与某一具体响应式实现耦合。
 */
type ReadonlyRef<T> = { readonly value: T }

/**
 * 跨面板共享的机器人控制切片（由 App 单一实例化并 provide，整个子树可 inject）。
 * 读切片只读展示；动作切片由提供方（App）持有编排所有权（如 setJoint 先停程序再运动）。
 * 该接口只暴露面板需要的紧凑视图，不把 MotionRunner / ProgramController 内部泄漏给组件。
 */
export interface RobotController {
  /** 共享关节读状态。 */
  joints: ReadonlyRef<JointAngles>
  jointRanges: readonly JointRange[]
  jointStep: ReadonlyRef<JointStep>
  pose: ReadonlyRef<PoseDisplay>
  /** 笛卡尔读状态。 */
  coordinateSystem: ReadonlyRef<CoordinateSystem>
  positionStep: ReadonlyRef<PositionStep>
  orientationStep: ReadonlyRef<OrientationStep>
  status: ReadonlyRef<CartesianStatus>
  statusMessage: ReadonlyRef<string>
  /** 关节动作。 */
  setJoint(index: number, value: number): void
  adjustJoint(index: number, direction: JointDirection, isContinuous?: boolean): void
  beginJointContinuous(index: number, direction: JointDirection): void
  endJointContinuous(): void
  setStep(value: number): void
  reset(): void
  resetMechanicalZero(): void
  randomize(): void
  /** 笛卡尔动作。 */
  moveCartesian(
    axis: CartesianAxis,
    direction: CartesianDirection,
    isContinuous?: boolean,
  ): void
  beginCartesianContinuous(axis: CartesianAxis, direction: CartesianDirection): void
  endCartesianContinuous(): void
  setCoordinateSystem(value: CoordinateSystem): void
  setPositionStep(value: number): void
  setOrientationStep(value: number): void
}

export const RobotControllerKey: InjectionKey<RobotController> = Symbol('robot-controller')

/** 由 App 在 setup 中调用一次，把共享机器人控制切片提供给左侧 Jog 工作区子树。 */
export function provideRobotController(controller: RobotController): void {
  provide(RobotControllerKey, controller)
}

/** 子面板 inject；无提供方（如独立测试挂载）时返回 null，由组件回退到自己的 props。 */
export function injectRobotController(): RobotController | null {
  return inject(RobotControllerKey, null)
}
