import type {
  RobTarget,
  SpeedData,
  StructuredMotionInstruction,
} from './rapid-types.ts'
import {
  defaultTool0,
  defaultWobj0,
  defaultZoneFine,
} from './rapid-types.ts'

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
  /** 模块级命名 robtarget 的派生 Program Data 视图：来自同一次解析，无第二份点位存储。 */
  data: readonly RapidProgramDataTarget[]
  /** 新模块级声明的插入偏移（位于 main PROC 之前）。 */
  dataInsertOffset: number
  /** main 内所有合法插入位置，最后一项表示追加到程序末尾。 */
  motionInsertionPoints: readonly RapidMotionInsertionPoint[]
}

/** Program Data 中的一个模块级 robtarget：名称、存储类别、值与每次引用的精确源码范围。 */
export interface RapidProgramDataTarget {
  /** 源码原始拼写（大小写不敏感匹配，但保留原样）。 */
  name: string
  storage: 'const' | 'pers'
  target: RobTarget
  /** 完整声明语句范围（自存储关键字到分号，含行内尾随内容）。 */
  declarationRange: RapidSourceRange
  /** 声明名在源码中的范围，供受控编辑与 PP 映射使用。 */
  nameRange: RapidSourceRange
  /** 声明值字面量 `[[...]]` 的范围，供 Modify Position 替换。 */
  valueRange: RapidSourceRange
  /** 每条 MoveJ/MoveL 操作数中引用该名称的源码范围。 */
  referenceRanges: readonly RapidSourceRange[]
}

type TokenKind = 'identifier' | 'number' | 'symbol' | 'eof'

interface Token {
  kind: TokenKind
  text: string
  start: number
  end: number
}

interface PendingMotion {
  kind: 'movej' | 'movel'
  targetName: string
  targetToken: Token
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

interface SymbolEntry {
  target: RobTarget
  /** 声明的名称范围。 */
  range: RapidSourceRange
  /** 完整声明语句范围（自存储关键字到分号）。 */
  declarationRange: RapidSourceRange
  /** 声明值字面量范围。 */
  valueRange: RapidSourceRange
  storage: 'const' | 'pers'
  /** 各条运动指令操作数中引用该名称的源码范围。 */
  references: RapidSourceRange[]
}

const NUMBER_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/

const SPEEDS: Record<string, SpeedData> = {
  v50: { v_tcp: 50, v_ori: 500, v_leax: 5000, v_reax: 1000 },
  v100: { v_tcp: 100, v_ori: 500, v_leax: 5000, v_reax: 1000 },
  v200: { v_tcp: 200, v_ori: 500, v_leax: 5000, v_reax: 1000 },
}

/**
 * 真实 RAPID 数据类型中本项目首期尚未支持的类型名。用于区分“漏写数据类型”
 * （后面跟的是 robtarget 名称）与“使用了已知但不支持的类型”（num/tooldata 等）。
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
  'tooldata',
  'wobjdata',
  'speeddata',
  'zonedata',
  'loaddata',
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
  const pendingTargetReferences: Token[] = []
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

  function parseRobTarget(): RobTarget | null {
    const open = expectSymbol('[')
    if (!open) return null
    const trans = parseTuple(3, 'robtarget.trans')
    expectSymbol(',')
    const rot = parseTuple(4, 'robtarget.rot')
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

  function parseRobTargetDeclaration(): void {
    const storage = advance()
    const declarationStart = storage.start
    let storageKind: 'const' | 'pers' = 'const'
    if (isKeyword(storage, 'TASK')) {
      if (!expectKeyword('PERS')) {
        skipToStatementEnd()
        return
      }
      storageKind = 'pers'
    } else if (isKeyword(storage, 'PERS')) {
      storageKind = 'pers'
    }

    const type = expectIdentifier('数据类型')
    if (!type) {
      skipToStatementEnd()
      return
    }
    const typeName = normalizeName(type.text)
    if (typeName !== 'robtarget') {
      // 已知但不支持的类型名（num/tooldata 等）才报 unsupported；否则像是漏写了数据类型、把名称顶到了类型位。
      if (KNOWN_UNSUPPORTED_TYPES.has(typeName)) {
        addDiagnostic('unsupported-option', `首期只支持 robtarget 声明，暂不支持 ${type.text}`, type)
        skipToStatementEnd()
        return
      }
      addMissingDiagnostic('syntax-error', `缺少数据类型（期望 robtarget）`, type)
      skipToStatementEnd()
      return
    }

    const name = expectIdentifier('robtarget 名称')
    const assign = expectSymbol(':=')
    if (!name || !assign) {
      // 缺少名称或 `:=`：值无法与名称可靠对应，恢复本声明但不生成半合法 Program Data 条目。
      skipToStatementEnd()
      return
    }
    const valueStartOffset = current().start
    const target = parseRobTarget()
    const semicolon = expectSymbol(';')
    if (!target) return
    const declarationEnd = semicolon ? semicolon.end : current().start
    const nameRange = rangeFromToken(name, lineStarts)

    const key = normalizeName(name.text)
    if (symbols.has(key)) {
      addDiagnostic('duplicate-symbol', `重复定义 robtarget ${name.text}`, name)
      return
    }
    symbols.set(key, {
      target,
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

  /** 暂存解析到的目标名；目标操作数即使所在运动断裂也必须保留引用信息。 */
  function queueTargetReference(nameToken: Token): void {
    pendingTargetReferences.push(nameToken)
  }

  /** 在完整模块解析后结算引用，支持声明位于 main 之后的合法前向引用。 */
  function resolveTargetReferences(): void {
    for (const nameToken of pendingTargetReferences) {
      const symbol = symbols.get(normalizeName(nameToken.text))
      if (symbol) {
        symbol.references.push(rangeFromToken(nameToken, lineStarts))
      } else {
        addDiagnostic('undefined-symbol', `未定义 robtarget ${nameToken.text}`, nameToken)
      }
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

  function parseMotion(): void {
    const start = advance()
    const kind = normalizeName(start.text) as PendingMotion['kind']
    motionInsertionPoints.push({ index: pendingMotions.length, offset: start.start, line: positionAt(start.start, lineStarts).line })
    let abandoned = false
    const abort = (): void => {
      abandoned = true
    }

    const targetSlot = expectOperandSlot('目标点名称', abort)
    const target = targetSlot.token
    let separatorConsumed = targetSlot.separatorConsumed
    if (target) queueTargetReference(target)
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
    }

    // 可选参数之后仍有非分号内容：多余的参数根因。
    if (rejectTrailingParams(false)) return

    const semicolon = expectSymbol(';')
    const end = semicolon ?? current()
    if (!target || !speed || !zone || !tool) return
    pendingMotions.push({
      kind,
      targetName: target.text,
      targetToken: target,
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
    if (isKeyword(current(), 'CONST') || isKeyword(current(), 'PERS') || isKeyword(current(), 'TASK')) {
      parseRobTargetDeclaration()
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

  resolveTargetReferences()

  const program: RapidExecutableInstruction[] = []
  for (const pending of pendingMotions) {
    let valid = true
    const symbol = symbols.get(normalizeName(pending.targetName))
    // 目标引用已在完整模块解析后结算；此处仅需判定是否可生成可执行指令。
    if (!symbol) valid = false

    const speed = SPEEDS[normalizeName(pending.speedName)]
    if (!speed) {
      addDiagnostic(
        'undefined-symbol',
        `未定义或不支持速度 ${pending.speedName}`,
        pending.speedToken,
      )
      valid = false
    }
    if (normalizeName(pending.zoneName) !== 'fine') {
      addDiagnostic(
        'unsupported-option',
        `首期只支持 fine，暂不支持 ${pending.zoneName}`,
        pending.zoneToken,
      )
      valid = false
    }
    if (normalizeName(pending.toolName) !== 'tool0') {
      addDiagnostic(
        'unsupported-option',
        `首期只支持 tool0，暂不支持 ${pending.toolName}`,
        pending.toolToken,
      )
      valid = false
    }
    if (normalizeName(pending.wobjName) !== 'wobj0') {
      addDiagnostic(
        'unsupported-option',
        `首期只支持 wobj0，暂不支持 ${pending.wobjName}`,
        pending.wobjToken ?? pending.toolToken,
      )
      valid = false
    }

    if (!valid || !symbol || !speed) continue

    const common = { zone: defaultZoneFine(), tool: defaultTool0(), wobj: defaultWobj0() }
    program.push({
      kind: pending.kind,
      target: cloneTarget(symbol.target),
      speed: cloneSpeed(speed),
      ...common,
      sourceRange: pending.range,
      sourceText: pending.sourceText,
      operands: {
        target: pending.targetName,
        speed: pending.speedName,
        zone: pending.zoneName,
        tool: pending.toolName,
        wobj: pending.wobjName,
      },
      operandRanges: {
        target: rangeFromToken(pending.targetToken, lineStarts),
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

  // Program Data 视图：由同一份解析派生，声明顺序稳定；即使存在 error 也暴露已识别数据供只读浏览。
  const data: RapidProgramDataTarget[] = []
  for (const entry of symbols.values()) {
    data.push({
      name: source.slice(entry.range.start.offset, entry.range.end.offset),
      storage: entry.storage,
      target: cloneTarget(entry.target),
      declarationRange: { ...entry.declarationRange },
      nameRange: entry.range,
      valueRange: { ...entry.valueRange },
      referenceRanges: entry.references.map((range) => ({ ...range })),
    })
  }

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
