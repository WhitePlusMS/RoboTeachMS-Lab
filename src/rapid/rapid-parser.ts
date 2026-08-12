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
  let cursor = 0
  let moduleCount = 0
  let mainCount = 0
  let sawEndModule = false
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

  function expectKeyword(keyword: string): Token | null {
    if (isKeyword(current(), keyword)) return advance()
    addDiagnostic('syntax-error', `期望关键字 ${keyword}`)
    return null
  }

  function expectIdentifier(description: string): Token | null {
    if (current().kind === 'identifier') return advance()
    addDiagnostic('syntax-error', `期望${description}`)
    return null
  }

  function expectSymbol(symbol: string): Token | null {
    if (isSymbol(current(), symbol)) return advance()
    addDiagnostic('syntax-error', `期望符号 ${symbol}`)
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
    if (normalizeName(type.text) !== 'robtarget') {
      addDiagnostic('unsupported-option', `首期只支持 robtarget 声明，暂不支持 ${type.text}`, type)
      skipToStatementEnd()
      return
    }

    const name = expectIdentifier('robtarget 名称')
    expectSymbol(':=')
    const valueStartOffset = current().start
    const target = parseRobTarget()
    const semicolon = expectSymbol(';')
    if (!name || !target) return
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

  function parseMotion(): void {
    const start = advance()
    const kind = normalizeName(start.text) as PendingMotion['kind']
    motionInsertionPoints.push({ index: pendingMotions.length, offset: start.start, line: positionAt(start.start, lineStarts).line })
    const target = expectIdentifier('目标点名称')
    expectSymbol(',')
    const speed = expectIdentifier('速度名称')
    expectSymbol(',')
    const zone = expectIdentifier('zone 名称')
    expectSymbol(',')
    const tool = expectIdentifier('工具名称')
    let wobjName = 'wobj0'
    let wobjToken: Token | null = null

    if (isSymbol(current(), '\\')) {
      advance()
      const option = expectIdentifier('可选参数名称')
      expectSymbol(':=')
      const wobj = expectIdentifier('工件坐标名称')
      if (option && normalizeName(option.text) !== 'wobj') {
        addDiagnostic('unsupported-option', `不支持可选参数 ${option.text}`, option)
      }
      if (wobj) {
        wobjName = wobj.text
        wobjToken = wobj
      }
    }

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
    while (current().kind !== 'eof' && !isKeyword(current(), 'ENDPROC')) {
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
    moduleCount += 1
    expectIdentifier('模块名称')
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
  } else {
    addDiagnostic('syntax-error', '缺少 ENDMODULE')
  }
  if (sawEndModule && current().kind !== 'eof') {
    addDiagnostic('unsupported-syntax', 'ENDMODULE 后不允许出现尾随内容')
    while (current().kind !== 'eof') advance()
  }
  if (!sawEndModule && moduleCount === 0) addDiagnostic('missing-module', '缺少有效 MODULE')

  const program: RapidExecutableInstruction[] = []
  for (const pending of pendingMotions) {
    let valid = true
    const symbol = symbols.get(normalizeName(pending.targetName))
    if (symbol) {
      // 该名称确实作为运动操作数使用；引用计数与源码范围由此记录，与指令其它字段是否合法无关。
      symbol.references.push(rangeFromToken(pending.targetToken, lineStarts))
    } else {
      addDiagnostic('undefined-symbol', `未定义 robtarget ${pending.targetName}`, pending.targetToken)
      valid = false
    }

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
