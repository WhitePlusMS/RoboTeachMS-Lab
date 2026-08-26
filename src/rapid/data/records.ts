/**
 * RAPID 的厂家数据记录类型。
 *
 * 本模块只描述 robtarget、tooldata、wobjdata、speeddata 等记录，不包含
 * 系统默认值、结构化运动指令或文本解析逻辑。
 */

/** ABB RAPID 四元数 [q1,q2,q3,q4]，其中 q1 是标量 w。 */
export type RapidQuat = [number, number, number, number]

/** 单位 RAPID 四元数（无旋转）。 */
export const RAPID_UNIT_QUAT: RapidQuat = [1, 0, 0, 0]

/** ABB robtarget 配置值 [cf1, cf4, cf6, cfx]。 */
export type RobConf = [number, number, number, number]

/** 外部轴位置（e1..e6）；首期只支持六项均为 ABB 未使用常量。 */
export type ExtAx = [number, number, number, number, number, number]

/** ABB 无外部轴的“未使用”常量。 */
export const NO_EXTERNAL_AXIS: ExtAx = [9e9, 9e9, 9e9, 9e9, 9e9, 9e9]

/** ABB robtarget：毫米单位 trans、四元数 rot、四项 robconf、六项 extax。 */
export interface RobTarget {
  trans: [number, number, number]
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

/** ABB zonedata：finep 与六个数值字段。 */
export interface ZoneData {
  finep: boolean
  pzoneTcp: number
  pzoneOri: number
  pzoneEax: number
  zoneOri: number
  zoneLeax: number
  zoneReax: number
}

/** 工具/工件 frame 位姿：毫米 trans + ABB 顺序四元数 rot。 */
export interface RapidPose {
  trans: [number, number, number]
  rot: RapidQuat
}

/** ABB 负载数据：质量、质心、惯性和主惯量长度项。 */
export interface LoadData {
  mass: number
  cog: [number, number, number]
  aom: RapidQuat
  ix: number
  iy: number
  iz: number
}

/** ABB tooldata。 */
export interface ToolData {
  robhold: boolean
  tframe: RapidPose
  tload: LoadData
}

/** ABB wobjdata。 */
export interface WobjData {
  robhold: boolean
  ufprog: boolean
  ufmec: string
  uframe: RapidPose
  oframe: RapidPose
}
