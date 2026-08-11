/**
 * 领域层 ABB RAPID 结构化数据类型；不依赖 Vue、Three.js 或具体页面。
 *
 * 本模块只描述已解析、引用已解析成值的结构化指令，不处理 RAPID 文本、
 * 变量查找或 AST。未来 parser 负责把符号引用解析到这些值。
 */

/** ABB robtarget 配置值（cf1..cf4）。 */
export type RobConf = [number, number, number, number]
/** 外部轴位置（e1..e6）；首期只支持全零（无外部轴）。 */
export type ExtAx = [number, number, number, number, number, number]

/** ABB robtarget：毫米单位 trans、四元数 rot、四项 robconf、六项 extax。 */
export interface RobTarget {
  trans: [number, number, number]
  /** 四元数 (x, y, z, w)，标量 w 在最后；与 RAPID robtarget.rot 记录形状一致。 */
  rot: [number, number, number, number]
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

/** ABB zonedata：finep 与六个 zone 数值字段；首期只支持 finep=true。 */
export interface ZoneData {
  finep: boolean
  pzoneTcp: number
  pzoneOri: number
  zoneLeax: number
  zoneReax: number
  zone: number
  zoneRot: number
}

/** 工具/工件 frame 位姿：毫米 trans + 四元数 rot（标量在最后）。 */
export interface RapiDegreeFrame {
  trans: [number, number, number]
  rot: [number, number, number, number]
}

/** ABB 负载数据。 */
export interface LoadData {
  mass: number
  cog: [number, number, number]
  aom: [number, number, number]
}

/** ABB tooldata；tool0 是 robhold=true + 单位 frame + 零负载的默认工具。 */
export interface ToolData {
  robhold: boolean
  frame: RapiDegreeFrame
  tload: LoadData
}

/** ABB wobjdata；wobj0 是用户/物体 frame 均为单位变换的默认工件坐标。 */
export interface WobjData {
  robhold: boolean
  ufprog: boolean
  uMecRot: [number, number, number, number]
  uframe: RapiDegreeFrame
  oframe: RapiDegreeFrame
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

/** 默认 tool0：robhold=true、单位 frame、零负载。 */
export function defaultTool0(): ToolData {
  return {
    robhold: true,
    frame: { trans: [0, 0, 0], rot: [0, 0, 0, 1] },
    tload: { mass: 0, cog: [0, 0, 0], aom: [0, 0, 0] },
  }
}

/** 默认 wobj0：robhold=false、ufprog=false、用户/物体 frame 均为单位变换。 */
export function defaultWobj0(): WobjData {
  return {
    robhold: false,
    ufprog: false,
    uMecRot: [0, 0, 0, 1],
    uframe: { trans: [0, 0, 0], rot: [0, 0, 0, 1] },
    oframe: { trans: [0, 0, 0], rot: [0, 0, 0, 1] },
  }
}

/** 默认 fine zone：finep=true，其余 zone 数值为 0。 */
export function defaultZoneFine(): ZoneData {
  return {
    finep: true,
    pzoneTcp: 0,
    pzoneOri: 0,
    zoneLeax: 0,
    zoneReax: 0,
    zone: 0,
    zoneRot: 0,
  }
}

function isIdentityFrame(frame: RapiDegreeFrame): boolean {
  return (
    frame.trans.every((value) => value === 0) &&
    frame.rot[0] === 0 &&
    frame.rot[1] === 0 &&
    frame.rot[2] === 0 &&
    frame.rot[3] === 1
  )
}

/** 是否为默认 tool0（robhold=true、单位 frame、零负载）。 */
export function isDefaultTool0(tool: ToolData): boolean {
  return (
    tool.robhold === true &&
    isIdentityFrame(tool.frame) &&
    tool.tload.mass === 0 &&
    tool.tload.cog.every((value) => value === 0) &&
    tool.tload.aom.every((value) => value === 0)
  )
}

/** 是否为默认 wobj0（robhold=false、ufprog=false、两个 frame 均单位变换）。 */
export function isDefaultWobj0(wobj: WobjData): boolean {
  return (
    wobj.robhold === false &&
    wobj.ufprog === false &&
    isIdentityFrame(wobj.uframe) &&
    isIdentityFrame(wobj.oframe)
  )
}
