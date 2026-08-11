import type { RobotModel } from './robot-model.ts'
import type { JointAngles } from './types.ts'

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
 * 运动目标时通过展开运算从 homeJoints 派生可写 JointAngles，禁止改写或替换任一字段，
 * 一次误写会污染所有控制器。
 */
export interface RobotProfile {
  readonly id: string
  readonly displayName: string
  readonly model: RobotModel
  readonly jointRanges: SixAxisJointRanges
  /** 回零关节状态：只读六元 tuple，使用方通过展开创建可写运动目标。 */
  readonly homeJoints: Readonly<JointAngles>
}
