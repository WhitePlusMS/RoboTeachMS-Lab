import type { IKCandidate, RobotConfiguration } from './ik/ik-types.ts'

/** 机器人核心关节与末端位姿类型；不依赖 Vue、Three.js 或具体厂家。 */
export type JointAngles = [number, number, number, number, number, number]

/** 面板展示的末端位姿；位置沿用机器人模型的毫米单位。 */
export interface PoseDisplay {
  positionMm: [number, number, number]
  orientationDeg: [number, number, number]
}

/** 逆解模型使用的位姿；旋转矩阵是唯一的姿态误差计算来源。 */
export interface Pose {
  position: [number, number, number]
  euler: [number, number, number]
  rotation: number[][]
}

/** FK/Jacobian 来源抽象；逆解器不直接依赖 Vue 或 Three.js。 */
export interface RobotModel {
  forwardKinematics(jointsDeg: JointAngles): Pose | null
  estimateJacobian(jointsDeg: JointAngles, stepDeg?: number): number[][] | null
  isAvailable(): boolean
  /** 可选的解析/几何逆解；返回全部分支，不在模型层选择 J4/J6 构型。 */
  solveAllIK?(targetPose: Pose, referenceJoints?: JointAngles): readonly IKCandidate[]
  /** 可选的型号特定构型反推（如 ABB cf1/cf4/cf6/cfx）；供多解选择保持当前构型。 */
  deriveConfiguration?(jointsDeg: JointAngles): RobotConfiguration | null
  /** 将解析分支的构型标签映射到某个多圈关节表示。 */
  configurationForRepresentation?(
    source: RobotConfiguration,
    jointsDeg: JointAngles,
  ): RobotConfiguration
  /** 可选的型号特定腕部奇异判定；未提供时不把通用步长失败误报为腕部重构。 */
  isWristSingularity?(jointsDeg: JointAngles): boolean
}

/** 单个关节的伺服范围，保持只读 tuple 语义。 */
export type JointRange = readonly [number, number]

/** 六轴关节范围 tuple：结构固定，便于类型安全与平面测试。 */
export type SixAxisJointRanges = readonly [
  JointRange,
  JointRange,
  JointRange,
  JointRange,
  JointRange,
  JointRange,
]

/**
 * 厂家无关的机器人运行契约：聚合型号身份、一体运动学模型、六轴关节范围与回零关节状态。
 * DH 参数、三维资产、FBX 节点、颜色、Three.js 矩阵与 RAPID 默认值不属于本契约。
 *
 * 本契约作为跨关节、笛卡尔与程序控制共享的稳定单例：所有字段只读，调用者只在需要
 * 运动目标时通过展开运算从 homeJoints/mechanicalZeroJoints 派生可写 JointAngles，禁止改写或替换任一字段，
 * 一次误写会污染所有控制器。
 */
export interface RobotProfile {
  readonly id: string
  /** 几何与构型定义版本；请求和 Worker 必须匹配。 */
  readonly revision: string
  readonly displayName: string
  readonly model: RobotModel
  readonly jointRanges: SixAxisJointRanges
  /** 教学 Home 关节状态：用于常规初始姿态与回零，避开已知腕部奇异构型。 */
  readonly homeJoints: Readonly<JointAngles>
  /** 厂家机械/同步零位：用于校准与诊断，不作为默认教学姿态。 */
  readonly mechanicalZeroJoints: Readonly<JointAngles>
}
