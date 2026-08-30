import type { ConfigurationMonitoringMode, SingAreaMode } from '../../data/index.ts'
import type { Token } from '../../language/rapid-lexer.ts'
import { rangeFromOffsets } from '../../language/rapid-lexer.ts'
import type { RapidDiagnosticCode } from '../../language/rapid-diagnostics.ts'
import { normalizeName } from '../../language/rapid-symbols.ts'
import type { PendingStatement } from '../../language/parser/pending-types.ts'

/** 模式语句 parser 的最小上下文；游标、诊断与输出容器仍由主 parser 独占。 */
export interface ModeStatementContext {
  readonly source: string
  readonly lineStarts: readonly number[]
  advance(): Token
  expectSymbol(symbol: string): Token | null
  expectIdentifier(description: string): Token | null
  addDiagnostic(code: RapidDiagnosticCode, message: string, token?: Token): void
  statementSink: PendingStatement[]
}

export function parseSingArea(ctx: ModeStatementContext): void {
  const start = ctx.advance()
  const slash = ctx.expectSymbol('\\')
  const modeToken = ctx.expectIdentifier('SingArea 模式（Wrist/Off）')
  const semicolon = ctx.expectSymbol(';')
  if (!slash || !modeToken || !semicolon) return
  const modeName = normalizeName(modeToken.text)
  if (modeName !== 'wrist' && modeName !== 'off') {
    ctx.addDiagnostic(
      'unsupported-option',
      `不支持 SingArea 模式 ${modeToken.text}（仅支持 \\Wrist/\\Off）`,
      modeToken,
    )
    return
  }
  ctx.statementSink.push({
    kind: 'singarea',
    singArea: {
      mode: modeName as SingAreaMode,
      range: rangeFromOffsets(start.start, semicolon.end, ctx.lineStarts),
      sourceText: ctx.source.slice(start.start, semicolon.end),
    },
  })
}

export function parseConfiguration(
  ctx: ModeStatementContext,
  kind: 'confj' | 'confl',
): void {
  const start = ctx.advance()
  const slash = ctx.expectSymbol('\\')
  const modeToken = ctx.expectIdentifier(`${kind === 'confj' ? 'ConfJ' : 'ConfL'} 模式（On/Off）`)
  const semicolon = ctx.expectSymbol(';')
  if (!slash || !modeToken || !semicolon) return
  const modeName = normalizeName(modeToken.text)
  if (modeName !== 'on' && modeName !== 'off') {
    ctx.addDiagnostic(
      'unsupported-option',
      `不支持 ${kind === 'confj' ? 'ConfJ' : 'ConfL'} 模式 ${modeToken.text}（仅支持 \\On/\\Off）`,
      modeToken,
    )
    return
  }
  ctx.statementSink.push({
    kind,
    configuration: {
      mode: modeName as ConfigurationMonitoringMode,
      range: rangeFromOffsets(start.start, semicolon.end, ctx.lineStarts),
      sourceText: ctx.source.slice(start.start, semicolon.end),
    },
  })
}
