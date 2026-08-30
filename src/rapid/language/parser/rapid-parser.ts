import type {
  LoadData,
  RapidScalarKind,
  RobTarget,
  SpeedData,
  StructuredMotionInstruction,
  ToolData,
  WobjData,
  ZoneData,
  SingAreaMode,
  ConfigurationMonitoringMode,
} from '../../data/index.ts'
import {
  cloneSpeed,
  cloneTarget,
  cloneTool,
  cloneWobj,
  NO_EXTERNAL_AXIS,
  SYSTEM_LOADDATA,
  SYSTEM_SPEED,
  SYSTEM_TOOLDATA,
  SYSTEM_WOBJDATA,
  SYSTEM_ZONE,
} from '../../data/index.ts'
import { offsRobTarget, relToolRobTarget } from '../../data/target-expression.ts'
import type { RapidSourceRange, Token } from '../rapid-lexer.ts'
import {
  buildLineStarts,
  lex,
  positionAt,
  rangeFromOffsets,
  rangeFromToken,
} from '../rapid-lexer.ts'
import type { RapidDiagnostic, RapidDiagnosticCode } from '../rapid-diagnostics.ts'
import { sortAndDedupeDiagnostics } from '../rapid-diagnostics.ts'
import type { OperandKind, RapidDataKind, SymbolEntry } from '../rapid-symbols.ts'
import {
  isKeyword,
  isSymbol,
  KNOWN_UNSUPPORTED_TYPES,
  MODULE_NAME_KEYWORDS,
  normalizeName,
  operandDescription,
  OPERAND_KIND_SYMBOL_KIND,
  systemNamespace,
} from '../rapid-symbols.ts'
import type { DataValidationContext } from '../rapid-data-validation.ts'
import { scalarExpressionType, type ScalarExpressionContext } from './scalar-expression.ts'
import { appendPendingStatements } from './control-flow.ts'
import {
  parseConditional as parseConditionalStatement,
  parseExitDo as parseExitDoStatement,
  parseFor as parseForStatement,
  parseWhile as parseWhileStatement,
  type ControlFlowParserContext,
} from './control-flow-parser.ts'
import {
  parseAssignment as parseAssignmentStatement,
  parseConfiguration as parseConfigurationStatement,
  parseMotion as parseMotionStatement,
  parseSingArea as parseSingAreaStatement,
} from '../../instructions/index.ts'
import { parseDataDeclaration as parseDataDeclarationStatement } from './data-declaration.ts'
import { parseStatementList as parseStatementListStatement } from './statement-parser.ts'
import type {
  PendingAssignment,
  PendingMotion,
  PendingReference,
  PendingStatement,
  PendingTarget,
  PendingTargetExpressionKind,
} from './pending-types.ts'

/**
 * RAPID 文本解析模块的公共入口。
 *
 * 本文件保持整个模块的稳定外部接口：所有调用方（program-executor、
 * application/program-control、各组件）从这里导入的结构化类型与 parseRapidProgram
 * 均不变。实现本身按职责拆分到同目录下的内部模块：
 *
 * - rapid-lexer.ts：词法分析与源码位置换算；
 * - rapid-diagnostics.ts：诊断模型与排序/去重契约；
 * - rapid-symbols.ts：符号表条目与操作数角色命名空间；
 * - rapid-data-validation.ts：静态数据记录字面量解析（深处实现）。
 * - parser/*.ts：数据声明、目标/运动语句、语句路由和控制流的强类型解析。
 *
 * 本文件保留 parser 编排、符号结算、指令结果组装和稳定的公开入口。
 */

export type { RapidSourcePosition, RapidSourceRange } from '../rapid-lexer.ts'
export type { RapidDiagnostic, RapidDiagnosticCode } from '../rapid-diagnostics.ts'
export type { RapidDataKind } from '../rapid-symbols.ts'

/** 解析后交给 ProgramExecutor 的运动语句；源码范围用于回溯运行时规划错误，操作数名保留原始拼写。 */
export type RapidMotionInstruction = StructuredMotionInstruction & {
  sourceRange: RapidSourceRange
  sourceText: string
  /** 运动操作数标识符（原始拼写），供结构化指令摘要展示，组件不另行解析 RAPID 字符串。 */
  operands: {
    /** FlexPendant 式未示教占位时为 '*'，此时 target 字段为零值占位（missing-target ⇒ canExecute=false，永不执行）。 */
    target: string
    /** MoveC 圆弧途经点（CirPoint）；movej/movel 不设置。 */
    cirPoint?: string
    speed: string
    zone: string
    tool: string
    wobj: string
  }
  /** 每个运动操作数的精确源码范围，供诊断、编辑器标记与教学回溯使用。 */
  operandRanges: {
    target: RapidSourceRange
    /** MoveC 圆弧途经点（CirPoint）的源码范围；movej/movel 不设置。 */
    cirPoint?: RapidSourceRange
    speed: RapidSourceRange
    zone: RapidSourceRange
    tool: RapidSourceRange
    wobj: RapidSourceRange | null
  }
  /** 分支体末条语句跳过剩余 ELSEIF/ELSE 的内部目标；普通语句不设置。 */
  nextPointer?: number
}

/** RAPID `SingArea \\Wrist/\\Off;` 运行时模式切换，不产生机器人运动 waypoint。 */
export interface RapidSingAreaInstruction {
  kind: 'singarea'
  mode: SingAreaMode
  sourceRange: RapidSourceRange
  sourceText: string
  nextPointer?: number
}

/** RAPID ConfJ/ConfL runtime mode switch; it does not generate motion. */
export interface RapidConfigurationInstruction {
  kind: 'confj' | 'confl'
  mode: ConfigurationMonitoringMode
  sourceRange: RapidSourceRange
  sourceText: string
  nextPointer?: number
}

/** 首期标量表达式的运算符；不扩展到字符串、数组或复合数据。 */
export type RapidScalarUnaryOperator = '+' | '-' | 'NOT'
export type RapidScalarBinaryOperator =
  '+' | '-' | '*' | '/' | '=' | '<>' | '<' | '<=' | '>' | '>=' | 'AND' | 'OR'

/** 赋值语句共用的最小表达式树；节点范围用于编辑器定位和运行时错误回溯。 */
export type RapidScalarExpression =
  | { kind: 'num-literal'; value: number; range: RapidSourceRange }
  | { kind: 'bool-literal'; value: boolean; range: RapidSourceRange }
  | { kind: 'variable'; name: string; range: RapidSourceRange }
  | { kind: 'group'; expression: RapidScalarExpression; range: RapidSourceRange }
  | {
      kind: 'unary'
      operator: RapidScalarUnaryOperator
      operand: RapidScalarExpression
      range: RapidSourceRange
    }
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
  | RapidSingAreaInstruction
  | RapidConfigurationInstruction
  | RapidAssignmentInstruction
  | RapidConditionalInstruction
  | RapidWhileInstruction
  | RapidForInstruction
  | RapidExitInstruction

export function isRapidMotionInstruction(
  instruction: RapidExecutableInstruction,
): instruction is RapidMotionInstruction {
  return instruction.kind === 'movej' || instruction.kind === 'movel' || instruction.kind === 'movec'
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
  /**
   * 全部成功解析的指令（含 `*` 未示教占位的运动指令），不受 canExecute 门控。
   * 供 UI 做"光标所在指令"解析与受控参数编辑；executor 永远只使用 program。
   * 注意：语义解析失败的语句（如引用未定义名称的运动）仍被剔除，与 program 内部口径一致。
   */
  instructions: readonly RapidExecutableInstruction[]
  diagnostics: readonly RapidDiagnostic[]
  canExecute: boolean
  /** 模块级命名数据的派生 Program Data 视图：六类运动数据与 num/bool 标量；来自同一次解析，无第二份状态。 */
  data: readonly RapidProgramData[]
  /** 新模块级声明的插入偏移（位于 main PROC 之前）。 */
  dataInsertOffset: number
  /** main 内所有合法插入位置，最后一项表示追加到程序末尾。 */
  motionInsertionPoints: readonly RapidMotionInsertionPoint[]
}

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

/**
 * 按名称（RAPID 大小写不敏感）查找 robtarget 类型的 Program Data 条目；供受控编辑等
 * 调用方按名字定位声明/引用范围，不需要自己遍历 `RapidParseResult.data` 或了解其内部形状。
 */
export function resolveEditTarget(
  parsed: RapidParseResult,
  name: string,
): RapidProgramDataTarget | null {
  const key = normalizeName(name)
  return (
    parsed.data.find(
      (entry): entry is RapidProgramDataTarget =>
        isRobtargetProgramData(entry) && normalizeName(entry.name) === key,
    ) ?? null
  )
}

/** 按下标取 `RapidParseResult.instructions` 中的一条；下标越界返回 null，交由调用方决定拒绝理由。 */
export function resolveEditInstruction(
  parsed: RapidParseResult,
  index: number,
): RapidExecutableInstruction | null {
  return index >= 0 && index < parsed.instructions.length ? parsed.instructions[index] : null
}

/**
 * 解析首期真实 RAPID 子集。tokenizer 在 rapid-lexer、数据值校验在 rapid-data-validation，
 * 名称解析/标量表达式与语句展平保留在本函数内；调用方只接收结构化运动、诊断和是否允许执行的结果。
 */
export function parseRapidProgram(source: string): RapidParseResult {
  const lineStarts = buildLineStarts(source)
  const lexed = lex(source, lineStarts)
  const tokens = lexed.tokens
  const diagnostics = [...lexed.diagnostics]
  const symbols = new Map<string, SymbolEntry>()
  // main 内的赋值与运动按源码顺序暂存，最终形成唯一可执行 program 数组。
  const pendingStatements: PendingStatement[] = []
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

  /** 数据值解析复用的上下文：把本函数的游标/诊断闭包暴露给 rapid-data-validation。 */
  const dataCtx: DataValidationContext = {
    current: () => current(),
    advance: () => advance(),
    expectSymbol: (symbol) => expectSymbol(symbol),
    addDiagnostic: (code, message, token) => addDiagnostic(code, message, token),
    addMissingDiagnostic: (code, message, token) => addMissingDiagnostic(code, message, token),
  }

  /** 当前 token 是否为已知运动关键字或过程/模块结构边界（用于运动参数恢复终结点）。 */
  function isMotionBoundary(token: Token): boolean {
    const text = normalizeName(token.text)
    return (
      text === 'movej' ||
      text === 'movel' ||
      text === 'moveabsj' ||
      text === 'movec' ||
      text === 'singarea' ||
      text === 'confj' ||
      text === 'confl' ||
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

  const scalarContext: ScalarExpressionContext = {
    lineStarts,
    current: () => current(),
    advance: () => advance(),
    expectSymbol: (symbol) => expectSymbol(symbol),
    addDiagnostic: (code, message, token) => addDiagnostic(code, message, token),
    addMissingDiagnostic: (code, message, token) => addMissingDiagnostic(code, message, token),
    resolveVariable: (name) => symbols.get(name),
  }

  // 控制流 parser 与语句路由共用这份可变区块状态；状态仍只存在一次，避免
  // Vue host 或不同 parser feature 各自复制游标/循环深度。
  const controlFlowContext: ControlFlowParserContext = {
    source,
    lineStarts,
    current,
    advance,
    expectKeyword,
    expectIdentifier,
    expectSymbol,
    addDiagnostic,
    skipToStatementEnd,
    scalarContext,
    statementSink: pendingStatements,
    loopDepth: 0,
    parseStatementList: (terminators) => parseStatementList(terminators),
  }

  function resolveAssignment(pending: PendingAssignment): RapidAssignmentInstruction | null {
    const symbol = symbols.get(normalizeName(pending.targetToken.text))
    let targetKind: RapidScalarKind | null = null
    if (!symbol) {
      addDiagnostic(
        'undefined-symbol',
        `未定义变量 ${pending.targetToken.text}`,
        pending.targetToken,
      )
    } else if ((symbol.kind !== 'num' && symbol.kind !== 'bool') || symbol.storage !== 'var') {
      addDiagnostic(
        'unsupported-option',
        `赋值目标 ${pending.targetToken.text} 只能是 VAR num/bool`,
        pending.targetToken,
      )
    } else {
      targetKind = symbol.kind
    }

    const expressionKind = scalarExpressionType(scalarContext, pending.expression)
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


  function parseDataDeclaration(): void {
    parseDataDeclarationStatement({
      source,
      lineStarts,
      dataContext: dataCtx,
      current,
      advance,
      expectKeyword,
      expectIdentifier,
      expectSymbol,
      skipToStatementEnd,
      addDiagnostic,
      addMissingDiagnostic,
      symbols,
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
  function parseMotion(): void {
    parseMotionStatement({
      source,
      lineStarts,
      dataContext: dataCtx,
      current,
      advance,
      expectIdentifier,
      expectSymbol,
      addDiagnostic,
      addMissingDiagnostic,
      atOperandBoundary,
      recoverMotionTail,
      queueReference,
      motionAnchors,
      statementSink: controlFlowContext.statementSink,
    })
  }

  function skipUnsupportedControl(): void {
    const token = advance()
    addDiagnostic('unsupported-syntax', `首期不支持 ${token.text} 控制流`, token)
    while (current().kind !== 'eof' && !isSymbol(current(), ';')) advance()
    if (isSymbol(current(), ';')) advance()
  }

  function parseStatementList(terminators: ReadonlySet<string>): void {
    parseStatementListStatement(
      {
        current,
        peek,
        advance,
        addDiagnostic,
        parseMotion,
        parseSingArea: () =>
          parseSingAreaStatement({
            source,
            lineStarts,
            advance,
            expectSymbol,
            expectIdentifier,
            addDiagnostic,
            statementSink: controlFlowContext.statementSink,
          }),
        parseConfiguration: (kind) =>
          parseConfigurationStatement(
            {
              source,
              lineStarts,
              advance,
              expectSymbol,
              expectIdentifier,
              addDiagnostic,
              statementSink: controlFlowContext.statementSink,
            },
            kind,
          ),
        parseAssignment: () =>
          parseAssignmentStatement({
            source,
            lineStarts,
            scalarContext,
            expectIdentifier,
            expectSymbol,
            statementSink: controlFlowContext.statementSink,
          }),
        parseConditional,
        parseWhile,
        parseFor,
        parseExitDo,
        skipUnsupportedControl,
        skipToStatementEnd,
      },
      terminators,
    )
  }

  function parseWhile(): void {
    parseWhileStatement(controlFlowContext)
  }

  function parseFor(): void {
    parseForStatement(controlFlowContext)
  }

  function parseExitDo(): void {
    parseExitDoStatement(controlFlowContext)
  }

  function parseConditional(): void {
    parseConditionalStatement(controlFlowContext)
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
        addDiagnostic(
          'unsupported-option',
          'vmax 依赖当前机器人型号的最大速度，暂无运行期解析',
          token,
        )
      } else if (
        isKeyword(token, 'CONST') ||
        isKeyword(token, 'PERS') ||
        isKeyword(token, 'TASK') ||
        isKeyword(token, 'VAR')
      ) {
        const type = peek()
        const typeName = normalizeName(type.text)
        if (
          type.kind === 'identifier' &&
          (typeName === 'num' || typeName === 'bool' || KNOWN_UNSUPPORTED_TYPES.has(typeName))
        ) {
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
      addDiagnostic(
        'unsupported-syntax',
        `首期只支持 PROC main()，暂不支持 ${name?.text ?? '匿名过程'}`,
        name ?? current(),
      )
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
    if (
      current().kind === 'identifier' &&
      !MODULE_NAME_KEYWORDS.has(normalizeName(current().text))
    ) {
      expectIdentifier('模块名称')
    } else {
      addMissingDiagnostic('syntax-error', '缺少模块名称')
    }
  }

  while (current().kind !== 'eof' && !isKeyword(current(), 'ENDMODULE')) {
    if (
      isKeyword(current(), 'CONST') ||
      isKeyword(current(), 'PERS') ||
      isKeyword(current(), 'TASK') ||
      isKeyword(current(), 'VAR')
    ) {
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
  /** 把一个 PendingTarget 解析为结构化 RobTarget；未定义基准或 `*` 占位返回 null（诊断已发）。 */
  function resolvePendingTarget(pt: PendingTarget): RobTarget | null {
    // `*` 未示教占位：诊断已在 parseTargetOperand 发出（missing-target ⇒ canExecute=false），
    // 指令仍进入 instructions 视图供受控编辑补全；返回零值占位，永不进入执行。
    if (pt.kind === 'star') {
      return {
        trans: [0, 0, 0],
        rot: [1, 0, 0, 0],
        robconf: [0, 0, 0, 0],
        extax: [...NO_EXTERNAL_AXIS],
      }
    }
    const baseValue = symbols.get(normalizeName(pt.baseName))?.value
    const baseTarget = baseValue?.kind === 'robtarget' ? baseValue.value : null
    if (!baseTarget) return null
    if (pt.kind === 'name') return baseTarget
    if (pt.kind === 'offs') return offsRobTarget(baseTarget, pt.dx!, pt.dy!, pt.dz!)
    return relToolRobTarget(baseTarget, pt.dx!, pt.dy!, pt.dz!, pt.rx, pt.ry, pt.rz)
  }

  function resolveMotion(pending: PendingMotion): RapidMotionInstruction | null {
    let valid = true
    const resolvedTarget = resolvePendingTarget(pending.target)
    if (!resolvedTarget) valid = false
    // MoveC 的圆弧途经点（CirPoint）：也必须成功解析，否则指令不可执行。
    const resolvedCirPoint = pending.cirPoint
      ? resolvePendingTarget(pending.cirPoint)
      : pending.kind === 'movec'
        ? null
        : undefined
    if (pending.kind === 'movec' && !resolvedCirPoint) valid = false

    // 其余操作数：用户符号优先，其次系统预定义；未定义诊断已在 resolveReferences 发出。
    const speed = resolveSpeed(pending.speedName)
    const zone = resolveZone(pending.zoneName)
    const tool = resolveTool(pending.toolName)
    const wobj = resolveWobj(pending.wobjName)

    // MVP 能力门：vmax 依赖机器人型号暂不执行；非 fine zone 保留为合法语法，
    // 由程序控制层在启动前统一拒绝，避免部分运动后才失败；
    // fly-by 语义与“未模拟路径融合”提示由运行时/观察区呈现。
    if (speed && !Number.isFinite(speed.v_tcp)) {
      addDiagnostic(
        'unsupported-option',
        `vmax 依赖当前机器人型号的最大速度，暂无运行期解析`,
        pending.speedToken,
      )
      valid = false
    }

    if (!valid || !resolvedTarget || !speed || !zone || !tool || !wobj) return null

    // MoveC 与 movej/movel 分别构造以匹配结构化联合的精确 kind 判别。
    if (pending.kind === 'movec') {
      if (!resolvedCirPoint) return null
      return {
        kind: 'movec' as const,
        cirPoint: cloneTarget(resolvedCirPoint),
        target: cloneTarget(resolvedTarget),
        speed: cloneSpeed(speed),
        zone: { ...zone },
        tool: cloneTool(tool),
        wobj: cloneWobj(wobj),
        sourceRange: pending.range,
        sourceText: pending.sourceText,
        operands: {
          target: pending.target.sourceText,
          cirPoint: pending.cirPoint?.sourceText ?? '',
          speed: pending.speedName,
          zone: pending.zoneName,
          tool: pending.toolName,
          wobj: pending.wobjName,
        },
        operandRanges: {
          target: pending.target.range,
          cirPoint: pending.cirPoint?.range ?? pending.target.range,
          speed: rangeFromToken(pending.speedToken, lineStarts),
          zone: rangeFromToken(pending.zoneToken, lineStarts),
          tool: rangeFromToken(pending.toolToken, lineStarts),
          wobj: pending.wobjToken ? rangeFromToken(pending.wobjToken, lineStarts) : null,
        },
      }
    }

    // 至此 pending.kind 只可能是 movej 或 movel。
    return {
      kind: pending.kind as 'movej' | 'movel',
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
    if (statement.kind === 'singarea') {
      return {
        kind: 'singarea',
        mode: statement.singArea.mode,
        sourceRange: statement.singArea.range,
        sourceText: statement.singArea.sourceText,
      }
    }
    if (statement.kind === 'confj' || statement.kind === 'confl') {
      return { kind: statement.kind, mode: statement.configuration.mode, sourceRange: statement.configuration.range, sourceText: statement.configuration.sourceText }
    }
    return null
  }

  appendPendingStatements(pendingStatements, program, {
    lineStarts,
    scalarContext,
    diagnostics,
    resolveLeaf,
  })

  // 受控插入仍以最终可执行计划的 program 下标为准；损坏运动用其源码位置映射到前方已解析指令数。
  motionInsertionPoints.length = 0
  for (const anchor of motionAnchors) {
    motionInsertionPoints.push({
      index: program.filter((instruction) => instruction.sourceRange.start.offset < anchor.offset)
        .length,
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

  // 稳定诊断契约：排序与去重（见 rapid-diagnostics.sortAndDedupeDiagnostics）。
  sortAndDedupeDiagnostics(diagnostics)

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
          value: {
            ...entry.value.value,
            cog: [...entry.value.value.cog],
            aom: [...entry.value.value.aom],
          },
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

  const canExecute =
    diagnostics.length === 0 && moduleCount === 1 && mainCount === 1 && sawEndModule
  return {
    program: canExecute ? program : [],
    instructions: program,
    diagnostics,
    canExecute,
    data,
    dataInsertOffset,
    motionInsertionPoints,
  }
}
