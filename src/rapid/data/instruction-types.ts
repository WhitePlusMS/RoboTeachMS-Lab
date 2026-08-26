import type { RobTarget, SpeedData, ToolData, WobjData, ZoneData } from './records.ts'

/** 首期标量 RAPID 数据类型；用于模块级 VAR 声明、表达式和 Program Data 展示。 */
export type RapidScalarKind = 'num' | 'bool'

/** 标量声明的结构化初值；表达式树与执行期变量快照由 RAPID parser/executor 负责。 */
export type RapidScalarValue = number | boolean

/** ABB SingArea 腕部插补策略；默认 off 表示严格保持编程姿态。 */
export type SingAreaMode = 'off' | 'wrist'
export type ConfigurationMonitoringMode = 'on' | 'off'

/** ProgramExecutor 持有的一个标量变量快照；名称在调用方按 RAPID 规则归一化。 */
export type RapidScalarVariable = { kind: 'num'; value: number } | { kind: 'bool'; value: boolean }

/** 已解析的 MoveJ 指令；执行器只消费结构化值，不查询 UI 状态。 */
export interface StructuredMoveJ {
  kind: 'movej'
  target: RobTarget
  speed: SpeedData
  zone: ZoneData
  tool: ToolData
  wobj: WobjData
  confJ?: ConfigurationMonitoringMode
}

/** 已解析的 MoveL 指令；目标坐标和工具/工件数据已经在 parser 结果中固定。 */
export interface StructuredMoveL {
  kind: 'movel'
  target: RobTarget
  speed: SpeedData
  zone: ZoneData
  tool: ToolData
  wobj: WobjData
  /** 当前生效的 SingArea 模式；未提供时按 ABB 默认 `\\Off`。 */
  singArea?: SingAreaMode
  confL?: ConfigurationMonitoringMode
}

/**
 * 已解析的 MoveC 圆弧运动指令：TCP 从当前位置经 cirPoint 到 target。
 * 三点确定圆弧；速度、zone、工具和工件数据与 MoveL 语义一致。
 */
export interface StructuredMoveC {
  kind: 'movec'
  /** 圆弧途经点（CirPoint）。 */
  cirPoint: RobTarget
  /** 圆弧终点（ToPoint）。 */
  target: RobTarget
  speed: SpeedData
  zone: ZoneData
  tool: ToolData
  wobj: WobjData
  /** 当前生效的 SingArea 模式；未提供时按 ABB 默认 `\\Off`。 */
  singArea?: SingAreaMode
  confL?: ConfigurationMonitoringMode
}

export type StructuredMotionInstruction = StructuredMoveJ | StructuredMoveL | StructuredMoveC
