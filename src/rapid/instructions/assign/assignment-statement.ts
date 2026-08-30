import type { Token } from '../../language/rapid-lexer.ts'
import { rangeFromOffsets } from '../../language/rapid-lexer.ts'
import type { PendingStatement } from '../../language/parser/pending-types.ts'
import {
  parseScalarExpression,
  type ScalarExpressionContext,
} from '../../language/parser/scalar-expression.ts'

/** 赋值语句 parser 的最小上下文；表达式语义仍复用现有 scalar-expression 模块。 */
export interface AssignmentStatementContext {
  readonly source: string
  readonly lineStarts: readonly number[]
  readonly scalarContext: ScalarExpressionContext
  expectIdentifier(description: string): Token | null
  expectSymbol(symbol: string): Token | null
  statementSink: PendingStatement[]
}

export function parseAssignment(ctx: AssignmentStatementContext): void {
  const target = ctx.expectIdentifier('赋值目标变量')
  const assign = ctx.expectSymbol(':=')
  const expression = parseScalarExpression(ctx.scalarContext)
  const semicolon = ctx.expectSymbol(';')
  if (!target || !assign || !expression || !semicolon) return
  ctx.statementSink.push({
    kind: 'assign',
    assignment: {
      targetToken: target,
      expression,
      range: rangeFromOffsets(target.start, semicolon.end, ctx.lineStarts),
      sourceText: ctx.source.slice(target.start, semicolon.end),
    },
  })
}
