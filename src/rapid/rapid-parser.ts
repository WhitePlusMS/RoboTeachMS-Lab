import type {
  LoadData,
  RapidPose,
  RobTarget,
  SpeedData,
  StructuredMotionInstruction,
  ToolData,
  WobjData,
  ZoneData,
} from './rapid-types.ts'
import {
  SYSTEM_LOADDATA,
  SYSTEM_SPEED,
  SYSTEM_TOOLDATA,
  SYSTEM_WOBJDATA,
  SYSTEM_ZONE,
} from './rapid-types.ts'
import { offsRobTarget, relToolRobTarget } from './target-expression.ts'

/** RAPID 源码中的一维位置；行列均从 1 开始，offset 从 0 开始。 */
export interface RapidSourcePosition {
  offset: number
  line: number
  column: number
}

/** 诊断覆盖的源码范围，end 为排他位置。 */
export interface RapidSourceRange {
  start: RapidSourcePosition
  end: RapidSourcePosition
}

export type RapidDiagnosticCode =
  | 'lexical-error'
  | 'syntax-error'
  | 'unsupported-syntax'
  | 'unsupported-option'
  | 'duplicate-symbol'
  | 'undefined-symbol'
  | 'invalid-data'
  | 'missing-module'
  | 'missing-entrypoint'

export interface RapidDiagnostic {
  code: RapidDiagnosticCode
  severity: 'error'
  message: string
  range: RapidSourceRange
}

/** 解析后交给 ProgramExecutor 的指令；源码范围用于回溯运行时规划错误，操作数名保留原始拼写。 */
export type RapidExecutableInstruction = StructuredMotionInstruction & {
  sourceRange: RapidSourceRange
  sourceText: string
  /** 运动操作数标识符（原始拼写），供结构化指令摘要展示，组件不另行解析 RAPID 字符串。 */
  operands: {
    target: string
    speed: string
    zone: string
    tool: string
    wobj: string
  }
  /** 每个运动操作数的精确源码范围，供诊断、编辑器标记与教学回溯使用。 */
  operandRanges: {
    target: RapidSourceRange
    speed: RapidSourceRange
    zone: RapidSourceRange
    tool: RapidSourceRange
    wobj: RapidSourceRange | null
  }
}

/** main 内可插入一条新运动的合法锚点；index 表示插入到第几条现有运动之前。 */
export interface RapidMotionInsertionPoint {
  index: number
  offset: number
  line: number
}

export interface RapidParseResult {
  /** 仅在没有 error 时可执行；存在 error 时返回空数组，防止误启动部分程序。 */
  program: readonly RapidExecutableInstruction[]
  diagnostics: readonly RapidDiagnostic[]
  canExecute: boolean
  /** 模块级命名数据的派生 Program Data 视图：robtarget/tooldata/wobjdata/loaddata/speeddata/zonedata；来自同一次解析，无第二份状态。 */
  data: readonly RapidProgramData[]
  /** 新模块级声明的插入偏移（位于 main PROC 之前）。 */
  dataInsertOffset: number
  /** main 内所有合法插入位置，最后一项表示追加到程序末尾。 */
  motionInsertionPoints: readonly RapidMotionInsertionPoint[]
}

/** Program Data 数据种类：六类已支持的 ABB 模块级运动数据记录。 */
export type RapidDataKind =
  | 'robtarget'
  | 'tooldata'
  | 'wobjdata'
  | 'loaddata'
  | 'speeddata'
  | 'zonedata'

/** Program Data 条目通用元数据，携带源码范围与声明类别。 */
interface RapidProgramDataBase {
  name: string
  storage: 'const' | 'pers' | 'var'
  /** 是否为系统预定义只读数据（tool0/wobj0/load0/官方 speed/zone）；系统数据不可被源码重定义。 */
  system: boolean
  /** 完整声明语句范围（自存储关键字到分号，含行内尾随内容）。 */
  declarationRange: RapidSourceRange
  /** 声明名在源码中的范围，供受控编辑与 PP 映射使用。 */
  nameRange: RapidSourceRange
  /** 声明值字面量 `[[...]]` 的范围，供 Modify Position 替换。 */
  valueRange: RapidSourceRange
  /** 每条 MoveJ/MoveL 操作数中引用该名称的源码范围。 */
  referenceRanges: readonly RapidSourceRange[]
}

/**
 * Program Data 条目：按 kind 区分六类数据，携带各自结构化值。系统预定义项（system=true）
 * 的 nameRange/valueRange/declarationRange 为源码中的空范围（不存在于源码中）。
 */
export type RapidProgramData =
  | (RapidProgramDataBase & { kind: 'robtarget'; target: RobTarget })
  | (RapidProgramDataBase & { kind: 'tooldata'; value: ToolData })
  | (RapidProgramDataBase & { kind: 'wobjdata'; value: WobjData })
  | (RapidProgramDataBase & { kind: 'loaddata'; value: LoadData })
  | (RapidProgramDataBase & { kind: 'speeddata'; value: SpeedData })
  | (RapidProgramDataBase & { kind: 'zonedata'; value: ZoneData })

/** robtarget 类型的 Program Data 条目（供点位示教/插件依赖的最小稳定视图）。 */
export type RapidProgramDataTarget = Extract<RapidProgramData, { kind: 'robtarget' }>

/** 类型守卫：从 data 联合中筛选出 robtarget 条目。 */
export function isRobtargetProgramData(data: RapidProgramData): data is RapidProgramDataTarget {
  return data.kind === 'robtarget'
}

type TokenKind = 'identifier' | 'number' | 'string' | 'symbol' | 'eof'

interface Token {
  kind: TokenKind
  text: string
  start: number
  end: number
}

/** 目标操作数意图：普通命名 robtarget，或 Offs()/RelTool() 目标表达式（基准必须为命名 robtarget）。 */
interface PendingTarget {
  kind: 'name' | 'offs' | 'reltool'
  /** 基准目标名称（普通名称时即该名）。 */
  baseName: string
  baseToken: Token
  /** Offs/RelTool 的数值参数。 */
  dx?: number
  dy?: number
  dz?: number
  rx?: number
  ry?: number
  rz?: number
  /** 整个目标操作数的源码范围与文本（用于 operandRanges / operands.target）。 */
  range: RapidSourceRange
  sourceText: string
}

interface PendingMotion {
  kind: 'movej' | 'movel'
  target: PendingTarget
  speedName: string
  speedToken: Token
  zoneName: string
  zoneToken: Token
  toolName: string
  toolToken: Token
  wobjName: string
  wobjToken: Token | null
  range: RapidSourceRange
  sourceText: string
}

interface OperandSlotResult {
  token: Token | null
  separatorConsumed: boolean
}

/** 运动操作数角色；引用结算与未定义诊断按角色分发到对应的符号命名空间。 */
type OperandKind = 'target' | 'speed' | 'zone' | 'tool' | 'wobj'

interface SymbolEntry {
  kind: RapidDataKind
  /** 已解析的声明值；robtarget 用 target，其余用 value。 */
  value:
    | { kind: 'robtarget'; value: RobTarget }
    | { kind: 'tooldata'; value: ToolData }
    | { kind: 'wobjdata'; value: WobjData }
    | { kind: 'loaddata'; value: LoadData }
    | { kind: 'speeddata'; value: SpeedData }
    | { kind: 'zonedata'; value: ZoneData }
  /** 声明的名称范围。 */
  range: RapidSourceRange
  /** 完整声明语句范围（自存储关键字到分号）。 */
  declarationRange: RapidSourceRange
  /** 声明值字面量范围。 */
  valueRange: RapidSourceRange
  storage: 'const' | 'pers' | 'var'
  /** 各条运动指令操作数中引用该名称的源码范围。 */
  references: RapidSourceRange[]
}

const NUMBER_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/

/**
 * 真实 RAPID 数据类型中本项目尚未支持的类型名。用于区分“漏写数据类型”
 * （后面跟的是名称）与“使用了已知但不支持的类型”（num/bool 等）。
 * 六类已支持的运动数据类型（robtarget/tooldata/wobjdata/loaddata/speeddata/zonedata）不在此列。
 */
const KNOWN_UNSUPPORTED_TYPES = new Set([
  'num',
  'bool',
  'string',
  'int',
  'intnum',
  'dnum',
  'byte',
  'word',
  'clock',
  'errstr',
  'jointtarget',
  'signalai',
  'signaldi',
  'signalao',
  'signaldo',
  'signalgi',
  'signalgo',
])

/** 已支持的数据种类名 → kind，用于模块级声明分发。 */
const SUPPORTED_DATA_KINDS: Record<string, RapidDataKind> = {
  robtarget: 'robtarget',
  tooldata: 'tooldata',
  wobjdata: 'wobjdata',
  loaddata: 'loaddata',
  speeddata: 'speeddata',
  zonedata: 'zonedata',
}

/** 系统预定义只读名称集合（tool0/wobj0/load0/官方 speed/zone）；源码不能重定义这些名称。 */
const SYSTEM_NAMES = new Set<string>([
  ...Object.keys(SYSTEM_TOOLDATA),
  ...Object.keys(SYSTEM_WOBJDATA),
  ...Object.keys(SYSTEM_LOADDATA),
  ...Object.keys(SYSTEM_SPEED),
  ...Object.keys(SYSTEM_ZONE),
])

/** 模块级结构化关键字；出现在 MODULE 后而不是模块名称位置时，表示模块名称缺失。 */
const MODULE_NAME_KEYWORDS = new Set(['proc', 'func', 'trap', 'record', 'const', 'pers', 'var', 'module', 'endmodule'])

function normalizeName(text: string): string {
  return text.toLocaleLowerCase('en-US')
}

function buildLineStarts(source: string): number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function positionAt(offset: number, lineStarts: readonly number[]): RapidSourcePosition {
  let low = 0
  let high = lineStarts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (lineStarts[middle] <= offset) low = middle + 1
    else high = middle - 1
  }
  const lineIndex = Math.max(0, high)
  return { offset, line: lineIndex + 1, column: offset - lineStarts[lineIndex] + 1 }
}

function rangeFromOffsets(
  start: number,
  end: number,
  lineStarts: readonly number[],
): RapidSourceRange {
  return { start: positionAt(start, lineStarts), end: positionAt(end, lineStarts) }
}

function rangeFromToken(token: Token, lineStarts: readonly number[]): RapidSourceRange {
  return rangeFromOffsets(token.start, token.end, lineStarts)
}

function lex(source: string, lineStarts: readonly number[]): {
  tokens: Token[]
  diagnostics: RapidDiagnostic[]
} {
  const tokens: Token[] = []
  const diagnostics: RapidDiagnostic[] = []
  let index = 0

  function addLexicalError(start: number, end: number, message: string): void {
    diagnostics.push({
      code: 'lexical-error',
      severity: 'error',
      message,
      range: rangeFromOffsets(start, end, lineStarts),
    })
  }

  while (index < source.length) {
    const character = source[index]
    if (/\s/.test(character)) {
      index += 1
      continue
    }
    if (character === '!') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }

    // 双引号字符串字面量（wobjdata.ufmec 等）；首期不支持转义，`"` 之间原样取用。
    if (character === '"') {
      let end = index + 1
      while (end < source.length && source[end] !== '"') end += 1
      if (end >= source.length) {
        addLexicalError(index, end, '未闭合的字符串字面量')
        index = end
        continue
      }
      tokens.push({ kind: 'string', text: source.slice(index, end + 1), start: index, end: end + 1 })
      index = end + 1
      continue
    }

    const rest = source.slice(index)
    const identifier = rest.match(IDENTIFIER_PATTERN)
    if (identifier) {
      tokens.push({ kind: 'identifier', text: identifier[0], start: index, end: index + identifier[0].length })
      index += identifier[0].length
      continue
    }

    const number = rest.match(NUMBER_PATTERN)
    if (number) {
      tokens.push({ kind: 'number', text: number[0], start: index, end: index + number[0].length })
      index += number[0].length
      continue
    }

    if (rest.startsWith(':=')) {
      tokens.push({ kind: 'symbol', text: ':=', start: index, end: index + 2 })
      index += 2
      continue
    }

    if ('[](),;\\'.includes(character)) {
      tokens.push({ kind: 'symbol', text: character, start: index, end: index + 1 })
      index += 1
      continue
    }

    addLexicalError(index, index + 1, `无法识别字符 “${character}”`)
    index += 1
  }

  tokens.push({ kind: 'eof', text: '', start: source.length, end: source.length })
  return { tokens, diagnostics }
}

function cloneSpeed(speed: SpeedData): SpeedData {
  return { ...speed }
}

function cloneTarget(target: RobTarget): RobTarget {
  return {
    trans: [...target.trans],
    rot: [...target.rot],
    robconf: [...target.robconf],
    extax: [...target.extax],
  }
}

function isSymbol(token: Token | undefined, text: string): boolean {
  return token?.kind === 'symbol' && token.text === text
}

function isKeyword(token: Token | undefined, text: string): boolean {
  return token?.kind === 'identifier' && normalizeName(token.text) === normalizeName(text)
}

/**
 * 解析首期真实 RAPID 子集。tokenizer、恢复策略和名称解析均隐藏在本模块内；
 * 调用方只接收结构化运动、诊断和是否允许执行的结果。
 */
export function parseRapidProgram(source: string): RapidParseResult {
  const lineStarts = buildLineStarts(source)
  const lexed = lex(source, lineStarts)
  const tokens = lexed.tokens
  const diagnostics = [...lexed.diagnostics]
  const symbols = new Map<string, SymbolEntry>()
  const pendingMotions: PendingMotion[] = []
  const pendingReferences: Array<{ kind: OperandKind; token: Token }> = []
  // 系统预定义名称（tool0/wobj0/load0/速度/zone）在各运动操作数中的引用范围，供 Program Data 只读展示。
  const systemReferences = new Map<string, RapidSourceRange[]>()
  let cursor = 0
  let moduleCount = 0
  let mainCount = 0
  let sawEndModule = false
  // 是否解析到有效 MODULE 关键字；没有它时省略“缺少 ENDMODULE”等误导性尾随噪声。
  let hasModuleHeader = false
  // 受控编辑插入点：新模块级声明的插入位置（main PROC 之前）、main 内运动指令插入位置（ENDPROC 之前）。
  let dataInsertOffset = 0
  const motionInsertionPoints: RapidMotionInsertionPoint[] = []

  function current(): Token {
    return tokens[cursor] ?? tokens[tokens.length - 1]
  }

  function advance(): Token {
    const token = current()
    if (cursor < tokens.length - 1) cursor += 1
    return token
  }

  function addDiagnostic(
    code: RapidDiagnosticCode,
    message: string,
    token: Token = current(),
  ): void {
    diagnostics.push({ code, severity: 'error', message, range: rangeFromToken(token, lineStarts) })
  }

  /** 缺失 token 的根因诊断：零长度范围，指向当前游标（应插入该 token 的位置）。 */
  function addMissingDiagnostic(
    code: RapidDiagnosticCode,
    message: string,
    token: Token = current(),
  ): void {
    diagnostics.push({
      code,
      severity: 'error',
      message,
      range: rangeFromOffsets(token.start, token.start, lineStarts),
    })
  }

  /** 当前 token 是否为已知运动关键字或过程/模块结构边界（用于运动参数恢复终结点）。 */
  function isMotionBoundary(token: Token): boolean {
    const text = normalizeName(token.text)
    return (
      text === 'movej' ||
      text === 'movel' ||
      text === 'moveabsj' ||
      text === 'movec' ||
      text === 'endproc' ||
      text === 'endmodule' ||
      text === 'endif' ||
      text === 'endwhile' ||
      text === 'endfor'
    )
  }

  function expectKeyword(keyword: string): Token | null {
    if (isKeyword(current(), keyword)) return advance()
    addMissingDiagnostic('syntax-error', `期望关键字 ${keyword}`)
    return null
  }

  function expectIdentifier(description: string): Token | null {
    if (current().kind === 'identifier') return advance()
    addMissingDiagnostic('syntax-error', `期望${description}`)
    return null
  }

  function expectSymbol(symbol: string): Token | null {
    if (isSymbol(current(), symbol)) return advance()
    addMissingDiagnostic('syntax-error', `期望符号 ${symbol}`)
    return null
  }

  function skipToStatementEnd(): void {
    while (current().kind !== 'eof') {
      const token = advance()
      if (token.text === ';' || isKeyword(token, 'ENDPROC') || isKeyword(token, 'ENDMODULE')) return
    }
  }

  function parseTuple(expectedLength: number, fieldName: string): number[] | null {
    const open = expectSymbol('[')
    if (!open) return null
    const values: number[] = []
    let malformed = false
    while (current().kind !== 'eof' && !isSymbol(current(), ']')) {
      if (current().kind !== 'number') {
        addDiagnostic('invalid-data', `${fieldName} 必须只包含数字`, current())
        malformed = true
        advance()
      } else {
        const token = advance()
        const value = Number(token.text)
        if (!Number.isFinite(value)) {
          addDiagnostic('invalid-data', `${fieldName} 包含非有限数字`, token)
          malformed = true
        }
        values.push(value)
      }

      if (isSymbol(current(), ',')) {
        advance()
        if (isSymbol(current(), ']')) {
          addDiagnostic('invalid-data', `${fieldName} 不允许尾逗号`, current())
          malformed = true
        }
      } else if (!isSymbol(current(), ']')) {
        addDiagnostic('syntax-error', `${fieldName} 数字之间必须使用逗号`, current())
        malformed = true
        while (current().kind !== 'eof' && !isSymbol(current(), ',') && !isSymbol(current(), ']')) {
          advance()
        }
        if (isSymbol(current(), ',')) advance()
      }
    }
    expectSymbol(']')
    if (values.length !== expectedLength) {
      addDiagnostic('invalid-data', `${fieldName} 长度必须为 ${expectedLength}`, open)
      malformed = true
    }
    return malformed ? null : values
  }

  /**
   * RAPID 四元数应为单位长度；长度偏离 1 超过该容差即按非法数据处理（票据 01：非归一化四元数精确诊断）。
   */
  const QUAT_NORM_TOLERANCE = 1e-3

  /** 解析一个长度接近 1 的四元数 tuple；长度偏离时给出 invalid-data 诊断并返回 null。 */
  function parseUnitQuat(fieldName: string): number[] | null {
    const quat = parseTuple(4, fieldName)
    if (!quat) return null
    const norm = Math.hypot(...quat)
    if (Math.abs(norm - 1) > QUAT_NORM_TOLERANCE) {
      addDiagnostic('invalid-data', `${fieldName} 四元数未归一化（长度 ${norm.toFixed(4)}）`)
      return null
    }
    return quat
  }

  function parseRobTarget(): RobTarget | null {
    const open = expectSymbol('[')
    if (!open) return null
    const trans = parseTuple(3, 'robtarget.trans')
    expectSymbol(',')
    const rot = parseUnitQuat('robtarget.rot')
    expectSymbol(',')
    const robconf = parseTuple(4, 'robtarget.robconf')
    expectSymbol(',')
    const extax = parseTuple(6, 'robtarget.extax')
    expectSymbol(']')
    if (!trans || !rot || !robconf || !extax) return null
    return {
      trans: trans as RobTarget['trans'],
      rot: rot as RobTarget['rot'],
      robconf: robconf as RobTarget['robconf'],
      extax: extax as RobTarget['extax'],
    }
  }

  /** 读取一个有限数值 token，非有限或缺失返回 null。 */
  function parseFiniteNumber(fieldName: string): number | null {
    if (current().kind !== 'number') {
      addMissingDiagnostic('invalid-data', `${fieldName} 必须是数字`, current())
      return null
    }
    const token = advance()
    const value = Number(token.text)
    if (!Number.isFinite(value)) {
      addDiagnostic('invalid-data', `${fieldName} 包含非有限数字`, token)
      return null
    }
    return value
  }

  /** 读取一个 RAPID 布尔（TRUE/FALSE），非法或无返回 null。 */
  function parseBool(fieldName: string): boolean | null {
    if (current().kind !== 'identifier') {
      addMissingDiagnostic('invalid-data', `${fieldName} 必须是 TRUE/FALSE`, current())
      return null
    }
    const token = advance()
    const name = normalizeName(token.text)
    if (name === 'true') return true
    if (name === 'false') return false
    addDiagnostic('invalid-data', `${fieldName} 必须是 TRUE/FALSE`, token)
    return null
  }

  /** 读取一个双引号字符串字面量；返回去掉引号的内容，缺失返回 null。 */
  function parseStringValue(fieldName: string): string | null {
    if (current().kind !== 'string') {
      addMissingDiagnostic('invalid-data', `${fieldName} 必须是字符串`, current())
      return null
    }
    const token = advance()
    return token.text.slice(1, -1)
  }

  /** 解析 `[[x,y,z],[q1,q2,q3,q4]]` 位姿记录（tooldata.tframe / wobj frame）。 */
  function parsePose(fieldName: string): RapidPose | null {
    const open = expectSymbol('[')
    if (!open) return null
    const trans = parseTuple(3, `${fieldName}.trans`)
    expectSymbol(',')
    const rot = parseUnitQuat(`${fieldName}.rot`)
    expectSymbol(']')
    if (!trans || !rot) return null
    return { trans: trans as RapidPose['trans'], rot: rot as RapidPose['rot'] }
  }

  /** 解析 `[mass, [cog], [aom], ix, iy, iz]` 负载记录。 */
  function parseLoadData(): LoadData | null {
    const open = expectSymbol('[')
    if (!open) return null
    const mass = parseFiniteNumber('loaddata.mass')
    expectSymbol(',')
    const cog = parseTuple(3, 'loaddata.cog')
    expectSymbol(',')
    const aom = parseUnitQuat('loaddata.aom')
    expectSymbol(',')
    const ix = parseFiniteNumber('loaddata.ix')
    expectSymbol(',')
    const iy = parseFiniteNumber('loaddata.iy')
    expectSymbol(',')
    const iz = parseFiniteNumber('loaddata.iz')
    expectSymbol(']')
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
  function parseToolData(): ToolData | null {
    const open = expectSymbol('[')
    if (!open) return null
    const robhold = parseBool('tooldata.robhold')
    expectSymbol(',')
    const tframe = parsePose('tooldata.tframe')
    expectSymbol(',')
    const tload = parseLoadData()
    expectSymbol(']')
    if (robhold === null || !tframe || !tload) return null
    return { robhold, tframe, tload }
  }

  /** 解析 `[robhold, ufprog, ufmec, uframe(pose), oframe(pose)]` 工件坐标记录。 */
  function parseWobjData(): WobjData | null {
    const open = expectSymbol('[')
    if (!open) return null
    const robhold = parseBool('wobjdata.robhold')
    expectSymbol(',')
    const ufprog = parseBool('wobjdata.ufprog')
    expectSymbol(',')
    const ufmec = parseStringValue('wobjdata.ufmec')
    expectSymbol(',')
    const uframe = parsePose('wobjdata.uframe')
    expectSymbol(',')
    const oframe = parsePose('wobjdata.oframe')
    expectSymbol(']')
    if (robhold === null || ufprog === null || ufmec === null || !uframe || !oframe) return null
    return { robhold, ufprog, ufmec, uframe, oframe }
  }

  /** 解析 `[v_tcp, v_ori, v_leax, v_reax]` 速度记录。 */
  function parseSpeedValue(): SpeedData | null {
    const open = expectSymbol('[')
    if (!open) return null
    const v_tcp = parseFiniteNumber('speeddata.v_tcp')
    expectSymbol(',')
    const v_ori = parseFiniteNumber('speeddata.v_ori')
    expectSymbol(',')
    const v_leax = parseFiniteNumber('speeddata.v_leax')
    expectSymbol(',')
    const v_reax = parseFiniteNumber('speeddata.v_reax')
    expectSymbol(']')
    if (v_tcp === null || v_ori === null || v_leax === null || v_reax === null) return null
    return { v_tcp, v_ori, v_leax, v_reax }
  }

  /** 解析 `[finep, pzoneTcp, pzoneOri, pzoneEax, zoneOri, zoneLeax, zoneReax]` 区域记录。 */
  function parseZoneValue(): ZoneData | null {
    const open = expectSymbol('[')
    if (!open) return null
    const finep = parseBool('zonedata.finep')
    expectSymbol(',')
    const pzoneTcp = parseFiniteNumber('zonedata.pzone_tcp')
    expectSymbol(',')
    const pzoneOri = parseFiniteNumber('zonedata.pzone_ori')
    expectSymbol(',')
    const pzoneEax = parseFiniteNumber('zonedata.pzone_eax')
    expectSymbol(',')
    const zoneOri = parseFiniteNumber('zonedata.zone_ori')
    expectSymbol(',')
    const zoneLeax = parseFiniteNumber('zonedata.zone_leax')
    expectSymbol(',')
    const zoneReax = parseFiniteNumber('zonedata.zone_reax')
    expectSymbol(']')
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
  function parseDataValue(kind: RapidDataKind): SymbolEntry['value'] | null {
    switch (kind) {
      case 'robtarget': {
        const target = parseRobTarget()
        if (!target) return null
        return { kind: 'robtarget', value: target }
      }
      case 'tooldata': {
        const value = parseToolData()
        if (!value) return null
        return { kind: 'tooldata', value }
      }
      case 'wobjdata': {
        const value = parseWobjData()
        if (!value) return null
        return { kind: 'wobjdata', value }
      }
      case 'loaddata': {
        const value = parseLoadData()
        if (!value) return null
        return { kind: 'loaddata', value }
      }
      case 'speeddata': {
        const value = parseSpeedValue()
        if (!value) return null
        return { kind: 'speeddata', value }
      }
      case 'zonedata': {
        const value = parseZoneValue()
        if (!value) return null
        return { kind: 'zonedata', value }
      }
      default:
        return null
    }
  }

  /** 存储类别是否符合 ABB 规则；tooldata/loaddata/wobjdata 必须 PERS，speeddata/zonedata 允许 CONST/VAR/PERS，robtarget 允许 CONST/PERS。 */
  function validateStorage(kind: RapidDataKind, storageKind: 'const' | 'pers' | 'var', typeName: string): boolean {
    if ((kind === 'tooldata' || kind === 'loaddata' || kind === 'wobjdata') && storageKind !== 'pers') {
      addDiagnostic('invalid-data', `${typeName} 声明必须使用 PERS（模块级 ${typeName}）`)
      return false
    }
    if (kind === 'speeddata' || kind === 'zonedata') return true
    if (storageKind === 'var') {
      addDiagnostic('invalid-data', `robtarget 声明不支持 VAR`)
      return false
    }
    return true
  }

  function parseDataDeclaration(): void {
    const storage = advance()
    const declarationStart = storage.start
    let storageKind: 'const' | 'pers' | 'var' = 'const'
    if (isKeyword(storage, 'TASK')) {
      if (!expectKeyword('PERS')) {
        skipToStatementEnd()
        return
      }
      storageKind = 'pers'
    } else if (isKeyword(storage, 'PERS')) {
      storageKind = 'pers'
    } else if (isKeyword(storage, 'VAR')) {
      storageKind = 'var'
    }

    const type = expectIdentifier('数据类型')
    if (!type) {
      skipToStatementEnd()
      return
    }
    const typeName = normalizeName(type.text)
    const kind = SUPPORTED_DATA_KINDS[typeName]
    if (!kind) {
      // 已知但不支持的类型名（num/bool 等）报 unsupported；否则像是漏写了数据类型、把名称顶到了类型位。
      if (KNOWN_UNSUPPORTED_TYPES.has(typeName)) {
        addDiagnostic('unsupported-option', `暂不支持 ${type.text} 声明`, type)
        skipToStatementEnd()
        return
      }
      addMissingDiagnostic(
        'syntax-error',
        `缺少数据类型（期望 robtarget/tooldata/wobjdata/loaddata/speeddata/zonedata）`,
        type,
      )
      skipToStatementEnd()
      return
    }

    const name = expectIdentifier(`${typeName} 名称`)
    const assign = expectSymbol(':=')
    if (!name || !assign) {
      // 缺少名称或 `:=`：值无法与名称可靠对应，恢复本声明但不生成半合法 Program Data 条目。
      skipToStatementEnd()
      return
    }
    const valueStartOffset = current().start
    const parsedValue = parseDataValue(kind)
    const semicolon = expectSymbol(';')
    if (!parsedValue) return
    validateStorage(kind, storageKind, typeName)
    const declarationEnd = semicolon ? semicolon.end : current().start
    const nameRange = rangeFromToken(name, lineStarts)

    const key = normalizeName(name.text)
    // 系统名称只读且不能重定义；用户符号名也不能与系统预定义名冲突。
    if (symbols.has(key) || SYSTEM_NAMES.has(key)) {
      const label = SYSTEM_NAMES.has(key) ? `系统预定义 ${typeName} ${name.text} 不能重定义` : `重复定义 ${typeName} ${name.text}`
      addDiagnostic('duplicate-symbol', label, name)
      return
    }
    symbols.set(key, {
      kind,
      value: parsedValue,
      range: nameRange,
      declarationRange: rangeFromOffsets(declarationStart, declarationEnd, lineStarts),
      valueRange: rangeFromOffsets(valueStartOffset, semicolon ? semicolon.start : valueStartOffset, lineStarts),
      storage: storageKind,
      references: [],
    })
  }

  /** 当前 token 是否已不是本运动指令的有效操作数位置（下一条运动、结构结束或 EOF）。 */
  function atOperandBoundary(): boolean {
    return isMotionBoundary(current()) || current().kind === 'eof'
  }

  /** 暂存操作数名；即使所在运动断裂也必须保留引用信息。 */
  function queueReference(kind: OperandKind, nameToken: Token): void {
    pendingReferences.push({ kind, token: nameToken })
  }

  /** 在完整模块解析后结算引用，支持声明位于 main 之后的合法前向引用。 */
  function resolveReferences(): void {
    for (const ref of pendingReferences) {
      const key = normalizeName(ref.token.text)
      const expectedKind = OPERAND_KIND_SYMBOL_KIND[ref.kind]
      // 用户声明的符号优先；其次才是系统预定义名称。
      const symbol = symbols.get(key)
      const range = rangeFromToken(ref.token, lineStarts)
      if (symbol) {
        // 同名符号必须与被引用操作数角色匹配（例如 robtarget 不能用作 speed）。类型不符按未定义报。
        if (symbol.kind === expectedKind) {
          symbol.references.push(range)
        } else {
          addDiagnostic(
            'undefined-symbol',
            `未定义 ${operandDescription(ref.kind)} ${ref.token.text}（${symbol.kind} 不能用作该操作数）`,
            ref.token,
          )
        }
        continue
      }
      const desc = operandDescription(ref.kind)
      if (isSystemName(ref.kind, key)) {
        const list = systemReferences.get(key) ?? []
        list.push(range)
        systemReferences.set(key, list)
      } else {
        addDiagnostic('undefined-symbol', `未定义 ${desc} ${ref.token.text}`, ref.token)
      }
    }
  }

  /** 操作数角色的人类可读描述（用于诊断文案）。 */
  function operandDescription(kind: OperandKind): string {
    switch (kind) {
      case 'target': return 'robtarget'
      case 'speed': return '速度'
      case 'zone': return 'zone'
      case 'tool': return '工具'
      case 'wobj': return '工件坐标'
    }
  }

  /** 操作数角色要求的用户符号数据种类；用于引用结算时的类型匹配校验。 */
  const OPERAND_KIND_SYMBOL_KIND: Record<OperandKind, RapidDataKind> = {
    target: 'robtarget',
    speed: 'speeddata',
    zone: 'zonedata',
    tool: 'tooldata',
    wobj: 'wobjdata',
  }

  /** 该操作数角色对应的系统预定义命名空间。 */
  function systemNamespace(kind: OperandKind): Record<string, unknown> {
    switch (kind) {
      case 'speed': return SYSTEM_SPEED
      case 'zone': return SYSTEM_ZONE
      case 'tool': return SYSTEM_TOOLDATA
      case 'wobj': return SYSTEM_WOBJDATA
      case 'target': return {}
    }
  }

  /** 名称是否为该操作数角色的系统预定义名称。 */
  function isSystemName(kind: OperandKind, key: string): boolean {
    return key in systemNamespace(kind)
  }

  /** 取用户符号中某数据种类的载荷值；kind 不匹配返回 null。调用方以 V 声明所需载荷类型。 */
  function userValue<V>(entry: SymbolEntry | undefined, kind: RapidDataKind): V | null {
    if (!entry || entry.value.kind !== kind) return null
    return entry.value.value as unknown as V
  }

  /** 解析速度操作数：用户 speeddata 优先，否则系统预定义；两者皆无返回 null（未定义诊断已发）。 */
  function resolveSpeed(name: string): SpeedData | null {
    const key = normalizeName(name)
    const user = userValue<SpeedData>(symbols.get(key), 'speeddata')
    if (user) return { ...user }
    const sys = SYSTEM_SPEED[key]
    return sys ? { ...sys } : null
  }

  /** 解析 zone 操作数：用户 zonedata 优先，否则系统预定义。 */
  function resolveZone(name: string): ZoneData | null {
    const key = normalizeName(name)
    const user = userValue<ZoneData>(symbols.get(key), 'zonedata')
    if (user) return { ...user }
    const sys = SYSTEM_ZONE[key]
    return sys ? { ...sys } : null
  }

  /** 解析工具操作数：用户 tooldata 优先，否则系统预定义。 */
  function resolveTool(name: string): ToolData | null {
    const key = normalizeName(name)
    const user = userValue<ToolData>(symbols.get(key), 'tooldata')
    if (user) return cloneTool(user)
    const sys = SYSTEM_TOOLDATA[key]
    return sys ? cloneTool(sys) : null
  }

  /** 解析工件坐标操作数：用户 wobjdata 优先，否则系统预定义。 */
  function resolveWobj(name: string): WobjData | null {
    const key = normalizeName(name)
    const user = userValue<WobjData>(symbols.get(key), 'wobjdata')
    if (user) return cloneWobj(user)
    const sys = SYSTEM_WOBJDATA[key]
    return sys ? cloneWobj(sys) : null
  }

  function cloneTool(tool: ToolData): ToolData {
    return {
      robhold: tool.robhold,
      tframe: { trans: [...tool.tframe.trans], rot: [...tool.tframe.rot] },
      tload: {
        mass: tool.tload.mass,
        cog: [...tool.tload.cog],
        aom: [...tool.tload.aom],
        ix: tool.tload.ix,
        iy: tool.tload.iy,
        iz: tool.tload.iz,
      },
    }
  }

  function cloneWobj(wobj: WobjData): WobjData {
    return {
      robhold: wobj.robhold,
      ufprog: wobj.ufprog,
      ufmec: wobj.ufmec,
      uframe: { trans: [...wobj.uframe.trans], rot: [...wobj.uframe.rot] },
      oframe: { trans: [...wobj.oframe.trans], rot: [...wobj.oframe.rot] },
    }
  }

  /**
   * 断裂运动恢复：跳过本指令剩余 token，直到分号、可选参数反斜杠或下一结构边界。
   * 不消费边界 token，让外层循环正确解析下一条运动或 ENDPROC/ENDMODULE。
   */
  function recoverMotionTail(): void {
    while (current().kind !== 'eof' && !atOperandBoundary()) {
      const token = advance()
      if (token.text === ';' || token.text === '\\') break
    }
  }

  /**
   * 解析一个必选位置操作数。
   * - 当前是逗号 → 空操作数：定位到该位置报告缺少操作数，并消费逗号以继续；
   * - 当前是结构边界 → 指令不完整：发一次根因并让调用方中止；
   * - 否则解析并返回该操作数（缺失时报缺操作数，返回 null）。
   */
  function expectOperandSlot(desc: string, onAbort: () => void): OperandSlotResult {
    if (isSymbol(current(), ',')) {
      addMissingDiagnostic('syntax-error', `缺少${desc}（空操作数，当前为 ","）`, current())
      advance()
      return { token: null, separatorConsumed: true }
    }
    if (atOperandBoundary()) {
      addMissingDiagnostic('syntax-error', '运动指令参数不完整（缺少 "," 分隔的操作数或分号）', current())
      onAbort()
      return { token: null, separatorConsumed: false }
    }
    return { token: expectIdentifier(desc), separatorConsumed: false }
  }

  /**
   * 读取目标操作数：先取首 token（普通 robtarget 名称，或 Offs/RelTool 位置函数关键字）。
   * Offs(p,[x,y,z]) / RelTool(p,[dx,dy,dz[,rx,ry,rz]]) 参数为数值字面量；缺失基准、参数数量错误、
   * 非数值参数或缺失括号均给出精确诊断并中止整条运动。
   */
  function parseTargetOperand(onAbort: () => void): { target: PendingTarget | null; separatorConsumed: boolean } {
    const slot = expectOperandSlot('目标点名称', onAbort)
    const first = slot.token
    if (!first) return { target: null, separatorConsumed: slot.separatorConsumed }
    const keyword = normalizeName(first.text)

    // 位置函数：Offs / RelTool，且紧跟 `(`。
    if ((keyword === 'offs' || keyword === 'reltool') && isSymbol(current(), '(')) {
      const exprStart = first.start
      advance() // '('
      const base = expectIdentifier('基准目标名称')
      if (!base) {
        recoverMotionTail()
        onAbort()
        return { target: null, separatorConsumed: false }
      }
      const params: number[] = []
      while (isSymbol(current(), ',')) {
        advance() // ','
        if (current().kind !== 'number') {
          addDiagnostic('invalid-data', `${first.text} 的参数必须是数字`, current())
          recoverMotionTail()
          onAbort()
          return { target: null, separatorConsumed: false }
        }
        params.push(Number(advance().text))
      }
      if (!isSymbol(current(), ')')) {
        addMissingDiagnostic('syntax-error', `缺少 ${first.text} 的右括号 ")"`, current())
        recoverMotionTail()
        onAbort()
        return { target: null, separatorConsumed: false }
      }
      advance() // ')'
      // 参数数量：Offs 必须 3；RelTool 必须 3（平移）或 6（平移 + 旋转）。
      const paramCount = params.length
      if (keyword === 'offs' && paramCount !== 3) {
        addDiagnostic('invalid-data', `Offs 需要 3 个平移参数，实际 ${paramCount} 个`, first)
        return { target: null, separatorConsumed: false }
      }
      if (keyword === 'reltool' && paramCount !== 3 && paramCount !== 6) {
        addDiagnostic('invalid-data', `RelTool 需要 3 或 6 个参数，实际 ${paramCount} 个`, first)
        return { target: null, separatorConsumed: false }
      }
      const [dx, dy, dz, rx, ry, rz] = params
      const end = current().start
      return {
        target: {
          kind: keyword as 'offs' | 'reltool',
          baseName: base.text,
          baseToken: base,
          dx,
          dy,
          dz,
          rx: paramCount === 6 ? rx : undefined,
          ry: paramCount === 6 ? ry : undefined,
          rz: paramCount === 6 ? rz : undefined,
          range: rangeFromOffsets(exprStart, end, lineStarts),
          sourceText: source.slice(exprStart, end),
        },
        separatorConsumed: false,
      }
    }

    // 普通命名 robtarget。
    return {
      target: {
        kind: 'name',
        baseName: first.text,
        baseToken: first,
        range: rangeFromToken(first, lineStarts),
        sourceText: first.text,
      },
      separatorConsumed: slot.separatorConsumed,
    }
  }

  function parseMotion(): void {
    const start = advance()
    const kind = normalizeName(start.text) as PendingMotion['kind']
    motionInsertionPoints.push({ index: pendingMotions.length, offset: start.start, line: positionAt(start.start, lineStarts).line })
    let abandoned = false
    const abort = (): void => {
      abandoned = true
    }

    const targetResult = parseTargetOperand(abort)
    const target = targetResult.target
    let separatorConsumed = targetResult.separatorConsumed
    if (target) queueReference('target', target.baseToken)
    if (abandoned) return

    // 期望 "," 分隔后解析下一个操作数；缺逗号时只报一次根因并中止，避免连锁缺参错误。
    const operandAfterSeparator = (desc: string): Token | null => {
      if (!separatorConsumed && !isSymbol(current(), ',')) {
        if (atOperandBoundary()) {
          addMissingDiagnostic('syntax-error', '运动指令参数不完整（缺少 "," 分隔的操作数或分号）', current())
        } else {
          addMissingDiagnostic('syntax-error', '运动操作数之间缺少逗号 ","', current())
          // 漏逗号后残余的操作数不再逐条误报，直接恢复本指令。
          recoverMotionTail()
        }
        abort()
        return null
      }
      if (!separatorConsumed) advance()
      const slot = expectOperandSlot(desc, abort)
      separatorConsumed = slot.separatorConsumed
      return slot.token
    }

    const speed = operandAfterSeparator('速度名称')
    if (abandoned) return
    const zone = operandAfterSeparator('zone 名称')
    if (abandoned) return
    const tool = operandAfterSeparator('工具名称')
    if (abandoned) return
    if (speed) queueReference('speed', speed)
    if (zone) queueReference('zone', zone)
    if (tool) queueReference('tool', tool)

    /**
     * 参数解析收尾：若当前位置既非分号、又非法继续（普通参数位/可选参数位允许的延续不同），
     * 则视为多出的参数，报一根因并恢复；返回 true 表示已因多余参数中止本指令。
     * allowWobj 为 true 时允许可选参数反斜杠（普通位置参数后）；false 用于可选参数之后（无第二个反斜杠）。
     */
    const rejectTrailingParams = (allowWobj: boolean): boolean => {
      const hasWobj = allowWobj && isSymbol(current(), '\\')
      if (!isSymbol(current(), ';') && !hasWobj && !atOperandBoundary()) {
        addMissingDiagnostic('syntax-error', `运动指令包含多余参数 ${current().text || '（空）'}`, current())
        recoverMotionTail()
        return true
      }
      return false
    }

    // 第 5 个及更多普通位置参数 / 尾随逗号：多出的参数根因。
    if (rejectTrailingParams(true)) return

    let wobjName = 'wobj0'
    let wobjToken: Token | null = null
    let sawWobjOption = false
    while (isSymbol(current(), '\\')) {
      advance()
      const option = expectIdentifier('可选参数名称')
      if (!option) {
        // 残缺反斜杠或缺失可选参数名：已报缺名根因，恢复。
        recoverMotionTail()
        return
      }
      if (normalizeName(option.text) !== 'wobj') {
        addDiagnostic('unsupported-option', `不支持可选参数 ${option.text}`, option)
        recoverMotionTail()
        return
      }
      if (sawWobjOption) {
        addDiagnostic('unsupported-option', '重复的 WObj 可选参数', option)
        recoverMotionTail()
        return
      }
      sawWobjOption = true
      const assign = expectSymbol(':=')
      const wobj = expectIdentifier('工件坐标名称')
      if (!assign || !wobj) {
        recoverMotionTail()
        return
      }
      wobjName = wobj.text
      wobjToken = wobj
      queueReference('wobj', wobj)
    }

    // 可选参数之后仍有非分号内容：多余的参数根因。
    if (rejectTrailingParams(false)) return

    const semicolon = expectSymbol(';')
    const end = semicolon ?? current()
    if (!target || !speed || !zone || !tool) return
    pendingMotions.push({
      kind,
      target: target as PendingTarget,
      speedName: speed.text,
      speedToken: speed,
      zoneName: zone.text,
      zoneToken: zone,
      toolName: tool.text,
      toolToken: tool,
      wobjName,
      wobjToken,
      range: rangeFromOffsets(start.start, end.end, lineStarts),
      sourceText: source.slice(start.start, end.end),
    })
  }

  function skipUnsupportedControl(): void {
    const token = advance()
    addDiagnostic('unsupported-syntax', `首期不支持 ${token.text} 控制流`, token)
    if (isKeyword(token, 'IF') || isKeyword(token, 'WHILE') || isKeyword(token, 'FOR')) {
      while (current().kind !== 'eof' && !isKeyword(current(), 'THEN') && !isSymbol(current(), ';')) {
        advance()
      }
      if (isKeyword(current(), 'THEN')) advance()
    }
  }

  function parseMainBody(): void {
    while (
      current().kind !== 'eof' &&
      !isKeyword(current(), 'ENDPROC') &&
      !isKeyword(current(), 'ENDMODULE')
    ) {
      if (isKeyword(current(), 'MOVEJ') || isKeyword(current(), 'MOVEL')) {
        parseMotion()
      } else if (
        isKeyword(current(), 'IF') ||
        isKeyword(current(), 'WHILE') ||
        isKeyword(current(), 'FOR') ||
        isKeyword(current(), 'MOVEABSJ') ||
        isKeyword(current(), 'MOVEC')
      ) {
        skipUnsupportedControl()
      } else if (isKeyword(current(), 'ENDIF') || isKeyword(current(), 'ENDWHILE') || isKeyword(current(), 'ENDFOR')) {
        addDiagnostic('unsupported-syntax', `首期不支持 ${current().text} 控制流结束标记`)
        advance()
      } else {
        addDiagnostic('unsupported-syntax', `首期不支持 ${current().text || '空语句'}`)
        skipToStatementEnd()
      }
    }
    // 在 main 末尾追加运动指令。
    motionInsertionPoints.push({
      index: pendingMotions.length,
      offset: current().start,
      line: positionAt(current().start, lineStarts).line,
    })
    expectKeyword('ENDPROC')
  }

  function skipProcedureBody(): void {
    while (current().kind !== 'eof' && !isKeyword(current(), 'ENDPROC')) advance()
    expectKeyword('ENDPROC')
  }

  function parseProcedure(): void {
    const procStart = advance().start
    const name = expectIdentifier('过程名称')
    const open = expectSymbol('(')
    let hasParameters = false
    if (open) {
      while (current().kind !== 'eof' && !isSymbol(current(), ')')) {
        hasParameters = true
        advance()
      }
      expectSymbol(')')
    }

    const isMain = name !== null && normalizeName(name.text) === 'main'
    if (!isMain) {
      addDiagnostic('unsupported-syntax', `首期只支持 PROC main()，暂不支持 ${name?.text ?? '匿名过程'}`, name ?? current())
      skipProcedureBody()
      return
    }
    mainCount += 1
    if (hasParameters) {
      addDiagnostic('unsupported-option', 'PROC main() 首期不能包含参数', name ?? current())
    }
    if (mainCount > 1) {
      addDiagnostic('duplicate-symbol', '程序只能包含一个 PROC main()', name ?? current())
    }
    // 新模块级 robtarget 声明插入到 main PROC 之前。
    dataInsertOffset = procStart
    parseMainBody()
  }

  if (!expectKeyword('MODULE')) {
    addDiagnostic('missing-module', 'RAPID 源程序必须以 MODULE 开始')
  } else {
    hasModuleHeader = true
    moduleCount += 1
    // 模块名称必须是普通标识符；若紧跟的是结构化关键字，说明模块名称缺失。
    if (current().kind === 'identifier' && !MODULE_NAME_KEYWORDS.has(normalizeName(current().text))) {
      expectIdentifier('模块名称')
    } else {
      addMissingDiagnostic('syntax-error', '缺少模块名称')
    }
  }

  while (current().kind !== 'eof' && !isKeyword(current(), 'ENDMODULE')) {
    if (isKeyword(current(), 'CONST') || isKeyword(current(), 'PERS') || isKeyword(current(), 'TASK') || isKeyword(current(), 'VAR')) {
      parseDataDeclaration()
    } else if (isKeyword(current(), 'PROC')) {
      parseProcedure()
    } else if (isKeyword(current(), 'MODULE')) {
      moduleCount += 1
      addDiagnostic('unsupported-syntax', '一个源程序只能包含一个 MODULE')
      skipToStatementEnd()
    } else {
      addDiagnostic('unsupported-syntax', `MODULE 内不支持 ${current().text || '空内容'}`)
      skipToStatementEnd()
    }
  }

  if (isKeyword(current(), 'ENDMODULE')) {
    advance()
    sawEndModule = true
  } else if (hasModuleHeader) {
    // 已建立 MODULE 却没有闭合：缺失 ENDMODULE 是唯一根因（零长度插入点）。
    addMissingDiagnostic('syntax-error', '缺少 ENDMODULE')
  }
  // 从未解析出 MODULE 关键字时，上面已用 missing-module 给出唯一根因，不再补“缺少 ENDMODULE”噪声。
  if (sawEndModule && current().kind !== 'eof') {
    addDiagnostic('unsupported-syntax', 'ENDMODULE 后不允许出现尾随内容')
    while (current().kind !== 'eof') advance()
  }

  resolveReferences()

  const program: RapidExecutableInstruction[] = []
  for (const pending of pendingMotions) {
    let valid = true

    // 目标：普通名称或 Offs/RelTool 表达式；基准必须是用户声明的 robtarget（未定义诊断已由 resolveReferences 发出）。
    const baseValue = symbols.get(normalizeName(pending.target.baseName))?.value
    const baseTarget = baseValue?.kind === 'robtarget' ? baseValue.value : null
    let resolvedTarget = baseTarget
    if (baseTarget && pending.target.kind !== 'name') {
      const { dx, dy, dz } = pending.target
      resolvedTarget =
        pending.target.kind === 'offs'
          ? offsRobTarget(baseTarget, dx!, dy!, dz!)
          : relToolRobTarget(baseTarget, dx!, dy!, dz!, pending.target.rx, pending.target.ry, pending.target.rz)
    }
    if (!resolvedTarget) valid = false

    // 其余操作数：用户符号优先，其次系统预定义；未定义诊断已在 resolveReferences 发出。
    const speed = resolveSpeed(pending.speedName)
    const zone = resolveZone(pending.zoneName)
    const tool = resolveTool(pending.toolName)
    const wobj = resolveWobj(pending.wobjName)

    // MVP 能力门：vmax 依赖机器人型号暂不执行；非 fine zone（z0..z200）票据 04 起可执行（以安全停点近似），
    // fly-by 语义与“未模拟路径融合”提示由运行时/观察区呈现。
    if (speed && !Number.isFinite(speed.v_tcp)) {
      addDiagnostic('unsupported-option', `vmax 依赖当前机器人型号的最大速度，暂无运行期解析`, pending.speedToken)
      valid = false
    }

    if (!valid || !resolvedTarget || !speed || !zone || !tool || !wobj) continue

    program.push({
      kind: pending.kind,
      target: cloneTarget(resolvedTarget),
      speed: cloneSpeed(speed),
      zone: { ...zone },
      tool: cloneTool(tool),
      wobj: cloneWobj(wobj),
      sourceRange: pending.range,
      sourceText: pending.sourceText,
      operands: {
        target: pending.target.sourceText,
        speed: pending.speedName,
        zone: pending.zoneName,
        tool: pending.toolName,
        wobj: pending.wobjName,
      },
      operandRanges: {
        target: pending.target.range,
        speed: rangeFromToken(pending.speedToken, lineStarts),
        zone: rangeFromToken(pending.zoneToken, lineStarts),
        tool: rangeFromToken(pending.toolToken, lineStarts),
        wobj: pending.wobjToken ? rangeFromToken(pending.wobjToken, lineStarts) : null,
      },
    })
  }

  if (mainCount === 0) {
    addDiagnostic('missing-entrypoint', 'RAPID 源程序必须包含无参数 PROC main()')
  }

  // 稳定诊断契约：按 (start.offset, end.offset, 生成次序) 升序排列，并按 相同 code + 相同起止 offset 去重，
  // 使同一源码重复解析得到顺序完全一致、无重复项的诊断列表。
  diagnostics.sort((a, b) => {
    const aStart = a.range.start.offset
    const bStart = b.range.start.offset
    if (aStart !== bStart) return aStart - bStart
    return a.range.end.offset - b.range.end.offset
  })
  for (let index = 1; index < diagnostics.length; index += 1) {
    const prev = diagnostics[index - 1]
    const cur = diagnostics[index]
    if (
      prev.code === cur.code &&
      prev.range.start.offset === cur.range.start.offset &&
      prev.range.end.offset === cur.range.end.offset
    ) {
      diagnostics.splice(index, 1)
      index -= 1
    }
  }

  /** 构建系统预定义只读条目（tool0/wobj0/load0/官方 speed/zone）；源码范围为空，引用数来自 systemReferences。 */
  function buildSystemDataEntries(): RapidProgramData[] {
    const entries: RapidProgramData[] = []
    const emptyRange = (): RapidSourceRange => {
      const at = { offset: 0, line: 1, column: 1 }
      return { start: { ...at }, end: { ...at } }
    }
    const refs = (name: string): RapidSourceRange[] =>
      (systemReferences.get(normalizeName(name)) ?? []).map((range) => ({ ...range }))
    const emptyBase = (name: string, storage: 'const' | 'pers' | 'var') => ({
      name,
      storage,
      system: true,
      declarationRange: emptyRange(),
      nameRange: emptyRange(),
      valueRange: emptyRange(),
      referenceRanges: refs(name),
    })

    for (const [name, tool] of Object.entries(SYSTEM_TOOLDATA)) {
      entries.push({ ...emptyBase(name, 'pers'), kind: 'tooldata', value: cloneTool(tool) })
    }
    for (const [name, wobj] of Object.entries(SYSTEM_WOBJDATA)) {
      entries.push({ ...emptyBase(name, 'pers'), kind: 'wobjdata', value: cloneWobj(wobj) })
    }
    for (const [name, load] of Object.entries(SYSTEM_LOADDATA)) {
      entries.push({
        ...emptyBase(name, 'pers'),
        kind: 'loaddata',
        value: { ...load, cog: [...load.cog], aom: [...load.aom] },
      })
    }
    for (const [name, speed] of Object.entries(SYSTEM_SPEED)) {
      entries.push({ ...emptyBase(name, 'const'), kind: 'speeddata', value: { ...speed } })
    }
    for (const [name, zone] of Object.entries(SYSTEM_ZONE)) {
      entries.push({ ...emptyBase(name, 'const'), kind: 'zonedata', value: { ...zone } })
    }
    return entries
  }

  // Program Data 视图：由同一份解析派生，声明顺序稳定；即使存在 error 也暴露已识别数据供只读浏览。
  // 用户声明在前（按声明顺序），系统预定义只读项在后。
  const data: RapidProgramData[] = []
  for (const entry of symbols.values()) {
    const base = {
      name: source.slice(entry.range.start.offset, entry.range.end.offset),
      storage: entry.storage,
      system: false,
      declarationRange: { ...entry.declarationRange },
      nameRange: entry.range,
      valueRange: { ...entry.valueRange },
      referenceRanges: entry.references.map((range) => ({ ...range })),
    }
    switch (entry.value.kind) {
      case 'robtarget':
        data.push({ ...base, kind: 'robtarget', target: cloneTarget(entry.value.value) })
        break
      case 'tooldata':
        data.push({ ...base, kind: 'tooldata', value: cloneTool(entry.value.value) })
        break
      case 'wobjdata':
        data.push({ ...base, kind: 'wobjdata', value: cloneWobj(entry.value.value) })
        break
      case 'loaddata':
        data.push({
          ...base,
          kind: 'loaddata',
          value: { ...entry.value.value, cog: [...entry.value.value.cog], aom: [...entry.value.value.aom] },
        })
        break
      case 'speeddata':
        data.push({ ...base, kind: 'speeddata', value: { ...entry.value.value } })
        break
      case 'zonedata':
        data.push({ ...base, kind: 'zonedata', value: { ...entry.value.value } })
        break
    }
  }
  // 系统预定义只读项（tool0/wobj0/load0/官方 speed/zone），不来自源码，故所有源码范围为空。
  data.push(...buildSystemDataEntries())

  const canExecute = diagnostics.length === 0 && moduleCount === 1 && mainCount === 1 && sawEndModule
  return {
    program: canExecute ? program : [],
    diagnostics,
    canExecute,
    data,
    dataInsertOffset,
    motionInsertionPoints,
  }
}
