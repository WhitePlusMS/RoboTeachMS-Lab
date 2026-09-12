import type { OperandSlotResult } from '../rapid-symbols.ts'
import { isSymbol, normalizeName } from '../rapid-symbols.ts'
import type { DataValidationContext } from '../rapid-data-validation.ts'
import { parseFiniteNumber } from '../rapid-data-validation.ts'
import type { Token } from '../rapid-lexer.ts'
import { rangeFromOffsets, rangeFromToken } from '../rapid-lexer.ts'
import type { RapidDiagnosticCode } from '../rapid-diagnostics.ts'
import type { PendingTarget } from './pending-types.ts'

export interface TargetOperandResult {
  target: PendingTarget | null
  separatorConsumed: boolean
}

/** 目标表达式 parser 的最小上下文；恢复边界由 statement parser 注入。 */
export interface TargetExpressionContext {
  readonly source: string
  readonly lineStarts: readonly number[]
  readonly dataContext: DataValidationContext
  readonly current: () => Token
  readonly advance: () => Token
  readonly expectIdentifier: (description: string) => Token | null
  readonly expectSymbol: (symbol: string) => Token | null
  readonly addDiagnostic: (code: RapidDiagnosticCode, message: string, token?: Token) => void
  readonly addMissingDiagnostic: (code: RapidDiagnosticCode, message: string, token?: Token) => void
  readonly atOperandBoundary: () => boolean
  readonly recoverMotionTail: () => void
}

function expectOperandSlot(
  ctx: TargetExpressionContext,
  description: string,
  onAbort: () => void,
): OperandSlotResult {
  if (isSymbol(ctx.current(), ',')) {
    ctx.addMissingDiagnostic(
      'syntax-error',
      `缺少${description}（空操作数，当前为 ","）`,
      ctx.current(),
    )
    ctx.advance()
    return { token: null, separatorConsumed: true }
  }
  if (ctx.atOperandBoundary()) {
    ctx.addMissingDiagnostic(
      'syntax-error',
      '运动指令参数不完整（缺少 "," 分隔的操作数或分号）',
      ctx.current(),
    )
    onAbort()
    return { token: null, separatorConsumed: false }
  }
  return { token: ctx.expectIdentifier(description), separatorConsumed: false }
}

/** 解析普通 robtarget、Offs 和 RelTool 目标操作数。 */
export function parseTargetOperand(
  ctx: TargetExpressionContext,
  onAbort: () => void,
): TargetOperandResult {
  if (isSymbol(ctx.current(), '*')) {
    const star = ctx.advance()
    ctx.addDiagnostic('missing-target', '目标点未示教（*）：请选择已有点位或新建点位', star)
    return {
      target: {
        kind: 'star',
        baseName: '*',
        baseToken: star,
        range: rangeFromToken(star, ctx.lineStarts),
        sourceText: '*',
      },
      separatorConsumed: false,
    }
  }

  const slot = expectOperandSlot(ctx, '目标点名称', onAbort)
  const first = slot.token
  if (!first) return { target: null, separatorConsumed: slot.separatorConsumed }
  const keyword = normalizeName(first.text)

  if ((keyword === 'offs' || keyword === 'reltool') && isSymbol(ctx.current(), '(')) {
    const exprStart = first.start
    ctx.advance() // '('
    const base = ctx.expectIdentifier('基准目标名称')
    if (!base) {
      ctx.recoverMotionTail()
      onAbort()
      return { target: null, separatorConsumed: false }
    }
    const params: number[] = []
    while (isSymbol(ctx.current(), ',')) {
      ctx.advance() // ','
      const value = parseFiniteNumber(ctx.dataContext, `${first.text} 的参数`)
      if (value === null) {
        ctx.recoverMotionTail()
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
      while (isSymbol(ctx.current(), '\\')) {
        ctx.advance()
        const option = ctx.expectIdentifier('RelTool 可选参数名称')
        if (!option) {
          ctx.recoverMotionTail()
          onAbort()
          return { target: null, separatorConsumed: false }
        }
        const optionName = normalizeName(option.text)
        if (optionName !== 'rx' && optionName !== 'ry' && optionName !== 'rz') {
          ctx.addDiagnostic('unsupported-option', `不支持 RelTool 可选参数 ${option.text}`, option)
          ctx.recoverMotionTail()
          onAbort()
          return { target: null, separatorConsumed: false }
        }
        if (namedRotationNames.has(optionName)) {
          ctx.addDiagnostic('unsupported-option', `重复的 RelTool 可选参数 ${option.text}`, option)
          ctx.recoverMotionTail()
          onAbort()
          return { target: null, separatorConsumed: false }
        }
        namedRotationNames.add(optionName)
        namedRotationCount += 1
        const assign = ctx.expectSymbol(':=')
        const value = parseFiniteNumber(ctx.dataContext, `RelTool ${option.text} 的参数`)
        if (!assign || value === null) {
          ctx.recoverMotionTail()
          onAbort()
          return { target: null, separatorConsumed: false }
        }
        if (optionName === 'rx') namedRx = value
        if (optionName === 'ry') namedRy = value
        if (optionName === 'rz') namedRz = value
      }
    }
    if (!isSymbol(ctx.current(), ')')) {
      ctx.addMissingDiagnostic('syntax-error', `缺少 ${first.text} 的右括号 ")"`, ctx.current())
      ctx.recoverMotionTail()
      onAbort()
      return { target: null, separatorConsumed: false }
    }
    ctx.advance() // ')'
    const paramCount = params.length
    if (keyword === 'offs' && paramCount !== 3) {
      ctx.addDiagnostic('invalid-data', `Offs 需要 3 个平移参数，实际 ${paramCount} 个`, first)
      return { target: null, separatorConsumed: false }
    }
    if (keyword === 'reltool' && namedRotationCount > 0 && paramCount !== 3) {
      ctx.addDiagnostic(
        'invalid-data',
        `RelTool 使用命名旋转开关时必须有 3 个平移参数，实际 ${paramCount} 个`,
        first,
      )
      return { target: null, separatorConsumed: false }
    }
    if (keyword === 'reltool' && namedRotationCount === 0 && paramCount !== 3 && paramCount !== 6) {
      ctx.addDiagnostic('invalid-data', `RelTool 需要 3 或 6 个参数，实际 ${paramCount} 个`, first)
      return { target: null, separatorConsumed: false }
    }
    const [dx, dy, dz, rx, ry, rz] = params
    const end = ctx.current().start
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
        range: rangeFromOffsets(exprStart, end, ctx.lineStarts),
        sourceText: ctx.source.slice(exprStart, end),
      },
      separatorConsumed: false,
    }
  }

  return {
    target: {
      kind: 'name',
      baseName: first.text,
      baseToken: first,
      range: rangeFromToken(first, ctx.lineStarts),
      sourceText: first.text,
    },
    separatorConsumed: slot.separatorConsumed,
  }
}
