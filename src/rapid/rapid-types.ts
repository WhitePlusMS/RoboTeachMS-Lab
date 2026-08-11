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
}

export type StructuredMotionInstruction = StructuredMoveJ | StructuredMoveL

/** 默认 tool0：robhold=true、单位 tframe、零负载（含主惯量 ix/iy/iz）。 */
export function defaultTool0(): ToolData {
  return {
    robhold: true,
    tframe: { trans: [0, 0, 0], rot: [...RAPID_UNIT_QUAT] },
    tload: { mass: 0, cog: [0, 0, 0], aom: [...RAPID_UNIT_QUAT], ix: 0, iy: 0, iz: 0 },
  }
}

/** 默认 wobj0：robhold=false、ufprog=false、空 ufmec、用户/物体 frame 均单位变换。 */
export function defaultWobj0(): WobjData {
  return {
    robhold: false,
    ufprog: false,
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

/** 负载是否为“零惯性负载”：零质量、零质心、单位 aom、零主惯量长度项。 */
function isDefaultLoad(load: LoadData): boolean {
  return (
    load.mass === 0 &&
    load.cog.every((value) => value === 0) &&
    load.aom[0] === RAPID_UNIT_QUAT[0] &&
    load.aom[1] === 0 &&
    load.aom[2] === 0 &&
    load.aom[3] === 0 &&
    load.ix === 0 &&
    load.iy === 0 &&
    load.iz === 0
  )
}

/** 是否为默认 tool0（robhold=true、单位 tframe、零负载含主惯量）。 */
export function isDefaultTool0(tool: ToolData): boolean {
  return tool.robhold === true && isIdentityPose(tool.tframe) && isDefaultLoad(tool.tload)
}

/** 是否为默认 wobj0（robhold=false、ufprog=false、空 ufmec、两个 frame 均单位变换）。 */
export function isDefaultWobj0(wobj: WobjData): boolean {
  return (
    wobj.robhold === false &&
    wobj.ufprog === false &&
    wobj.ufmec === '' &&
    isIdentityPose(wobj.uframe) &&
    isIdentityPose(wobj.oframe)
  )
}
