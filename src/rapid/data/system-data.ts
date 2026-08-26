import {
  RAPID_UNIT_QUAT,
  type LoadData,
  type RapidPose,
  type SpeedData,
  type ToolData,
  type WobjData,
  type ZoneData,
} from './records.ts'

/** 默认 tool0：官方零负载 epsilon，保留 RAPID 字面语义。 */
export function defaultTool0(): ToolData {
  return {
    robhold: true,
    tframe: { trans: [0, 0, 0], rot: [...RAPID_UNIT_QUAT] },
    tload: { mass: 0.001, cog: [0, 0, 0.001], aom: [...RAPID_UNIT_QUAT], ix: 0, iy: 0, iz: 0 },
  }
}

/** 默认 wobj0：用户坐标系和物体坐标系与机器人基座重合。 */
export function defaultWobj0(): WobjData {
  return {
    robhold: false,
    ufprog: true,
    ufmec: '',
    uframe: { trans: [0, 0, 0], rot: [...RAPID_UNIT_QUAT] },
    oframe: { trans: [0, 0, 0], rot: [...RAPID_UNIT_QUAT] },
  }
}

/** 默认 fine zone：精确停点，其余过渡字段为零。 */
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

export function isDefaultTool0(tool: ToolData): boolean {
  return tool.robhold === true && isIdentityPose(tool.tframe) && isDefaultLoad(tool.tload)
}

export function isDefaultWobj0(wobj: WobjData): boolean {
  return (
    wobj.robhold === false &&
    wobj.ufprog === true &&
    wobj.ufmec === '' &&
    isIdentityPose(wobj.uframe) &&
    isIdentityPose(wobj.oframe)
  )
}

/** `vmax` 的模型相关占位值；运行阶段由具体机器人最大 TCP 速度替换。 */
export const MAX_ROB_SPEED_SENTINEL = Number.POSITIVE_INFINITY

export const SYSTEM_TOOLDATA: Readonly<Record<string, ToolData>> = {
  tool0: defaultTool0(),
}

export const SYSTEM_WOBJDATA: Readonly<Record<string, WobjData>> = {
  wobj0: defaultWobj0(),
}

export const SYSTEM_LOADDATA: Readonly<Record<string, LoadData>> = {
  load0: { mass: 0.001, cog: [0, 0, 0.001], aom: [...RAPID_UNIT_QUAT], ix: 0, iy: 0, iz: 0 },
}

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
