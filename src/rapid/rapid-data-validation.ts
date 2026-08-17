import type {
  LoadData,
  RapidPose,
  RobTarget,
  SpeedData,
  ToolData,
  WobjData,
  ZoneData,
} from './rapid-types.ts'
import type { RapidDataKind, SymbolEntry } from './rapid-symbols.ts'
import { isSymbol, normalizeName } from './rapid-symbols.ts'
import type { Token } from './rapid-lexer.ts'
import type { RapidDiagnosticCode } from './rapid-diagnostics.ts'

/**
 * 静态数据校验：解析模块级声明的各类数据记录字面量（robtarget/tooldata/
 * wobjdata/loaddata/speeddata/zonedata 与 num/bool 初值）。
 *
 * 本模块是“深处实现”：对外只暴露 parseDataValue 与 parseFiniteNumber 两个函数，
 * 内部隐藏了四元数、位姿、工具、工件、速度、zone 等记录语法的全部细节。
 * 它通过 DataValidationContext 获取自身所需的游标访问与诊断发射，不持有解析状态。
 */

/** 数据值解析所需的解析器上下文；由 parser 以既有闭包实现。 */
export interface DataValidationContext {
  current(): Token
  advance(): Token
  expectSymbol(symbol: string): Token | null
  addDiagnostic(code: RapidDiagnosticCode, message: string, token?: Token): void
  addMissingDiagnostic(code: RapidDiagnosticCode, message: string, token?: Token): void
}

/**
 * RAPID 四元数应为单位长度；长度偏离 1 超过该容差即按非法数据处理（票据 01：非归一化四元数精确诊断）。
 */
const QUAT_NORM_TOLERANCE = 1e-3

/** 读取一个有限数值（可带独立正负号）token，非有限或缺失返回 null。 */
export function parseFiniteNumber(ctx: DataValidationContext, fieldName: string): number | null {
  let sign = ''
  if (isSymbol(ctx.current(), '+') || isSymbol(ctx.current(), '-')) sign = ctx.advance().text
  if (ctx.current().kind !== 'number') {
    ctx.addMissingDiagnostic('invalid-data', `${fieldName} 必须是数字`, ctx.current())
    // 非分隔符的非法值属于当前字段，主动消费它；否则后续字段会在同一 token 上重复报错。
    if (
      ctx.current().kind !== 'eof' &&
      !isSymbol(ctx.current(), ',') &&
      !isSymbol(ctx.current(), ']') &&
      !isSymbol(ctx.current(), ')') &&
      !isSymbol(ctx.current(), ';')
    ) {
      ctx.advance()
    }
    return null
  }
  const token = ctx.advance()
  const value = Number(`${sign}${token.text}`)
  if (!Number.isFinite(value)) {
    ctx.addDiagnostic('invalid-data', `${fieldName} 包含非有限数字`, token)
    return null
  }
  return value
}

/** 读取一个 RAPID 布尔（TRUE/FALSE），非法或无返回 null。 */
function parseBool(ctx: DataValidationContext, fieldName: string): boolean | null {
  if (ctx.current().kind !== 'identifier') {
    ctx.addMissingDiagnostic('invalid-data', `${fieldName} 必须是 TRUE/FALSE`, ctx.current())
    return null
  }
  const token = ctx.advance()
  const name = normalizeName(token.text)
  if (name === 'true') return true
  if (name === 'false') return false
  ctx.addDiagnostic('invalid-data', `${fieldName} 必须是 TRUE/FALSE`, token)
  return null
}

/** 读取一个双引号字符串字面量；返回去掉引号的内容，缺失返回 null。 */
function parseStringValue(ctx: DataValidationContext, fieldName: string): string | null {
  if (ctx.current().kind !== 'string') {
    ctx.addMissingDiagnostic('invalid-data', `${fieldName} 必须是字符串`, ctx.current())
    return null
  }
  const token = ctx.advance()
  return token.text.slice(1, -1)
}

function parseTuple(
  ctx: DataValidationContext,
  expectedLength: number,
  fieldName: string,
): number[] | null {
  const open = ctx.expectSymbol('[')
  if (!open) return null
  const values: number[] = []
  let malformed = false
  while (ctx.current().kind !== 'eof' && !isSymbol(ctx.current(), ']')) {
    const value = parseFiniteNumber(ctx, fieldName)
    if (value === null) {
      malformed = true
      // parseFiniteNumber 对逗号、右括号等边界不消费当前 token；恢复必须主动前进，避免死循环。
      if (
        !isSymbol(ctx.current(), ',') &&
        !isSymbol(ctx.current(), ']') &&
        ctx.current().kind !== 'eof'
      )
        ctx.advance()
    } else {
      values.push(value)
    }

    if (isSymbol(ctx.current(), ',')) {
      ctx.advance()
      if (isSymbol(ctx.current(), ']')) {
        ctx.addDiagnostic('invalid-data', `${fieldName} 不允许尾逗号`, ctx.current())
        malformed = true
      }
    } else if (!isSymbol(ctx.current(), ']')) {
      ctx.addDiagnostic('syntax-error', `${fieldName} 数字之间必须使用逗号`, ctx.current())
      malformed = true
      while (
        ctx.current().kind !== 'eof' &&
        !isSymbol(ctx.current(), ',') &&
        !isSymbol(ctx.current(), ']')
      ) {
        ctx.advance()
      }
      if (isSymbol(ctx.current(), ',')) ctx.advance()
    }
  }
  ctx.expectSymbol(']')
  if (values.length !== expectedLength) {
    ctx.addDiagnostic('invalid-data', `${fieldName} 长度必须为 ${expectedLength}`, open)
    malformed = true
  }
  return malformed ? null : values
}

/** 解析一个长度接近 1 的四元数 tuple；长度偏离时给出 invalid-data 诊断并返回 null。 */
function parseUnitQuat(ctx: DataValidationContext, fieldName: string): number[] | null {
  const quat = parseTuple(ctx, 4, fieldName)
  if (!quat) return null
  const norm = Math.hypot(...quat)
  if (Math.abs(norm - 1) > QUAT_NORM_TOLERANCE) {
    ctx.addDiagnostic('invalid-data', `${fieldName} 四元数未归一化（长度 ${norm.toFixed(4)}）`)
    return null
  }
  return quat
}

function parseRobTarget(ctx: DataValidationContext): RobTarget | null {
  const open = ctx.expectSymbol('[')
  if (!open) return null
  const trans = parseTuple(ctx, 3, 'robtarget.trans')
  ctx.expectSymbol(',')
  const rot = parseUnitQuat(ctx, 'robtarget.rot')
  ctx.expectSymbol(',')
  const robconf = parseTuple(ctx, 4, 'robtarget.robconf')
  ctx.expectSymbol(',')
  const extax = parseTuple(ctx, 6, 'robtarget.extax')
  ctx.expectSymbol(']')
  if (!trans || !rot || !robconf || !extax) return null
  return {
    trans: trans as RobTarget['trans'],
    rot: rot as RobTarget['rot'],
    robconf: robconf as RobTarget['robconf'],
    extax: extax as RobTarget['extax'],
  }
}

/** 解析 `[[x,y,z],[q1,q2,q3,q4]]` 位姿记录（tooldata.tframe / wobj frame）。 */
function parsePose(ctx: DataValidationContext, fieldName: string): RapidPose | null {
  const open = ctx.expectSymbol('[')
  if (!open) return null
  const trans = parseTuple(ctx, 3, `${fieldName}.trans`)
  ctx.expectSymbol(',')
  const rot = parseUnitQuat(ctx, `${fieldName}.rot`)
  ctx.expectSymbol(']')
  if (!trans || !rot) return null
  return { trans: trans as RapidPose['trans'], rot: rot as RapidPose['rot'] }
}

/** 解析 `[mass, [cog], [aom], ix, iy, iz]` 负载记录。 */
function parseLoadData(ctx: DataValidationContext): LoadData | null {
  const open = ctx.expectSymbol('[')
  if (!open) return null
  const mass = parseFiniteNumber(ctx, 'loaddata.mass')
  ctx.expectSymbol(',')
  const cog = parseTuple(ctx, 3, 'loaddata.cog')
  ctx.expectSymbol(',')
  const aom = parseUnitQuat(ctx, 'loaddata.aom')
  ctx.expectSymbol(',')
  const ix = parseFiniteNumber(ctx, 'loaddata.ix')
  ctx.expectSymbol(',')
  const iy = parseFiniteNumber(ctx, 'loaddata.iy')
  ctx.expectSymbol(',')
  const iz = parseFiniteNumber(ctx, 'loaddata.iz')
  ctx.expectSymbol(']')
  if (mass === null || !cog || !aom || ix === null || iy === null || iz === null) return null
  return {
    mass,
    cog: cog as LoadData['cog'],
    aom: aom as LoadData['aom'],
    ix,
    iy,
    iz,
  }
}

/** 解析 `[robhold, tframe(pose), tload(loaddata)]` 工具记录。 */
function parseToolData(ctx: DataValidationContext): ToolData | null {
  const open = ctx.expectSymbol('[')
  if (!open) return null
  const robhold = parseBool(ctx, 'tooldata.robhold')
  ctx.expectSymbol(',')
  const tframe = parsePose(ctx, 'tooldata.tframe')
  ctx.expectSymbol(',')
  const tload = parseLoadData(ctx)
  ctx.expectSymbol(']')
  if (robhold === null || !tframe || !tload) return null
  return { robhold, tframe, tload }
}

/** 解析 `[robhold, ufprog, ufmec, uframe(pose), oframe(pose)]` 工件坐标记录。 */
function parseWobjData(ctx: DataValidationContext): WobjData | null {
  const open = ctx.expectSymbol('[')
  if (!open) return null
  const robhold = parseBool(ctx, 'wobjdata.robhold')
  ctx.expectSymbol(',')
  const ufprog = parseBool(ctx, 'wobjdata.ufprog')
  ctx.expectSymbol(',')
  const ufmec = parseStringValue(ctx, 'wobjdata.ufmec')
  ctx.expectSymbol(',')
  const uframe = parsePose(ctx, 'wobjdata.uframe')
  ctx.expectSymbol(',')
  const oframe = parsePose(ctx, 'wobjdata.oframe')
  ctx.expectSymbol(']')
  if (robhold === null || ufprog === null || ufmec === null || !uframe || !oframe) return null
  return { robhold, ufprog, ufmec, uframe, oframe }
}

/** 解析 `[v_tcp, v_ori, v_leax, v_reax]` 速度记录。 */
function parseSpeedValue(ctx: DataValidationContext): SpeedData | null {
  const open = ctx.expectSymbol('[')
  if (!open) return null
  const v_tcp = parseFiniteNumber(ctx, 'speeddata.v_tcp')
  ctx.expectSymbol(',')
  const v_ori = parseFiniteNumber(ctx, 'speeddata.v_ori')
  ctx.expectSymbol(',')
  const v_leax = parseFiniteNumber(ctx, 'speeddata.v_leax')
  ctx.expectSymbol(',')
  const v_reax = parseFiniteNumber(ctx, 'speeddata.v_reax')
  ctx.expectSymbol(']')
  if (v_tcp === null || v_ori === null || v_leax === null || v_reax === null) return null
  return { v_tcp, v_ori, v_leax, v_reax }
}

/** 解析 `[finep, pzoneTcp, pzoneOri, pzoneEax, zoneOri, zoneLeax, zoneReax]` 区域记录。 */
function parseZoneValue(ctx: DataValidationContext): ZoneData | null {
  const open = ctx.expectSymbol('[')
  if (!open) return null
  const finep = parseBool(ctx, 'zonedata.finep')
  ctx.expectSymbol(',')
  const pzoneTcp = parseFiniteNumber(ctx, 'zonedata.pzone_tcp')
  ctx.expectSymbol(',')
  const pzoneOri = parseFiniteNumber(ctx, 'zonedata.pzone_ori')
  ctx.expectSymbol(',')
  const pzoneEax = parseFiniteNumber(ctx, 'zonedata.pzone_eax')
  ctx.expectSymbol(',')
  const zoneOri = parseFiniteNumber(ctx, 'zonedata.zone_ori')
  ctx.expectSymbol(',')
  const zoneLeax = parseFiniteNumber(ctx, 'zonedata.zone_leax')
  ctx.expectSymbol(',')
  const zoneReax = parseFiniteNumber(ctx, 'zonedata.zone_reax')
  ctx.expectSymbol(']')
  if (
    finep === null ||
    pzoneTcp === null ||
    pzoneOri === null ||
    pzoneEax === null ||
    zoneOri === null ||
    zoneLeax === null ||
    zoneReax === null
  ) {
    return null
  }
  return { finep, pzoneTcp, pzoneOri, pzoneEax, zoneOri, zoneLeax, zoneReax }
}

/** 按数据种类解析声明值字面量；返回对齐 kind 的 {kind, value} 载荷，失败（含畸形值）返回 null。 */
export function parseDataValue(
  ctx: DataValidationContext,
  kind: RapidDataKind,
): SymbolEntry['value'] | null {
  switch (kind) {
    case 'robtarget': {
      const target = parseRobTarget(ctx)
      if (!target) return null
      return { kind: 'robtarget', value: target }
    }
    case 'tooldata': {
      const value = parseToolData(ctx)
      if (!value) return null
      return { kind: 'tooldata', value }
    }
    case 'wobjdata': {
      const value = parseWobjData(ctx)
      if (!value) return null
      return { kind: 'wobjdata', value }
    }
    case 'loaddata': {
      const value = parseLoadData(ctx)
      if (!value) return null
      return { kind: 'loaddata', value }
    }
    case 'speeddata': {
      const value = parseSpeedValue(ctx)
      if (!value) return null
      return { kind: 'speeddata', value }
    }
    case 'zonedata': {
      const value = parseZoneValue(ctx)
      if (!value) return null
      return { kind: 'zonedata', value }
    }
    case 'num': {
      const value = parseFiniteNumber(ctx, 'num 初值')
      return value === null ? null : { kind: 'num', value }
    }
    case 'bool': {
      const value = parseBool(ctx, 'bool 初值')
      return value === null ? null : { kind: 'bool', value }
    }
    default:
      return null
  }
}
