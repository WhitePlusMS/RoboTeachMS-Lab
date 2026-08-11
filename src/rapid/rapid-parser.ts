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

/** 解析后交给 ProgramExecutor 的指令；源码范围用于回溯运行时规划错误。 */
export type RapidExecutableInstruction = StructuredMotionInstruction & {
  sourceRange: RapidSourceRange
  sourceText: string
}

export interface RapidParseResult {
  /** 仅在没有 error 时可执行；存在 error 时返回空数组，防止误启动部分程序。 */
  program: readonly RapidExecutableInstruction[]
  diagnostics: readonly RapidDiagnostic[]
  canExecute: boolean
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
  speedName: string
  zoneName: string
  toolName: string
  wobjName: string
  range: RapidSourceRange
  sourceText: string
}

interface SymbolEntry {
  target: RobTarget
  range: RapidSourceRange
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
    if (isKeyword(storage, 'TASK')) {
      if (!expectKeyword('PERS')) {
        skipToStatementEnd()
        return
      }
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
    const target = parseRobTarget()
    expectSymbol(';')
    if (!name || !target) return

    const key = normalizeName(name.text)
    const nameRange = rangeFromToken(name, lineStarts)
    if (symbols.has(key)) {
      addDiagnostic('duplicate-symbol', `重复定义 robtarget ${name.text}`, name)
      return
    }
    symbols.set(key, { target, range: nameRange })
  }

  function parseMotion(): void {
    const start = advance()
    const kind = normalizeName(start.text) as PendingMotion['kind']
    const target = expectIdentifier('目标点名称')
    expectSymbol(',')
    const speed = expectIdentifier('速度名称')
    expectSymbol(',')
    const zone = expectIdentifier('zone 名称')
    expectSymbol(',')
    const tool = expectIdentifier('工具名称')
    let wobjName = 'wobj0'

    if (isSymbol(current(), '\\')) {
      advance()
      const option = expectIdentifier('可选参数名称')
      expectSymbol(':=')
      const wobj = expectIdentifier('工件坐标名称')
      if (option && normalizeName(option.text) !== 'wobj') {
        addDiagnostic('unsupported-option', `不支持可选参数 ${option.text}`, option)
      }
      if (wobj) wobjName = wobj.text
    }

    const semicolon = expectSymbol(';')
    const end = semicolon ?? current()
    if (!target || !speed || !zone || !tool) return
    pendingMotions.push({
      kind,
      targetName: target.text,
      speedName: speed.text,
      zoneName: zone.text,
      toolName: tool.text,
      wobjName,
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
    expectKeyword('ENDPROC')
  }

  function skipProcedureBody(): void {
    while (current().kind !== 'eof' && !isKeyword(current(), 'ENDPROC')) advance()
    expectKeyword('ENDPROC')
  }

  function parseProcedure(): void {
    advance()
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
    const tokenForName = (name: string): Token => {
      const start = source.indexOf(name, pending.range.start.offset)
      return {
        kind: 'identifier',
        text: name,
        start: start >= 0 ? start : pending.range.start.offset,
        end: start >= 0 ? start + name.length : pending.range.start.offset,
      }
    }
    let valid = true
    const symbol = symbols.get(normalizeName(pending.targetName))
    if (!symbol) {
      addDiagnostic('undefined-symbol', `未定义 robtarget ${pending.targetName}`, tokenForName(pending.targetName))
      valid = false
    }

    const speed = SPEEDS[normalizeName(pending.speedName)]
    if (!speed) {
      addDiagnostic(
        'undefined-symbol',
        `未定义或不支持速度 ${pending.speedName}`,
        tokenForName(pending.speedName),
      )
      valid = false
    }
    if (normalizeName(pending.zoneName) !== 'fine') {
      addDiagnostic(
        'unsupported-option',
        `首期只支持 fine，暂不支持 ${pending.zoneName}`,
        tokenForName(pending.zoneName),
      )
      valid = false
    }
    if (normalizeName(pending.toolName) !== 'tool0') {
      addDiagnostic(
        'unsupported-option',
        `首期只支持 tool0，暂不支持 ${pending.toolName}`,
        tokenForName(pending.toolName),
      )
      valid = false
    }
    if (normalizeName(pending.wobjName) !== 'wobj0') {
      addDiagnostic(
        'unsupported-option',
        `首期只支持 wobj0，暂不支持 ${pending.wobjName}`,
        tokenForName(pending.wobjName),
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
    })
  }

  if (mainCount === 0) {
    addDiagnostic('missing-entrypoint', 'RAPID 源程序必须包含无参数 PROC main()')
  }

  const canExecute = diagnostics.length === 0 && moduleCount === 1 && mainCount === 1 && sawEndModule
  return { program: canExecute ? program : [], diagnostics, canExecute }
}
