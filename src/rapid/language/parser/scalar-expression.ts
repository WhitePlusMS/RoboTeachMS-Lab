import type { RapidScalarKind } from '../../data/index.ts'
import { isKeyword, isSymbol, normalizeName, type SymbolEntry } from '../rapid-symbols.ts'
import type { RapidDiagnosticCode } from '../rapid-diagnostics.ts'
import {
  rangeFromOffsets,
  rangeFromToken,
  type Token,
} from '../rapid-lexer.ts'
import type {
  RapidScalarBinaryOperator,
  RapidScalarExpression,
} from './rapid-parser.ts'

/**
 * 标量表达式实现需要的最小 parser 接口。
 *
 * 主 parser 仍然拥有 token 游标、符号表和诊断列表；表达式模块只通过这个
 * 内部 seam 读取/消费 token 与报告错误，因此不会创建第二套解析状态。
 */
export interface ScalarExpressionContext {
  readonly lineStarts: readonly number[]
  current(): Token
  advance(): Token
  expectSymbol(symbol: string): Token | null
  addDiagnostic(code: RapidDiagnosticCode, message: string, token?: Token): void
  addMissingDiagnostic(code: RapidDiagnosticCode, message: string, token?: Token): void
  resolveVariable(name: string): SymbolEntry | undefined
}

function parsePrimary(ctx: ScalarExpressionContext): RapidScalarExpression | null {
  const token = ctx.current()
  if (token.kind === 'number') {
    ctx.advance()
    const value = Number(token.text)
    if (!Number.isFinite(value)) {
      ctx.addDiagnostic('invalid-data', '表达式包含非有限数字', token)
      return null
    }
    return { kind: 'num-literal', value, range: rangeFromToken(token, ctx.lineStarts) }
  }
  if (isKeyword(token, 'TRUE') || isKeyword(token, 'FALSE')) {
    ctx.advance()
    return {
      kind: 'bool-literal',
      value: isKeyword(token, 'TRUE'),
      range: rangeFromToken(token, ctx.lineStarts),
    }
  }
  if (token.kind === 'identifier') {
    ctx.advance()
    return { kind: 'variable', name: token.text, range: rangeFromToken(token, ctx.lineStarts) }
  }
  if (isSymbol(token, '(')) {
    const open = ctx.advance()
    const expression = parseOr(ctx)
    const close = ctx.expectSymbol(')')
    if (!expression) return null
    return {
      kind: 'group',
      expression,
      range: rangeFromOffsets(
        open.start,
        close?.end ?? expression.range.end.offset,
        ctx.lineStarts,
      ),
    }
  }
  ctx.addMissingDiagnostic('syntax-error', '期望标量表达式', token)
  return null
}

function parseUnary(ctx: ScalarExpressionContext): RapidScalarExpression | null {
  const token = ctx.current()
  if (isSymbol(token, '+') || isSymbol(token, '-')) {
    const operator = ctx.advance().text as '+' | '-'
    const operand = parseUnary(ctx)
    if (!operand) return null
    return {
      kind: 'unary',
      operator,
      operand,
      range: rangeFromOffsets(token.start, operand.range.end.offset, ctx.lineStarts),
    }
  }
  if (isKeyword(token, 'NOT')) {
    ctx.advance()
    const operand = parseUnary(ctx)
    if (!operand) return null
    return {
      kind: 'unary',
      operator: 'NOT',
      operand,
      range: rangeFromOffsets(token.start, operand.range.end.offset, ctx.lineStarts),
    }
  }
  return parsePrimary(ctx)
}

function parseBinary(
  ctx: ScalarExpressionContext,
  parseOperand: () => RapidScalarExpression | null,
  operators: readonly string[],
): RapidScalarExpression | null {
  let left = parseOperand()
  while (
    left &&
    operators.some((operator) =>
      operator.length > 1
        ? normalizeName(ctx.current().text) === normalizeName(operator)
        : ctx.current().text === operator,
    )
  ) {
    const operatorToken = ctx.advance()
    const operator =
      operatorToken.text.length > 1
        ? normalizeName(operatorToken.text).toUpperCase()
        : operatorToken.text
    const right = parseOperand()
    if (!right) return null
    left = {
      kind: 'binary',
      operator: operator as RapidScalarBinaryOperator,
      left,
      right,
      range: rangeFromOffsets(left.range.start.offset, right.range.end.offset, ctx.lineStarts),
    }
  }
  return left
}

function parseMultiplicative(ctx: ScalarExpressionContext): RapidScalarExpression | null {
  return parseBinary(ctx, () => parseUnary(ctx), ['*', '/'])
}

function parseAdditive(ctx: ScalarExpressionContext): RapidScalarExpression | null {
  return parseBinary(ctx, () => parseMultiplicative(ctx), ['+', '-'])
}

function parseComparison(ctx: ScalarExpressionContext): RapidScalarExpression | null {
  return parseBinary(ctx, () => parseAdditive(ctx), ['=', '<>', '<', '<=', '>', '>='])
}

function parseAnd(ctx: ScalarExpressionContext): RapidScalarExpression | null {
  return parseBinary(ctx, () => parseComparison(ctx), ['AND'])
}

function parseOr(ctx: ScalarExpressionContext): RapidScalarExpression | null {
  return parseBinary(ctx, () => parseAnd(ctx), ['OR'])
}

/** 解析 ABB 标量子集：NOT/正负号 > 乘除 > 加减 > 比较 > AND > OR。 */
export function parseScalarExpression(ctx: ScalarExpressionContext): RapidScalarExpression | null {
  return parseOr(ctx)
}

/** 对已生成表达式树做静态类型检查；符号值仍由主 parser 的同一张符号表提供。 */
export function scalarExpressionType(
  ctx: ScalarExpressionContext,
  expression: RapidScalarExpression,
): RapidScalarKind | null {
  switch (expression.kind) {
    case 'num-literal':
      return 'num'
    case 'bool-literal':
      return 'bool'
    case 'group':
      return scalarExpressionType(ctx, expression.expression)
    case 'variable': {
      const symbol = ctx.resolveVariable(normalizeName(expression.name))
      if (!symbol) {
        ctx.addDiagnostic('undefined-symbol', `未定义变量 ${expression.name}`, {
          kind: 'identifier',
          text: expression.name,
          start: expression.range.start.offset,
          end: expression.range.end.offset,
        })
        return null
      }
      if (symbol.kind !== 'num' && symbol.kind !== 'bool') {
        ctx.addDiagnostic(
          'unsupported-option',
          `表达式只支持 num/bool 变量，${expression.name} 是 ${symbol.kind}`,
        )
        return null
      }
      return symbol.kind
    }
    case 'unary': {
      const operandType = scalarExpressionType(ctx, expression.operand)
      const expected: RapidScalarKind = expression.operator === 'NOT' ? 'bool' : 'num'
      if (operandType && operandType !== expected) {
        ctx.addDiagnostic(
          'invalid-data',
          `${expression.operator} 运算要求 ${expected}，实际为 ${operandType}`,
          {
            kind: 'symbol',
            text: expression.operator,
            start: expression.range.start.offset,
            end: expression.range.start.offset + expression.operator.length,
          },
        )
        return null
      }
      return operandType ? expected : null
    }
    case 'binary': {
      const leftType = scalarExpressionType(ctx, expression.left)
      const rightType = scalarExpressionType(ctx, expression.right)
      const operator = expression.operator
      if (operator === '+' || operator === '-' || operator === '*' || operator === '/') {
        if ((leftType && leftType !== 'num') || (rightType && rightType !== 'num')) {
          ctx.addDiagnostic('invalid-data', `${operator} 运算要求两侧都是 num`)
          return null
        }
        return leftType && rightType ? 'num' : null
      }
      if (operator === 'AND' || operator === 'OR') {
        if ((leftType && leftType !== 'bool') || (rightType && rightType !== 'bool')) {
          ctx.addDiagnostic('invalid-data', `${operator} 运算要求两侧都是 bool`)
          return null
        }
        return leftType && rightType ? 'bool' : null
      }
      if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
        if ((leftType && leftType !== 'num') || (rightType && rightType !== 'num')) {
          ctx.addDiagnostic('invalid-data', `${operator} 比较要求两侧都是 num`)
          return null
        }
        return leftType && rightType ? 'bool' : null
      }
      if (leftType && rightType && leftType !== rightType) {
        ctx.addDiagnostic('invalid-data', `${operator} 比较要求两侧类型一致`)
        return null
      }
      return leftType && rightType ? 'bool' : null
    }
  }
}
