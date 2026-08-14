import type {
  LoadData,
  RapidPose,
  RapidScalarKind,
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

/** 解析后交给 ProgramExecutor 的运动语句；源码范围用于回溯运行时规划错误，操作数名保留原始拼写。 */
export type RapidMotionInstruction = StructuredMotionInstruction & {
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
  /** 分支体末条语句跳过剩余 ELSEIF/ELSE 的内部目标；普通语句不设置。 */
  nextPointer?: number
}

/** 首期标量表达式的运算符；不扩展到字符串、数组或复合数据。 */
export type RapidScalarUnaryOperator = '+' | '-' | 'NOT'
export type RapidScalarBinaryOperator = '+' | '-' | '*' | '/' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'AND' | 'OR'

/** 赋值语句共用的最小表达式树；节点范围用于编辑器定位和运行时错误回溯。 */
export type RapidScalarExpression =
  | { kind: 'num-literal'; value: number; range: RapidSourceRange }
  | { kind: 'bool-literal'; value: boolean; range: RapidSourceRange }
  | { kind: 'variable'; name: string; range: RapidSourceRange }
  | { kind: 'group'; expression: RapidScalarExpression; range: RapidSourceRange }
  | { kind: 'unary'; operator: RapidScalarUnaryOperator; operand: RapidScalarExpression; range: RapidSourceRange }
  | {
      kind: 'binary'
      operator: RapidScalarBinaryOperator
      left: RapidScalarExpression
      right: RapidScalarExpression
      range: RapidSourceRange
    }

/** ProgramExecutor 的可执行赋值语句；valueKind 已由 parser 静态检查。 */
export interface RapidAssignmentInstruction {
  kind: 'assign'
  target: {
    name: string
    valueKind: RapidScalarKind
    range: RapidSourceRange
  }
  expression: RapidScalarExpression
  sourceRange: RapidSourceRange
  sourceText: string
  /** 分支体末条语句跳过剩余 ELSEIF/ELSE 的内部目标；普通赋值不设置。 */
  nextPointer?: number
}

/** parser 输出的唯一可执行计划：条件、运动与标量赋值按源码顺序共存。 */
export interface RapidConditionalInstruction {
  kind: 'if'
  /** 当前条件来自 IF 还是 ELSEIF，供教学摘要区分语义。 */
  conditionKind: 'if' | 'elseif'
  condition: RapidScalarExpression
  /** 条件为真/假时跳到的下一条可见语句；parser 保证目标落在计划边界内。 */
  trueTarget: number
  falseTarget: number
  sourceRange: RapidSourceRange
  sourceText: string
}

/** WHILE 循环头指令：条件为真进循环体，为假退出；循环体末条 nextPointer 回跳本头。 */
export interface RapidWhileInstruction {
  kind: 'while'
  condition: RapidScalarExpression
  /** 条件为真时进入的循环体首条；为假时的退出点。 */
  trueTarget: number
  falseTarget: number
  sourceRange: RapidSourceRange
  sourceText: string
}

/** FOR 循环头指令：FROM a TO b STEP s，循环变量须已声明 VAR num。 */
export interface RapidForInstruction {
  kind: 'for'
  loopVar: {
    name: string
    range: RapidSourceRange
  }
  fromExpr: RapidScalarExpression
  toExpr: RapidScalarExpression
  /** 可选 STEP 步长；省略时为 null（按 1 处理）。 */
  stepExpr: RapidScalarExpression | null
  /** 进入循环体首条；条件终结时的退出点。 */
  trueTarget: number
  falseTarget: number
  sourceRange: RapidSourceRange
  sourceText: string
}

/** EXITDO：循环体内提前退出当前循环，跳到循环头设定的退出点。 */
export interface RapidExitInstruction {
  kind: 'exitdo'
  target: number
  sourceRange: RapidSourceRange
  sourceText: string
}

/** parser 输出的唯一可执行计划：条件、循环、运动与标量赋值按源码顺序共存。 */
export type RapidExecutableInstruction =
  | RapidMotionInstruction
  | RapidAssignmentInstruction
  | RapidConditionalInstruction
  | RapidWhileInstruction
  | RapidForInstruction
  | RapidExitInstruction

export function isRapidMotionInstruction(
  instruction: RapidExecutableInstruction,
): instruction is RapidMotionInstruction {
  return instruction.kind === 'movej' || instruction.kind === 'movel'
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
  /** 模块级命名数据的派生 Program Data 视图：六类运动数据与 num/bool 标量；来自同一次解析，无第二份状态。 */
  data: readonly RapidProgramData[]
  /** 新模块级声明的插入偏移（位于 main PROC 之前）。 */
  dataInsertOffset: number
  /** main 内所有合法插入位置，最后一项表示追加到程序末尾。 */
  motionInsertionPoints: readonly RapidMotionInsertionPoint[]
}

/** Program Data 数据种类：六类 ABB 运动数据记录与首期 num/bool 标量。 */
export type RapidDataKind =
  | 'robtarget'
  | 'tooldata'
  | 'wobjdata'
  | 'loaddata'
  | 'speeddata'
  | 'zonedata'
  | RapidScalarKind

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
 * Program Data 条目：按 kind 区分运动数据与标量，携带各自结构化值。系统预定义项（system=true）
 * 的 nameRange/valueRange/declarationRange 为源码中的空范围（不存在于源码中）。
 */
export type RapidProgramData =
  | (RapidProgramDataBase & { kind: 'robtarget'; target: RobTarget })
  | (RapidProgramDataBase & { kind: 'tooldata'; value: ToolData })
  | (RapidProgramDataBase & { kind: 'wobjdata'; value: WobjData })
  | (RapidProgramDataBase & { kind: 'loaddata'; value: LoadData })
  | (RapidProgramDataBase & { kind: 'speeddata'; value: SpeedData })
  | (RapidProgramDataBase & { kind: 'zonedata'; value: ZoneData })
  | (RapidProgramDataBase & { kind: 'num'; value: number })
  | (RapidProgramDataBase & { kind: 'bool'; value: boolean })

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

type PendingTargetExpressionKind = Exclude<PendingTarget['kind'], 'name'>

interface PendingReference {
  kind: OperandKind
  token: Token
  /** 位置函数基准的语义类型；用于把已声明但类型错误的名称诊断为 invalid-data。 */
  targetExpression?: PendingTargetExpressionKind
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

interface PendingAssignment {
  targetToken: Token
  expression: RapidScalarExpression
  range: RapidSourceRange
  sourceText: string
}

interface PendingConditionalBranch {
  conditionKind: 'if' | 'elseif'
  condition: RapidScalarExpression | null
  range: RapidSourceRange
  sourceText: string
  statements: PendingStatement[]
}

interface PendingConditional {
  branches: PendingConditionalBranch[]
  elseStatements: PendingStatement[] | null
}

interface PendingWhile {
  condition: RapidScalarExpression | null
  conditionToken: Token
  sourceText: string
  range: RapidSourceRange
  statements: PendingStatement[]
}

interface PendingFor {
  loopVarToken: Token
  fromExpr: RapidScalarExpression | null
  toExpr: RapidScalarExpression | null
  stepExpr: RapidScalarExpression | null
  sourceText: string
  range: RapidSourceRange
  statements: PendingStatement[]
}

/** 循环内每个 EXITDO 在 parse 阶段按出现顺序暂存，resolve 时填充循环退出目标。 */
interface PendingExit {
  token: Token
  sourceText: string
  range: RapidSourceRange
}

type PendingStatement =
  | { kind: 'motion'; motion: PendingMotion }
  | { kind: 'assign'; assignment: PendingAssignment }
  | { kind: 'conditional'; conditional: PendingConditional }
  | { kind: 'while'; whileLoop: PendingWhile }
  | { kind: 'for'; forLoop: PendingFor }
  | { kind: 'exitdo'; exit: PendingExit }

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
    | { kind: 'num'; value: number }
    | { kind: 'bool'; value: boolean }
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

/** 数字 token 不吞掉前置正负号；这样 `a-1` 与 `a - 1` 具有相同的表达式结构。 */
const NUMBER_PATTERN = /^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/

/**
 * 真实 RAPID 数据类型中本项目尚未支持的类型名。用于区分“漏写数据类型”
 * （后面跟的是名称）与“使用了已知但不支持的类型”。
 * 六类已支持的运动数据类型与首期 num/bool 标量不在此列。
 */
const KNOWN_UNSUPPORTED_TYPES = new Set([
  'pos',
  'shapedata',
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
  num: 'num',
  bool: 'bool',
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

    const comparison = ['<>', '<=', '>='].find((operator) => rest.startsWith(operator))
    if (comparison) {
      tokens.push({ kind: 'symbol', text: comparison, start: index, end: index + comparison.length })
      index += comparison.length
      continue
    }

    if ('[](),;+-*/=<>\\'.includes(character)) {
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
  // main 内的赋值与运动按源码顺序暂存，最终形成唯一可执行 program 数组。
  const pendingStatements: PendingStatement[] = []
  // 解析条件体/循环体时临时切换到区块自己的语句容器；最终仍会展平为同一 program 数组。
  let statementSink = pendingStatements
  // 当前处于几层循环体内：EXITDO 只在 loopDepth>0 时合法。
  let loopDepth = 0
  const pendingReferences: PendingReference[] = []
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
  /** 源码中识别到的运动起点，包含语句损坏但仍可作为受控插入锚点的位置。 */
  const motionAnchors: Array<{ offset: number; line: number }> = []
  let mainEndOffset = 0

  function current(): Token {
    return tokens[cursor] ?? tokens[tokens.length - 1]
  }

  function peek(offset = 1): Token {
    return tokens[cursor + offset] ?? tokens[tokens.length - 1]
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
      text === 'endfor' ||
      text === 'elseif' ||
      text === 'else'
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
      const value = parseFiniteNumber(fieldName)
      if (value === null) {
        malformed = true
        // parseFiniteNumber 对逗号、右括号等边界不消费当前 token；恢复必须主动前进，避免死循环。
        if (!isSymbol(current(), ',') && !isSymbol(current(), ']') && current().kind !== 'eof') advance()
      } else {
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

  /** 读取一个有限数值（可带独立正负号）token，非有限或缺失返回 null。 */
  function parseFiniteNumber(fieldName: string): number | null {
    let sign = ''
    if (isSymbol(current(), '+') || isSymbol(current(), '-')) sign = advance().text
    if (current().kind !== 'number') {
      addMissingDiagnostic('invalid-data', `${fieldName} 必须是数字`, current())
      // 非分隔符的非法值属于当前字段，主动消费它；否则后续字段会在同一 token 上重复报错。
      if (
        current().kind !== 'eof' &&
        !isSymbol(current(), ',') &&
        !isSymbol(current(), ']') &&
        !isSymbol(current(), ')') &&
        !isSymbol(current(), ';')
      ) {
        advance()
      }
      return null
    }
    const token = advance()
    const value = Number(`${sign}${token.text}`)
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
      case 'num': {
        const value = parseFiniteNumber('num 初值')
        return value === null ? null : { kind: 'num', value }
      }
      case 'bool': {
        const value = parseBool('bool 初值')
        return value === null ? null : { kind: 'bool', value }
      }
      default:
        return null
    }
  }

  function parseScalarPrimary(): RapidScalarExpression | null {
    const token = current()
    if (token.kind === 'number') {
      advance()
      const value = Number(token.text)
      if (!Number.isFinite(value)) {
        addDiagnostic('invalid-data', '表达式包含非有限数字', token)
        return null
      }
      return { kind: 'num-literal', value, range: rangeFromToken(token, lineStarts) }
    }
    if (isKeyword(token, 'TRUE') || isKeyword(token, 'FALSE')) {
      advance()
      return {
        kind: 'bool-literal',
        value: isKeyword(token, 'TRUE'),
        range: rangeFromToken(token, lineStarts),
      }
    }
    if (token.kind === 'identifier') {
      advance()
      return { kind: 'variable', name: token.text, range: rangeFromToken(token, lineStarts) }
    }
    if (isSymbol(token, '(')) {
      const open = advance()
      const expression = parseScalarOr()
      const close = expectSymbol(')')
      if (!expression) return null
      return {
        kind: 'group',
        expression,
        range: rangeFromOffsets(open.start, close?.end ?? expression.range.end.offset, lineStarts),
      }
    }
    addMissingDiagnostic('syntax-error', '期望标量表达式', token)
    return null
  }

  function parseScalarUnary(): RapidScalarExpression | null {
    const token = current()
    if (isSymbol(token, '+') || isSymbol(token, '-')) {
      const operator = advance().text as '+' | '-'
      const operand = parseScalarUnary()
      if (!operand) return null
      return {
        kind: 'unary',
        operator,
        operand,
        range: rangeFromOffsets(token.start, operand.range.end.offset, lineStarts),
      }
    }
    if (isKeyword(token, 'NOT')) {
      advance()
      const operand = parseScalarUnary()
      if (!operand) return null
      return {
        kind: 'unary',
        operator: 'NOT',
        operand,
        range: rangeFromOffsets(token.start, operand.range.end.offset, lineStarts),
      }
    }
    return parseScalarPrimary()
  }

  function parseScalarBinary(
    parseOperand: () => RapidScalarExpression | null,
    operators: readonly string[],
  ): RapidScalarExpression | null {
    let left = parseOperand()
    while (
      left &&
      operators.some((operator) =>
        operator.length > 1 ? normalizeName(current().text) === normalizeName(operator) : current().text === operator,
      )
    ) {
      const operatorToken = advance()
      const operator = operatorToken.text.length > 1 ? normalizeName(operatorToken.text).toUpperCase() : operatorToken.text
      const right = parseOperand()
      if (!right) return null
      left = {
        kind: 'binary',
        operator: operator as RapidScalarBinaryOperator,
        left,
        right,
        range: rangeFromOffsets(left.range.start.offset, right.range.end.offset, lineStarts),
      }
    }
    return left
  }

  /** ABB 标量子集的优先级：NOT/正负号 > 乘除 > 加减 > 比较 > AND > OR。 */
  function parseScalarMultiplicative(): RapidScalarExpression | null {
    return parseScalarBinary(parseScalarUnary, ['*', '/'])
  }

  function parseScalarAdditive(): RapidScalarExpression | null {
    return parseScalarBinary(parseScalarMultiplicative, ['+', '-'])
  }

  function parseScalarComparison(): RapidScalarExpression | null {
    return parseScalarBinary(parseScalarAdditive, ['=', '<>', '<', '<=', '>', '>='])
  }

  function parseScalarAnd(): RapidScalarExpression | null {
    return parseScalarBinary(parseScalarComparison, ['AND'])
  }

  function parseScalarOr(): RapidScalarExpression | null {
    return parseScalarBinary(parseScalarAnd, ['OR'])
  }

  function parseAssignment(): void {
    const target = expectIdentifier('赋值目标变量')
    const assign = expectSymbol(':=')
    const expression = parseScalarOr()
    const semicolon = expectSymbol(';')
    if (!target || !assign || !expression || !semicolon) return
    statementSink.push({
      kind: 'assign',
      assignment: {
        targetToken: target,
        expression,
        range: rangeFromOffsets(target.start, semicolon.end, lineStarts),
        sourceText: source.slice(target.start, semicolon.end),
      },
    })
  }

  function scalarExpressionType(expression: RapidScalarExpression): RapidScalarKind | null {
    switch (expression.kind) {
      case 'num-literal':
        return 'num'
      case 'bool-literal':
        return 'bool'
      case 'group':
        return scalarExpressionType(expression.expression)
      case 'variable': {
        const symbol = symbols.get(normalizeName(expression.name))
        if (!symbol) {
          addDiagnostic('undefined-symbol', `未定义变量 ${expression.name}`, {
            kind: 'identifier',
            text: expression.name,
            start: expression.range.start.offset,
            end: expression.range.end.offset,
          })
          return null
        }
        if (symbol.kind !== 'num' && symbol.kind !== 'bool') {
          addDiagnostic('unsupported-option', `表达式只支持 num/bool 变量，${expression.name} 是 ${symbol.kind}`)
          return null
        }
        return symbol.kind
      }
      case 'unary': {
        const operandType = scalarExpressionType(expression.operand)
        const expected = expression.operator === 'NOT' ? 'bool' : 'num'
        if (operandType && operandType !== expected) {
          addDiagnostic('invalid-data', `${expression.operator} 运算要求 ${expected}，实际为 ${operandType}`, {
            kind: 'symbol',
            text: expression.operator,
            start: expression.range.start.offset,
            end: expression.range.start.offset + expression.operator.length,
          })
          return null
        }
        return operandType ? expected : null
      }
      case 'binary': {
        const leftType = scalarExpressionType(expression.left)
        const rightType = scalarExpressionType(expression.right)
        const operator = expression.operator
        if (operator === '+' || operator === '-' || operator === '*' || operator === '/') {
          if (leftType && leftType !== 'num' || rightType && rightType !== 'num') {
            addDiagnostic('invalid-data', `${operator} 运算要求两侧都是 num`)
            return null
          }
          return leftType && rightType ? 'num' : null
        }
        if (operator === 'AND' || operator === 'OR') {
          if (leftType && leftType !== 'bool' || rightType && rightType !== 'bool') {
            addDiagnostic('invalid-data', `${operator} 运算要求两侧都是 bool`)
            return null
          }
          return leftType && rightType ? 'bool' : null
        }
        if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
          if (leftType && leftType !== 'num' || rightType && rightType !== 'num') {
            addDiagnostic('invalid-data', `${operator} 比较要求两侧都是 num`)
            return null
          }
          return leftType && rightType ? 'bool' : null
        }
        if (leftType && rightType && leftType !== rightType) {
          addDiagnostic('invalid-data', `${operator} 比较要求两侧类型一致`)
          return null
        }
        return leftType && rightType ? 'bool' : null
      }
    }
  }

  function resolveAssignment(pending: PendingAssignment): RapidAssignmentInstruction | null {
    const symbol = symbols.get(normalizeName(pending.targetToken.text))
    let targetKind: RapidScalarKind | null = null
    if (!symbol) {
      addDiagnostic('undefined-symbol', `未定义变量 ${pending.targetToken.text}`, pending.targetToken)
    } else if (
      (symbol.kind !== 'num' && symbol.kind !== 'bool') ||
      symbol.storage !== 'var'
    ) {
      addDiagnostic('unsupported-option', `赋值目标 ${pending.targetToken.text} 只能是 VAR num/bool`, pending.targetToken)
    } else {
      targetKind = symbol.kind
    }

    const expressionKind = scalarExpressionType(pending.expression)
    if (targetKind && expressionKind && targetKind !== expressionKind) {
      addDiagnostic(
        'invalid-data',
        `变量 ${pending.targetToken.text} 的赋值类型必须是 ${targetKind}，实际为 ${expressionKind}`,
        pending.targetToken,
      )
      return null
    }
    if (!targetKind || !expressionKind || targetKind !== expressionKind) return null
    return {
      kind: 'assign',
      target: {
        name: pending.targetToken.text,
        valueKind: targetKind,
        range: rangeFromToken(pending.targetToken, lineStarts),
      },
      expression: pending.expression,
      sourceRange: pending.range,
      sourceText: pending.sourceText,
    }
  }

  /** 存储类别是否符合当前支持范围；标量只接受模块级 VAR，运动数据遵循各自已有规则。 */
  function validateStorage(kind: RapidDataKind, storageKind: 'const' | 'pers' | 'var', typeName: string): boolean {
    if (kind === 'num' || kind === 'bool') {
      if (storageKind !== 'var') {
        addDiagnostic('unsupported-option', `${typeName} 当前只支持模块级 VAR 声明`)
        return false
      }
      return true
    }
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
        `缺少数据类型（期望 robtarget/tooldata/wobjdata/loaddata/speeddata/zonedata/num/bool）`,
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
  function queueReference(
    kind: OperandKind,
    nameToken: Token,
    targetExpression?: PendingTargetExpressionKind,
  ): void {
    pendingReferences.push({ kind, token: nameToken, targetExpression })
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
        // 同名符号必须与被引用操作数角色匹配（例如 robtarget 不能用作 speed）；
        // Offs/RelTool 基准的类型错误由位置函数语义单独报 invalid-data。
        if (symbol.kind === expectedKind) {
          symbol.references.push(range)
        } else if (ref.kind === 'target' && ref.targetExpression) {
          addDiagnostic(
            'invalid-data',
            `${ref.targetExpression === 'offs' ? 'Offs' : 'RelTool'} 的基准 ${ref.token.text} 必须是 robtarget，实际是 ${symbol.kind}`,
            ref.token,
          )
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
   * Offs(p,[x,y,z]) / RelTool(p,[dx,dy,dz[,rx,ry,rz]]) 参数为数值字面量；RelTool 还接受
   * `\\Rx:=`、`\\Ry:=`、`\\Rz:=` 命名旋转开关。缺失基准、参数数量错误、非数值参数或缺失括号
   * 均给出精确诊断并中止整条运动。
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
        const value = parseFiniteNumber(`${first.text} 的参数`)
        if (value === null) {
          recoverMotionTail()
          onAbort()
          return { target: null, separatorConsumed: false }
        }
        params.push(value)
      }

      let namedRotationCount = 0
      let namedRx: number | undefined
      let namedRy: number | undefined
      let namedRz: number | undefined
      const namedRotationNames = new Set<string>()
      if (keyword === 'reltool') {
        while (isSymbol(current(), '\\')) {
          advance()
          const option = expectIdentifier('RelTool 可选参数名称')
          if (!option) {
            recoverMotionTail()
            onAbort()
            return { target: null, separatorConsumed: false }
          }
          const optionName = normalizeName(option.text)
          if (optionName !== 'rx' && optionName !== 'ry' && optionName !== 'rz') {
            addDiagnostic('unsupported-option', `不支持 RelTool 可选参数 ${option.text}`, option)
            recoverMotionTail()
            onAbort()
            return { target: null, separatorConsumed: false }
          }
          if (namedRotationNames.has(optionName)) {
            addDiagnostic('unsupported-option', `重复的 RelTool 可选参数 ${option.text}`, option)
            recoverMotionTail()
            onAbort()
            return { target: null, separatorConsumed: false }
          }
          namedRotationNames.add(optionName)
          namedRotationCount += 1
          const assign = expectSymbol(':=')
          const value = parseFiniteNumber(`RelTool ${option.text} 的参数`)
          if (!assign || value === null) {
            recoverMotionTail()
            onAbort()
            return { target: null, separatorConsumed: false }
          }
          if (optionName === 'rx') namedRx = value
          if (optionName === 'ry') namedRy = value
          if (optionName === 'rz') namedRz = value
        }
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
      if (keyword === 'reltool' && namedRotationCount > 0 && paramCount !== 3) {
        addDiagnostic('invalid-data', `RelTool 使用命名旋转开关时必须有 3 个平移参数，实际 ${paramCount} 个`, first)
        return { target: null, separatorConsumed: false }
      }
      if (keyword === 'reltool' && namedRotationCount === 0 && paramCount !== 3 && paramCount !== 6) {
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
          rx: namedRotationCount > 0 ? namedRx : paramCount === 6 ? rx : undefined,
          ry: namedRotationCount > 0 ? namedRy : paramCount === 6 ? ry : undefined,
          rz: namedRotationCount > 0 ? namedRz : paramCount === 6 ? rz : undefined,
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
    motionAnchors.push({ offset: start.start, line: positionAt(start.start, lineStarts).line })
    let abandoned = false
    const abort = (): void => {
      abandoned = true
    }

    const targetResult = parseTargetOperand(abort)
    const target = targetResult.target
    let separatorConsumed = targetResult.separatorConsumed
    if (target) {
      queueReference(
        'target',
        target.baseToken,
        target.kind === 'name' ? undefined : target.kind,
      )
    }
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
    statementSink.push({
      kind: 'motion',
      motion: {
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
      },
    })
  }

  function skipUnsupportedControl(): void {
    const token = advance()
    addDiagnostic('unsupported-syntax', `首期不支持 ${token.text} 控制流`, token)
    while (current().kind !== 'eof' && !isSymbol(current(), ';')) advance()
    if (isSymbol(current(), ';')) advance()
  }

  function parseStatementList(terminators: ReadonlySet<string>): void {
    while (
      current().kind !== 'eof' &&
      !isKeyword(current(), 'ENDPROC') &&
      !isKeyword(current(), 'ENDMODULE') &&
      !terminators.has(current().text)
    ) {
      if (isKeyword(current(), 'MOVEJ') || isKeyword(current(), 'MOVEL')) {
        parseMotion()
      } else if (current().kind === 'identifier' && isSymbol(peek(), ':=')) {
        parseAssignment()
      } else if (isKeyword(current(), 'IF')) {
        parseConditional()
      } else if (isKeyword(current(), 'WHILE')) {
        parseWhile()
      } else if (isKeyword(current(), 'FOR')) {
        parseFor()
      } else if (isKeyword(current(), 'EXITDO')) {
        parseExitDo()
      } else if (
        isKeyword(current(), 'MOVEABSJ') ||
        isKeyword(current(), 'MOVEC')
      ) {
        skipUnsupportedControl()
      } else if (
        isKeyword(current(), 'ELSEIF') ||
        isKeyword(current(), 'ELSE') ||
        isKeyword(current(), 'ENDIF') ||
        isKeyword(current(), 'ENDWHILE') ||
        isKeyword(current(), 'ENDFOR')
      ) {
        addDiagnostic('syntax-error', `${current().text} 没有对应的 IF/WHILE/FOR 控制流结束结构`)
        advance()
      } else {
        addDiagnostic('unsupported-syntax', `首期不支持 ${current().text || '空语句'}`)
        skipToStatementEnd()
      }
    }
  }

  /** 解析 WHILE 条件循环；循环体内支持嵌套 IF/循环/赋值/运动。 */
  function parseWhile(): void {
    const start = advance()
    const condition = parseScalarOr()
    const doToken = expectKeyword('DO')
    const statements: PendingStatement[] = []
    loopDepth += 1
    const previousSink = statementSink
    statementSink = statements
    parseStatementList(new Set(['ENDWHILE']))
    statementSink = previousSink
    loopDepth -= 1
    const end = expectKeyword('ENDWHILE')
    if (!end) return
    const headerEnd = doToken?.end ?? condition?.range.end.offset ?? start.end
    statementSink.push({
      kind: 'while',
      whileLoop: {
        condition,
        conditionToken: start,
        range: rangeFromOffsets(start.start, headerEnd, lineStarts),
        sourceText: source.slice(start.start, headerEnd),
        statements,
      },
    })
  }

  /** 解析 FOR 计数循环：FOR i FROM a TO b STEP s DO ... ENDFOR。 */
  function parseFor(): void {
    const start = advance()
    const loopVarToken = expectIdentifier('FOR 循环变量')
    if (!loopVarToken) return
    expectKeyword('FROM')
    const fromExpr = parseScalarOr()
    expectKeyword('TO')
    const toExpr = parseScalarOr()
    let stepExpr: RapidScalarExpression | null = null
    if (isKeyword(current(), 'STEP')) {
      advance()
      stepExpr = parseScalarOr()
    }
    const doToken = expectKeyword('DO')
    const statements: PendingStatement[] = []
    loopDepth += 1
    const previousSink = statementSink
    statementSink = statements
    parseStatementList(new Set(['ENDFOR']))
    statementSink = previousSink
    loopDepth -= 1
    const end = expectKeyword('ENDFOR')
    if (!end) return
    const headerEnd = doToken?.end ?? toExpr?.range.end.offset ?? start.end
    statementSink.push({
      kind: 'for',
      forLoop: {
        loopVarToken,
        fromExpr,
        toExpr,
        stepExpr,
        range: rangeFromOffsets(start.start, headerEnd, lineStarts),
        sourceText: source.slice(start.start, headerEnd),
        statements,
      },
    })
  }

  /** EXITDO 只能出现在循环体内；循环外给出诊断并阻止该语句。 */
  function parseExitDo(): void {
    const start = advance()
    if (loopDepth === 0) {
      addDiagnostic('syntax-error', 'EXITDO 只能出现在循环体内', start)
      skipToStatementEnd()
      return
    }
    const semicolon = expectSymbol(';')
    if (!semicolon) return
    statementSink.push({
      kind: 'exitdo',
      exit: {
        token: start,
        range: rangeFromOffsets(start.start, semicolon.end, lineStarts),
        sourceText: source.slice(start.start, semicolon.end),
      },
    })
  }

  function parseConditionalBranch(
    conditionKind: PendingConditionalBranch['conditionKind'],
    start: Token,
  ): PendingConditionalBranch {
    const condition = parseScalarOr()
    const thenToken = expectKeyword('THEN')
    const statements: PendingStatement[] = []
    const previousSink = statementSink
    statementSink = statements
    parseStatementList(new Set(['ELSEIF', 'ELSE', 'ENDIF']))
    statementSink = previousSink
    const headerEnd = thenToken?.end ?? condition?.range.end.offset ?? start.end
    return {
      conditionKind,
      condition,
      range: rangeFromOffsets(start.start, headerEnd, lineStarts),
      sourceText: source.slice(start.start, headerEnd),
      statements,
    }
  }

  function skipConditionalTail(): void {
    while (
      current().kind !== 'eof' &&
      !isKeyword(current(), 'ENDIF') &&
      !isKeyword(current(), 'ENDPROC') &&
      !isKeyword(current(), 'ENDMODULE')
    ) {
      advance()
    }
  }

  function parseConditional(): void {
    const ifToken = advance()
    const branches: PendingConditionalBranch[] = [parseConditionalBranch('if', ifToken)]
    while (isKeyword(current(), 'ELSEIF')) {
      const elseifToken = advance()
      branches.push(parseConditionalBranch('elseif', elseifToken))
    }

    let elseStatements: PendingStatement[] | null = null
    if (isKeyword(current(), 'ELSE')) {
      advance()
      elseStatements = []
      const previousSink = statementSink
      statementSink = elseStatements
      parseStatementList(new Set(['ELSEIF', 'ELSE', 'ENDIF']))
      statementSink = previousSink
      if (isKeyword(current(), 'ELSE') || isKeyword(current(), 'ELSEIF')) {
        addDiagnostic('syntax-error', 'ELSEIF/ELSE 不能出现在 ELSE 分支之后', current())
        skipConditionalTail()
      }
    }

    const end = expectKeyword('ENDIF')
    if (!end) return
    statementSink.push({ kind: 'conditional', conditional: { branches, elseStatements } })
  }

  function parseMainBody(): void {
    parseStatementList(new Set())
    mainEndOffset = current().start
    expectKeyword('ENDPROC')
  }

  function skipProcedureBody(): void {
    // 非 main 过程不进入可执行计划，但仍扫描最小能力边界，避免把局部越界声明和 vmax 静默吞掉。
    while (current().kind !== 'eof' && !isKeyword(current(), 'ENDPROC')) {
      const token = current()
      if (isKeyword(token, 'VMAX')) {
        addDiagnostic('unsupported-option', 'vmax 依赖当前机器人型号的最大速度，暂无运行期解析', token)
      } else if (
        isKeyword(token, 'CONST') ||
        isKeyword(token, 'PERS') ||
        isKeyword(token, 'TASK') ||
        isKeyword(token, 'VAR')
      ) {
        const type = peek()
        const typeName = normalizeName(type.text)
        if (type.kind === 'identifier' && (typeName === 'num' || typeName === 'bool' || KNOWN_UNSUPPORTED_TYPES.has(typeName))) {
          addDiagnostic('unsupported-option', `非 main 过程暂不支持 ${type.text} 声明`, type)
        }
      }
      advance()
    }
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
  function resolveMotion(pending: PendingMotion): RapidMotionInstruction | null {
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

    if (!valid || !resolvedTarget || !speed || !zone || !tool || !wobj) return null

    return {
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
    }
  }

  function resolveLeaf(statement: PendingStatement): RapidExecutableInstruction | null {
    if (statement.kind === 'assign') return resolveAssignment(statement.assignment)
    if (statement.kind === 'motion') return resolveMotion(statement.motion)
    return null
  }

  function setBranchExit(instruction: RapidExecutableInstruction, target: number): void {
    if (instruction.kind === 'movej' || instruction.kind === 'movel' || instruction.kind === 'assign') {
      instruction.nextPointer = target
    }
  }

  function appendConditional(conditional: PendingConditional, output: RapidExecutableInstruction[]): void {
    if (conditional.branches.some((branch) => branch.condition === null)) return
    for (const branch of conditional.branches) {
      const condition = branch.condition
      if (!condition) return
      const expressionKind = scalarExpressionType(condition)
      if (expressionKind && expressionKind !== 'bool') {
        diagnostics.push({
          code: 'invalid-data',
          severity: 'error',
          message: 'IF/ELSEIF 条件必须是 bool',
          range: condition.range,
        })
      }
    }

    const conditionIndices: number[] = []
    const branchBodies: Array<{ start: number; end: number }> = []
    for (const branch of conditional.branches) {
      const condition = branch.condition
      if (!condition) return
      const conditionIndex = output.length
      conditionIndices.push(conditionIndex)
      output.push({
        kind: 'if',
        conditionKind: branch.conditionKind,
        condition,
        trueTarget: 0,
        falseTarget: 0,
        sourceRange: branch.range,
        sourceText: branch.sourceText,
      })
      const bodyStart = output.length
      appendBody(branch.statements, output)
      branchBodies.push({ start: bodyStart, end: output.length })
    }

    const elseBody = conditional.elseStatements
      ? { start: output.length, end: output.length }
      : null
    if (conditional.elseStatements) {
      appendBody(conditional.elseStatements, output)
      if (elseBody) elseBody.end = output.length
    }

    const afterConditional = output.length
    for (let index = 0; index < branchBodies.length; index += 1) {
      const body = branchBodies[index]
      const condition = output[conditionIndices[index]]
      if (!condition || condition.kind !== 'if') continue
      const nextCondition = conditionIndices[index + 1]
      const falseTarget = nextCondition ?? elseBody?.start ?? afterConditional
      condition.trueTarget = body.start < body.end ? body.start : afterConditional
      condition.falseTarget = falseTarget
      if (body.end > body.start) setBranchExit(output[body.end - 1], afterConditional)
    }
    if (elseBody && elseBody.end > elseBody.start) {
      setBranchExit(output[elseBody.end - 1], afterConditional)
    }
  }

  function appendStatement(statement: PendingStatement, output: RapidExecutableInstruction[]): void {
    if (statement.kind === 'conditional') {
      appendConditional(statement.conditional, output)
      return
    }
    if (statement.kind === 'while') {
      appendWhile(statement.whileLoop, output)
      return
    }
    if (statement.kind === 'for') {
      appendFor(statement.forLoop, output)
      return
    }
    if (statement.kind === 'exitdo') {
      output.push({ kind: 'exitdo', target: 0, ...pendingExit(statement.exit) })
      return
    }
    const resolved = resolveLeaf(statement)
    if (resolved) output.push(resolved)
  }

  function pendingExit(exit: PendingExit): Pick<RapidExitInstruction, 'sourceRange' | 'sourceText'> {
    return { sourceRange: exit.range, sourceText: exit.sourceText }
  }

  /** 把分支/循环体内的语句展平进 output；支持条件/循环的递归嵌套。 */
  function appendBody(statements: PendingStatement[], output: RapidExecutableInstruction[]): void {
    for (const statement of statements) appendStatement(statement, output)
  }

  /** 收集 output[start,end) 范围内尚未绑定退出目标的 EXITDO 指令。
   *  内层循环先于外层展平并已把其 EXITDO 的目标设为非 0 的 afterLoop，
   *  因此这里只取 target 仍为 0（直属本层循环体）的 EXITDO，避免覆盖内层循环的退出点。 */
  function collectExitdos(
    output: RapidExecutableInstruction[],
    start: number,
    end: number,
  ): RapidExitInstruction[] {
    const exits: RapidExitInstruction[] = []
    for (let index = start; index < end; index += 1) {
      const instruction = output[index]
      if (instruction && instruction.kind === 'exitdo' && instruction.target === 0) {
        exits.push(instruction)
      }
    }
    return exits
  }

  /** 展平一个 WHILE 循环：循环头指令 + 循环体语句，循环体末条回跳循环头。 */
  function appendWhile(loop: PendingWhile, output: RapidExecutableInstruction[]): void {
    if (loop.condition === null) return
    const expressionKind = scalarExpressionType(loop.condition)
    if (expressionKind && expressionKind !== 'bool') {
      diagnostics.push({
        code: 'invalid-data',
        severity: 'error',
        message: 'WHILE 条件必须是 bool',
        range: loop.condition.range,
      })
    }

    const headIndex = output.length
    output.push({
      kind: 'while',
      condition: loop.condition,
      trueTarget: 0,
      falseTarget: 0,
      sourceRange: loop.range,
      sourceText: loop.sourceText,
    })
    const bodyStart = output.length
    appendBody(loop.statements, output)
    const bodyEnd = output.length
    // 循环体末条在完成正常流动后回跳循环头；空体无需设置回跳。
    if (bodyEnd > bodyStart) setBranchExit(output[bodyEnd - 1], headIndex)
    const afterLoop = output.length
    const whileHead = output[headIndex]
    if (whileHead && whileHead.kind === 'while') {
      whileHead.trueTarget = bodyEnd > bodyStart ? bodyStart : afterLoop
      whileHead.falseTarget = afterLoop
    }
    for (const exit of collectExitdos(output, bodyStart, bodyEnd)) exit.target = afterLoop
  }

  /** 展平一个 FOR 循环：循环头指令 + 循环体语句。 */
  function appendFor(loop: PendingFor, output: RapidExecutableInstruction[]): void {
    if (loop.fromExpr === null || loop.toExpr === null) return
    const headIndex = output.length
    output.push({
      kind: 'for',
      loopVar: { name: loop.loopVarToken.text, range: rangeFromToken(loop.loopVarToken, lineStarts) },
      fromExpr: loop.fromExpr,
      toExpr: loop.toExpr,
      stepExpr: loop.stepExpr,
      trueTarget: 0,
      falseTarget: 0,
      sourceRange: loop.range,
      sourceText: loop.sourceText,
    })
    const bodyStart = output.length
    appendBody(loop.statements, output)
    const bodyEnd = output.length
    if (bodyEnd > bodyStart) setBranchExit(output[bodyEnd - 1], headIndex)
    const afterLoop = output.length
    const forHead = output[headIndex]
    if (forHead && forHead.kind === 'for') {
      forHead.trueTarget = bodyEnd > bodyStart ? bodyStart : afterLoop
      forHead.falseTarget = afterLoop
    }
    for (const exit of collectExitdos(output, bodyStart, bodyEnd)) exit.target = afterLoop
  }

  for (const statement of pendingStatements) appendStatement(statement, program)

  // 受控插入仍以最终可执行计划的 program 下标为准；损坏运动用其源码位置映射到前方已解析指令数。
  motionInsertionPoints.length = 0
  for (const anchor of motionAnchors) {
    motionInsertionPoints.push({
      index: program.filter((instruction) => instruction.sourceRange.start.offset < anchor.offset).length,
      offset: anchor.offset,
      line: anchor.line,
    })
  }
  if (mainEndOffset > 0) {
    motionInsertionPoints.push({
      index: program.length,
      offset: mainEndOffset,
      line: positionAt(mainEndOffset, lineStarts).line,
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
      case 'num':
        data.push({ ...base, kind: 'num', value: entry.value.value })
        break
      case 'bool':
        data.push({ ...base, kind: 'bool', value: entry.value.value })
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
