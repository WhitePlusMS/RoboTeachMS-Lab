import type { RapidDiagnostic } from './rapid-diagnostics.ts'

/**
 * 词法分析：把 RAPID 源码切成 token，并维护每一维源码位置的换算。
 * 本模块只负责切 token 与位置换算，不含任何语法/语义解释；
 * 它与源码位置类型一起构成整个 parser 的最低层。
 */

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

export type TokenKind = 'identifier' | 'number' | 'string' | 'symbol' | 'eof'

export interface Token {
  kind: TokenKind
  text: string
  start: number
  end: number
}

/** 数字 token 不吞掉前置正负号；这样 `a-1` 与 `a - 1` 具有相同的表达式结构。 */
const NUMBER_PATTERN = /^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*/

export function buildLineStarts(source: string): number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1)
  }
  return starts
}

export function positionAt(offset: number, lineStarts: readonly number[]): RapidSourcePosition {
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

export function rangeFromOffsets(
  start: number,
  end: number,
  lineStarts: readonly number[],
): RapidSourceRange {
  return { start: positionAt(start, lineStarts), end: positionAt(end, lineStarts) }
}

export function rangeFromToken(token: Token, lineStarts: readonly number[]): RapidSourceRange {
  return rangeFromOffsets(token.start, token.end, lineStarts)
}

export function lex(
  source: string,
  lineStarts: readonly number[],
): {
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
      tokens.push({
        kind: 'string',
        text: source.slice(index, end + 1),
        start: index,
        end: end + 1,
      })
      index = end + 1
      continue
    }

    const rest = source.slice(index)
    const identifier = rest.match(IDENTIFIER_PATTERN)
    if (identifier) {
      tokens.push({
        kind: 'identifier',
        text: identifier[0],
        start: index,
        end: index + identifier[0].length,
      })
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
      tokens.push({
        kind: 'symbol',
        text: comparison,
        start: index,
        end: index + comparison.length,
      })
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
