/**
 * 领域层 ABB RAPID 结构化数据类型；不依赖 Vue、Three.js 或具体页面。
 *
 * 本模块只描述已解析、引用已解析成值的结构化指令，不处理 RAPID 文本、
 * 变量查找或 AST。未来 parser 负责把符号引用解析到这些值。
 */

/**
 * ABB RAPID 四元数记录形状：[q1, q2, q3, q4]。
 * q1 是标量 w，q2 是 x，q3 是 y，q4 是 z；单位四元数是 [1, 0, 0, 0]。
 * 这与机器人核心数学模块（rotation3d）内部使用的 [x, y, z, w] 顺序不同，
 * 在 RAPID → Pose 的 seam 中显式转换，禁止让数学模块猜测两种顺序。
 */
export type RapidQuat = [number, number, number, number]

/** 单位 RAPID 四元数（无旋转）：[q1,q2,q3,q4] = [1,0,0,0]。 */
export const RAPID_UNIT_QUAT: RapidQuat = [1, 0, 0, 0]

/** ABB robtarget 配置值 [cf1, cf4, cf6, cfx]。 */
export type RobConf = [number, number, number, number]
/** 外部轴位置（e1..e6）；首期只支持六项均为 ABB“未使用”常量（9E9）。 */
export type ExtAx = [number, number, number, number, number, number]

/**
 * ABB 无外部轴的“未使用”常量：RAPID 用 9E9 表示轴未定义，而不是全零。
 * 将来 parser 解析出的 robtarget 若没有外部轴，extax 六项都应是这个值。
 */
export const NO_EXTERNAL_AXIS: ExtAx = [9e9, 9e9, 9e9, 9e9, 9e9, 9e9]

/** ABB robtarget：毫米单位 trans、四元数 rot、四项 robconf、六项 extax。 */
export interface RobTarget {
  trans: [number, number, number]
  /** ABB 顺序四元数 [q1,q2,q3,q4] = [w,x,y,z]（q1 是标量 w）。 */
  rot: RapidQuat
  robconf: RobConf
  extax: ExtAx
}

/** ABB speeddata：v_tcp(mm/s)、v_ori(°/s)、v_leax(mm/s)、v_reax(°/s)。 */
export interface SpeedData {
  v_tcp: number
  v_ori: number
  v_leax: number
  v_reax: number
}

/**
 * ABB zonedata：finep 与六个数值字段，字段名与 ABB 记录一致。
 * pzoneTcp/pzoneOri/pzoneEax 是停止点（TCP/姿态/外部轴）允差，
 * zoneOri/zoneLeax/zoneReax 是过渡区（姿态/线性/转轴）半径；首期只支持 finep=true。
 */
export interface ZoneData {
  finep: boolean
  pzoneTcp: number
  pzoneOri: number
  pzoneEax: number
  zoneOri: number
  zoneLeax: number
  zoneReax: number
}

/**
 * 工具/工件 frame 位姿：毫米 trans + ABB 顺序四元数 rot。
 * 曾用含义含糊的“度 frame”命名，现更名为更清晰的 RapidPose。
 */
export interface RapidPose {
  trans: [number, number, number]
  rot: RapidQuat
}

/** ABB 负载数据：质量、质心、惯性（aom 为 ABB 顺序四元数）与主惯量长度项。 */
export interface LoadData {
  mass: number
  cog: [number, number, number]
  aom: RapidQuat
  ix: number
  iy: number
  iz: number
}

/** ABB tooldata；tool0 是 robhold=true + 单位 tframe + 零负载的默认工具。 */
export interface ToolData {
  robhold: boolean
  tframe: RapidPose
  tload: LoadData
}

/** ABB wobjdata；wobj0 是 robhold=false + 空 ufmec + 用户/物体 frame 均单位的默认工件坐标。 */
export interface WobjData {
  robhold: boolean
  ufprog: boolean
  ufmec: string
  uframe: RapidPose
  oframe: RapidPose
}

/** 首期标量 RAPID 数据类型；用于模块级 VAR 声明、表达式和 Program Data 展示。 */
export type RapidScalarKind = 'num' | 'bool'

/** 标量声明的结构化初值；表达式树与执行期变量快照由 RAPID parser/executor 负责。 */
export type RapidScalarValue = number | boolean

/** ABB SingArea 腕部插补策略；默认 off 表示严格保持编程姿态。 */
export type SingAreaMode = 'off' | 'wrist'

/** ProgramExecutor 持有的一个标量变量快照；名称在调用方按 RAPID 规则归一化。 */
export type RapidScalarVariable = { kind: 'num'; value: number } | { kind: 'bool'; value: boolean }

/**
 * 结构化运动指令；MoveJ 与 MoveL 直接携带已解析的目标、速度、zone、工具和工件值。
 * 执行器不查询 UI 状态。
 */
export interface StructuredMoveJ {
  kind: 'movej'
  target: RobTarget
  speed: SpeedData
  zone: ZoneData
  tool: ToolData
  wobj: WobjData
}

export interface StructuredMoveL {
  kind: 'movel'
  target: RobTarget
  speed: SpeedData
  zone: ZoneData
  tool: ToolData
  wobj: WobjData
  /** 当前生效的 SingArea 模式；未提供时按 ABB 默认 `\\Off`。 */
  singArea?: SingAreaMode
}

/**
 * 结构化 MoveC 圆弧运动指令：TCP 从当前位置经 `cirPoint`（圆弧途经点）到 `target`（终点）。
 * 三点（当前 TCP / 圆点 / 终点）确定唯一圆弧；速度/zone/工具/工件与 MoveL 语义一致。
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
}

export type StructuredMotionInstruction = StructuredMoveJ | StructuredMoveL | StructuredMoveC

/**
 * 默认 tool0 —— 与 ABB 官方预定义 tool0 一致：
 * robhold=true、单位 tframe、tload 使用官方“零负载 epsilon”（质量 0.001kg、质心 [0,0,0.001]）。
 * 负载不影响当前 MoveJ/MoveL 运动学结果，故保留官方字面量以保持 Program Data 与真实 RAPID 一致。
 */
export function defaultTool0(): ToolData {
  return {
    robhold: true,
    tframe: { trans: [0, 0, 0], rot: [...RAPID_UNIT_QUAT] },
    tload: { mass: 0.001, cog: [0, 0, 0.001], aom: [...RAPID_UNIT_QUAT], ix: 0, iy: 0, iz: 0 },
  }
}

/**
 * 默认 wobj0 —— 与 ABB 官方预定义 wobj0 一致：robhold=false、ufprog=true、
 * 空 ufmec、用户/物体 frame 均单位变换（物体坐标系与机器人世界坐标系重合）。
 */
export function defaultWobj0(): WobjData {
  return {
    robhold: false,
    ufprog: true,
    ufmec: '',
    uframe: { trans: [0, 0, 0], rot: [...RAPID_UNIT_QUAT] },
    oframe: { trans: [0, 0, 0], rot: [...RAPID_UNIT_QUAT] },
  }
}

/** 默认 fine zone：finep=true，其余 zone 数值为 0。 */
export function defaultZoneFine(): ZoneData {
  return {
    finep: true,
    pzoneTcp: 0,
    pzoneOri: 0,
    pzoneEax: 0,
    zoneOri: 0,
    zoneLeax: 0,
    zoneReax: 0,
  }
}

function isIdentityPose(pose: RapidPose): boolean {
  return (
    pose.trans.every((value) => value === 0) &&
    pose.rot[0] === RAPID_UNIT_QUAT[0] &&
    pose.rot[1] === 0 &&
    pose.rot[2] === 0 &&
    pose.rot[3] === 0
  )
}

/** 是否为 ABB 官方 tool0/load0 的“零负载 epsilon”负载：0.001kg、质心 [0,0,0.001]、单位 aom、零主惯量长度项。 */
function isDefaultLoad(load: LoadData): boolean {
  return (
    load.mass === 0.001 &&
    load.cog[0] === 0 &&
    load.cog[1] === 0 &&
    load.cog[2] === 0.001 &&
    load.aom[0] === RAPID_UNIT_QUAT[0] &&
    load.aom[1] === 0 &&
    load.aom[2] === 0 &&
    load.aom[3] === 0 &&
    load.ix === 0 &&
    load.iy === 0 &&
    load.iz === 0
  )
}

/** 是否为默认 tool0（robhold=true、单位 tframe、官方零负载 epsilon）。 */
export function isDefaultTool0(tool: ToolData): boolean {
  return tool.robhold === true && isIdentityPose(tool.tframe) && isDefaultLoad(tool.tload)
}

/** 是否为默认 wobj0（robhold=false、ufprog=true、空 ufmec、两个 frame 均单位变换）。 */
export function isDefaultWobj0(wobj: WobjData): boolean {
  return (
    wobj.robhold === false &&
    wobj.ufprog === true &&
    wobj.ufmec === '' &&
    isIdentityPose(wobj.uframe) &&
    isIdentityPose(wobj.oframe)
  )
}

/**
 * ABB 官方“最大 TCP 速度”（vmax）占位值：vmax 的值依赖具体机器人型号（= 该型号 MaxRobSpeed），
 * 不是固定字面量。解析阶段用它占位登记名称；运行阶段（SpeedData 时长求值）需将其替换为
 * 当前机器人型号的最大 TCP 速度，见票据 04。
 */
export const MAX_ROB_SPEED_SENTINEL = Number.POSITIVE_INFINITY

/**
 * ABB RobotWare 官方预定义工具/负载/工件坐标。名称大小写不敏感、系统数据只读、源码不能重定义。
 */
export const SYSTEM_TOOLDATA: Readonly<Record<string, ToolData>> = {
  tool0: defaultTool0(),
}

export const SYSTEM_WOBJDATA: Readonly<Record<string, WobjData>> = {
  wobj0: defaultWobj0(),
}

export const SYSTEM_LOADDATA: Readonly<Record<string, LoadData>> = {
  load0: { mass: 0.001, cog: [0, 0, 0.001], aom: [...RAPID_UNIT_QUAT], ix: 0, iy: 0, iz: 0 },
}

/**
 * ABB RobotWare 官方预定义 speeddata（每个 TCP speed 的 v_ori=500°/s、v_leax=5000mm/s、v_reax=1000°/s）。
 * v_tcp 单位 mm/s；vmax 的 v_tcp 用 MAX_ROB_SPEED_SENTINEL 占位（依赖机器人型号，见票据 04）。
 */
const TCP_SPEED_VALUES: ReadonlyArray<readonly [string, number]> = [
  ['v5', 5],
  ['v10', 10],
  ['v20', 20],
  ['v30', 30],
  ['v40', 40],
  ['v50', 50],
  ['v60', 60],
  ['v80', 80],
  ['v100', 100],
  ['v150', 150],
  ['v200', 200],
  ['v300', 300],
  ['v400', 400],
  ['v500', 500],
  ['v600', 600],
  ['v800', 800],
  ['v1000', 1000],
  ['v1500', 1500],
  ['v2000', 2000],
  ['v2500', 2500],
  ['v3000', 3000],
  ['v4000', 4000],
  ['v5000', 5000],
  ['v6000', 6000],
  ['v7000', 7000],
]

const commonSpeed: SpeedData = { v_tcp: 0, v_ori: 500, v_leax: 5000, v_reax: 1000 }

export const SYSTEM_SPEED: Readonly<Record<string, SpeedData>> = {
  ...Object.fromEntries(
    TCP_SPEED_VALUES.map(([name, vTcp]) => [name, { ...commonSpeed, v_tcp: vTcp }]),
  ),
  vmax: { ...commonSpeed, v_tcp: MAX_ROB_SPEED_SENTINEL },
}

/**
 * ABB RobotWare 官方预定义 zonedata（fine + fly-by 各档）。
 * 结构 [finep, pzoneTcp, pzoneOri, pzoneEax, zoneOri, zoneLeax, zoneReax]：
 * pzone* 为停点允差(mm)，zone* 为过渡区半径（zoneOri/zoneReax 单位 °，zoneLeax 单位 mm）。
 * 当前 MVP 仅 fine 作为精确停点执行；各 fly-by 档识别为“已识别、未模拟路径融合”（见票据 04）。
 */
const ZONE_TABLE: ReadonlyArray<
  readonly [string, false, number, number, number, number, number, number]
> = [
  ['z0', false, 0.3, 0.3, 0.3, 0.03, 0.3, 0.03],
  ['z1', false, 1, 1, 1, 0.1, 1, 0.1],
  ['z5', false, 5, 8, 8, 0.8, 8, 0.8],
  ['z10', false, 10, 15, 15, 1.5, 15, 1.5],
  ['z15', false, 15, 23, 23, 2.3, 23, 2.3],
  ['z20', false, 20, 30, 30, 3.0, 30, 3.0],
  ['z30', false, 30, 45, 45, 4.5, 45, 4.5],
  ['z40', false, 40, 60, 60, 6.0, 60, 6.0],
  ['z50', false, 50, 75, 75, 7.5, 75, 7.5],
  ['z60', false, 60, 90, 90, 9.0, 90, 9.0],
  ['z80', false, 80, 120, 120, 12, 120, 12],
  ['z100', false, 100, 150, 150, 15, 150, 15],
  ['z150', false, 150, 225, 225, 23, 225, 23],
  ['z200', false, 200, 300, 300, 30, 300, 30],
]

export const SYSTEM_ZONE: Readonly<Record<string, ZoneData>> = {
  fine: defaultZoneFine(),
  ...Object.fromEntries(
    ZONE_TABLE.map(([name, finep, pzoneTcp, pzoneOri, pzoneEax, zoneOri, zoneLeax, zoneReax]) => [
      name,
      { finep, pzoneTcp, pzoneOri, pzoneEax, zoneOri, zoneLeax, zoneReax },
    ]),
  ),
}
