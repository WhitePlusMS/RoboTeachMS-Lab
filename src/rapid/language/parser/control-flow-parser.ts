import { isKeyword } from '../rapid-symbols.ts'
import type { RapidDiagnosticCode } from '../rapid-diagnostics.ts'
import type { Token } from '../rapid-lexer.ts'
import { rangeFromOffsets } from '../rapid-lexer.ts'
import { parseScalarExpression, type ScalarExpressionContext } from './scalar-expression.ts'
import type {
  PendingConditionalBranch,
  PendingStatement,
} from './pending-types.ts'
import type { RapidScalarExpression } from './rapid-parser.ts'

/** 控制流语句 parser 的上下文；区块语句仍写入主 parser 提供的 pending 容器。 */
export interface ControlFlowParserContext {
  readonly source: string
  readonly lineStarts: readonly number[]
  readonly current: () => Token
  readonly advance: () => Token
  readonly expectKeyword: (keyword: string) => Token | null
  readonly expectIdentifier: (description: string) => Token | null
  readonly expectSymbol: (symbol: string) => Token | null
  readonly addDiagnostic: (code: RapidDiagnosticCode, message: string, token?: Token) => void
  readonly skipToStatementEnd: () => void
  readonly scalarContext: ScalarExpressionContext
  statementSink: PendingStatement[]
  loopDepth: number
  readonly parseStatementList: (terminators: ReadonlySet<string>) => void
}

/** 解析 WHILE 条件循环；循环体内支持嵌套 IF/循环/赋值/运动。 */
export function parseWhile(ctx: ControlFlowParserContext): void {
  const start = ctx.advance()
  const condition = parseScalarExpression(ctx.scalarContext)
  const doToken = ctx.expectKeyword('DO')
  const statements: PendingStatement[] = []
  ctx.loopDepth += 1
  const previousSink = ctx.statementSink
  ctx.statementSink = statements
  ctx.parseStatementList(new Set(['ENDWHILE']))
  ctx.statementSink = previousSink
  ctx.loopDepth -= 1
  const end = ctx.expectKeyword('ENDWHILE')
  if (!end) return
  const headerEnd = doToken?.end ?? condition?.range.end.offset ?? start.end
  ctx.statementSink.push({
    kind: 'while',
    whileLoop: {
      condition,
      conditionToken: start,
      range: rangeFromOffsets(start.start, headerEnd, ctx.lineStarts),
      sourceText: ctx.source.slice(start.start, headerEnd),
      statements,
    },
  })
}

/** 解析 FOR 计数循环：FOR i FROM a TO b STEP s DO ... ENDFOR。 */
export function parseFor(ctx: ControlFlowParserContext): void {
  const start = ctx.advance()
  const loopVarToken = ctx.expectIdentifier('FOR 循环变量')
  if (!loopVarToken) return
  ctx.expectKeyword('FROM')
  const fromExpr = parseScalarExpression(ctx.scalarContext)
  ctx.expectKeyword('TO')
  const toExpr = parseScalarExpression(ctx.scalarContext)
  let stepExpr: RapidScalarExpression | null = null
  if (isKeyword(ctx.current(), 'STEP')) {
    ctx.advance()
    stepExpr = parseScalarExpression(ctx.scalarContext)
  }
  const doToken = ctx.expectKeyword('DO')
  const statements: PendingStatement[] = []
  ctx.loopDepth += 1
  const previousSink = ctx.statementSink
  ctx.statementSink = statements
  ctx.parseStatementList(new Set(['ENDFOR']))
  ctx.statementSink = previousSink
  ctx.loopDepth -= 1
  const end = ctx.expectKeyword('ENDFOR')
  if (!end) return
  const headerEnd = doToken?.end ?? toExpr?.range.end.offset ?? start.end
  ctx.statementSink.push({
    kind: 'for',
    forLoop: {
      loopVarToken,
      fromExpr,
      toExpr,
      stepExpr,
      range: rangeFromOffsets(start.start, headerEnd, ctx.lineStarts),
      sourceText: ctx.source.slice(start.start, headerEnd),
      statements,
    },
  })
}

/** EXITDO 只能出现在循环体内；循环外给出诊断并阻止该语句。 */
export function parseExitDo(ctx: ControlFlowParserContext): void {
  const start = ctx.advance()
  if (ctx.loopDepth === 0) {
    ctx.addDiagnostic('syntax-error', 'EXITDO 只能出现在循环体内', start)
    ctx.skipToStatementEnd()
    return
  }
  const semicolon = ctx.expectSymbol(';')
  if (!semicolon) return
  ctx.statementSink.push({
    kind: 'exitdo',
    exit: {
      token: start,
      range: rangeFromOffsets(start.start, semicolon.end, ctx.lineStarts),
      sourceText: ctx.source.slice(start.start, semicolon.end),
    },
  })
}

function parseConditionalBranch(
  ctx: ControlFlowParserContext,
  conditionKind: PendingConditionalBranch['conditionKind'],
  start: Token,
): PendingConditionalBranch {
  const condition = parseScalarExpression(ctx.scalarContext)
  const thenToken = ctx.expectKeyword('THEN')
  const statements: PendingStatement[] = []
  const previousSink = ctx.statementSink
  ctx.statementSink = statements
  ctx.parseStatementList(new Set(['ELSEIF', 'ELSE', 'ENDIF']))
  ctx.statementSink = previousSink
  const headerEnd = thenToken?.end ?? condition?.range.end.offset ?? start.end
  return {
    conditionKind,
    condition,
    range: rangeFromOffsets(start.start, headerEnd, ctx.lineStarts),
    sourceText: ctx.source.slice(start.start, headerEnd),
    statements,
  }
}

function skipConditionalTail(ctx: ControlFlowParserContext): void {
  while (
    ctx.current().kind !== 'eof' &&
    !isKeyword(ctx.current(), 'ENDIF') &&
    !isKeyword(ctx.current(), 'ENDPROC') &&
    !isKeyword(ctx.current(), 'ENDMODULE')
  ) {
    ctx.advance()
  }
}

/** 解析 IF/ELSEIF/ELSE/ENDIF，并保留分支语句的源码顺序。 */
export function parseConditional(ctx: ControlFlowParserContext): void {
  const ifToken = ctx.advance()
  const branches: PendingConditionalBranch[] = [parseConditionalBranch(ctx, 'if', ifToken)]
  while (isKeyword(ctx.current(), 'ELSEIF')) {
    const elseifToken = ctx.advance()
    branches.push(parseConditionalBranch(ctx, 'elseif', elseifToken))
  }

  let elseStatements: PendingStatement[] | null = null
  if (isKeyword(ctx.current(), 'ELSE')) {
    ctx.advance()
    elseStatements = []
    const previousSink = ctx.statementSink
    ctx.statementSink = elseStatements
    ctx.parseStatementList(new Set(['ELSEIF', 'ELSE', 'ENDIF']))
    ctx.statementSink = previousSink
    if (isKeyword(ctx.current(), 'ELSE') || isKeyword(ctx.current(), 'ELSEIF')) {
      ctx.addDiagnostic('syntax-error', 'ELSEIF/ELSE 不能出现在 ELSE 分支之后', ctx.current())
      skipConditionalTail(ctx)
    }
  }

  const end = ctx.expectKeyword('ENDIF')
  if (!end) return
  ctx.statementSink.push({ kind: 'conditional', conditional: { branches, elseStatements } })
}
