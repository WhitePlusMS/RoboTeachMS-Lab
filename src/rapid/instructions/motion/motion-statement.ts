import type { OperandKind } from '../../language/rapid-symbols.ts'
import { isSymbol, normalizeName } from '../../language/rapid-symbols.ts'
import type { Token } from '../../language/rapid-lexer.ts'
import { positionAt, rangeFromOffsets } from '../../language/rapid-lexer.ts'
import type {
  PendingMotion,
  PendingStatement,
  PendingTarget,
  PendingTargetExpressionKind,
} from '../../language/parser/pending-types.ts'
import {
  parseTargetOperand,
  type TargetExpressionContext,
} from '../../language/parser/target-expression.ts'

/** 运动语句 parser 的上下文；运动锚点和 pending 引用仍由主 parser 统一收集。 */
export interface MotionStatementContext extends TargetExpressionContext {
  readonly queueReference: (
    kind: OperandKind,
    nameToken: Token,
    targetExpression?: PendingTargetExpressionKind,
  ) => void
  readonly motionAnchors: Array<{ offset: number; line: number }>
  readonly statementSink: PendingStatement[]
}

/** 解析 MoveJ/MoveL/MoveC 操作数，并在成功时写入当前 pending statement 容器。 */
export function parseMotion(ctx: MotionStatementContext): void {
  const start = ctx.advance()
  const kind = normalizeName(start.text) as PendingMotion['kind']
  ctx.motionAnchors.push({ offset: start.start, line: positionAt(start.start, ctx.lineStarts).line })
  let abandoned = false
  const abort = (): void => {
    abandoned = true
  }

  const firstTargetResult = parseTargetOperand(ctx, abort)
  const firstTarget = firstTargetResult.target
  let separatorConsumed = firstTargetResult.separatorConsumed
  if (firstTarget && firstTarget.kind !== 'star') {
    ctx.queueReference('target', firstTarget.baseToken, firstTarget.kind === 'name' ? undefined : firstTarget.kind)
  }
  if (abandoned) return

  let cirPoint: PendingTarget | undefined = undefined
  let target = firstTarget
  if (kind === 'movec') {
    if (firstTarget === null) return
    cirPoint = firstTarget
    if (!separatorConsumed && !isSymbol(ctx.current(), ',')) {
      if (ctx.atOperandBoundary()) {
        ctx.addMissingDiagnostic(
          'syntax-error',
          'MoveC 指令缺少圆弧终点 ToPoint（缺少 "," 分隔的操作数或分号）',
          ctx.current(),
        )
      } else {
        ctx.addMissingDiagnostic('syntax-error', 'MoveC 的圆点与终点之间缺少逗号 ","', ctx.current())
        ctx.recoverMotionTail()
      }
      abort()
      return
    }
    if (!separatorConsumed) ctx.advance()
    const toResult = parseTargetOperand(ctx, abort)
    target = toResult.target
    separatorConsumed = toResult.separatorConsumed
    if (target && target.kind !== 'star') {
      ctx.queueReference('target', target.baseToken, target.kind === 'name' ? undefined : target.kind)
    }
    if (abandoned) return
  }

  const operandAfterSeparator = (description: string): Token | null => {
    if (!separatorConsumed && !isSymbol(ctx.current(), ',')) {
      if (ctx.atOperandBoundary()) {
        ctx.addMissingDiagnostic(
          'syntax-error',
          '运动指令参数不完整（缺少 "," 分隔的操作数或分号）',
          ctx.current(),
        )
      } else {
        ctx.addMissingDiagnostic('syntax-error', '运动操作数之间缺少逗号 ","', ctx.current())
        ctx.recoverMotionTail()
      }
      abort()
      return null
    }
    if (!separatorConsumed) ctx.advance()
    const token = ctx.current()
    if (isSymbol(token, ',')) {
      ctx.addMissingDiagnostic('syntax-error', `缺少${description}（空操作数，当前为 ","）`, token)
      ctx.advance()
      separatorConsumed = true
      return null
    }
    if (ctx.atOperandBoundary()) {
      ctx.addMissingDiagnostic(
        'syntax-error',
        '运动指令参数不完整（缺少 "," 分隔的操作数或分号）',
        token,
      )
      abort()
      return null
    }
    const operand = ctx.expectIdentifier(description)
    separatorConsumed = false
    return operand
  }

  const speed = operandAfterSeparator('速度名称')
  if (abandoned) return
  const zone = operandAfterSeparator('zone 名称')
  if (abandoned) return
  const tool = operandAfterSeparator('工具名称')
  if (abandoned) return
  if (speed) ctx.queueReference('speed', speed)
  if (zone) ctx.queueReference('zone', zone)
  if (tool) ctx.queueReference('tool', tool)

  const rejectTrailingParams = (allowWobj: boolean): boolean => {
    const hasWobj = allowWobj && isSymbol(ctx.current(), '\\')
    if (!isSymbol(ctx.current(), ';') && !hasWobj && !ctx.atOperandBoundary()) {
      ctx.addMissingDiagnostic(
        'syntax-error',
        `运动指令包含多余参数 ${ctx.current().text || '（空）'}`,
        ctx.current(),
      )
      ctx.recoverMotionTail()
      return true
    }
    return false
  }

  if (rejectTrailingParams(true)) return

  let wobjName = 'wobj0'
  let wobjToken: Token | null = null
  let sawWobjOption = false
  while (isSymbol(ctx.current(), '\\')) {
    ctx.advance()
    const option = ctx.expectIdentifier('可选参数名称')
    if (!option) {
      ctx.recoverMotionTail()
      return
    }
    if (normalizeName(option.text) !== 'wobj') {
      ctx.addDiagnostic('unsupported-option', `不支持可选参数 ${option.text}`, option)
      ctx.recoverMotionTail()
      return
    }
    if (sawWobjOption) {
      ctx.addDiagnostic('unsupported-option', '重复的 WObj 可选参数', option)
      ctx.recoverMotionTail()
      return
    }
    sawWobjOption = true
    const assign = ctx.expectSymbol(':=')
    const wobj = ctx.expectIdentifier('工件坐标名称')
    if (!assign || !wobj) {
      ctx.recoverMotionTail()
      return
    }
    wobjName = wobj.text
    wobjToken = wobj
    ctx.queueReference('wobj', wobj)
  }

  if (rejectTrailingParams(false)) return

  const semicolon = ctx.expectSymbol(';')
  const end = semicolon ?? ctx.current()
  if (!target || !speed || !zone || !tool) return
  ctx.statementSink.push({
    kind: 'motion',
    motion: {
      kind,
      target: target as PendingTarget,
      ...(kind === 'movec' && cirPoint ? { cirPoint } : {}),
      speedName: speed.text,
      speedToken: speed,
      zoneName: zone.text,
      zoneToken: zone,
      toolName: tool.text,
      toolToken: tool,
      wobjName,
      wobjToken,
      range: rangeFromOffsets(start.start, end.end, ctx.lineStarts),
      sourceText: ctx.source.slice(start.start, end.end),
    },
  })
}
