import { isKeyword, isSymbol } from '../rapid-symbols.ts'
import type { RapidDiagnosticCode } from '../rapid-diagnostics.ts'
import type { Token } from '../rapid-lexer.ts'

/** 语句路由上下文；具体语句 parser 由主 parser 注入，避免共享可变语义状态。 */
export interface StatementParserContext {
  readonly current: () => Token
  readonly peek: (offset?: number) => Token
  readonly advance: () => Token
  readonly addDiagnostic: (code: RapidDiagnosticCode, message: string, token?: Token) => void
  readonly parseMotion: () => void
  readonly parseSingArea: () => void
  readonly parseConfiguration: (kind: 'confj' | 'confl') => void
  readonly parseAssignment: () => void
  readonly parseConditional: () => void
  readonly parseWhile: () => void
  readonly parseFor: () => void
  readonly parseExitDo: () => void
  readonly skipUnsupportedControl: () => void
  readonly skipToStatementEnd: () => void
}

/** 按当前 token 路由一段语句；控制块由对应 parser 递归消费自己的 terminator。 */
export function parseStatementList(
  ctx: StatementParserContext,
  terminators: ReadonlySet<string>,
): void {
  while (
    ctx.current().kind !== 'eof' &&
    !isKeyword(ctx.current(), 'ENDPROC') &&
    !isKeyword(ctx.current(), 'ENDMODULE') &&
    !terminators.has(ctx.current().text)
  ) {
    if (
      isKeyword(ctx.current(), 'MOVEJ') ||
      isKeyword(ctx.current(), 'MOVEL') ||
      isKeyword(ctx.current(), 'MOVEC')
    ) {
      ctx.parseMotion()
    } else if (isKeyword(ctx.current(), 'SINGAREA')) {
      ctx.parseSingArea()
    } else if (isKeyword(ctx.current(), 'CONFJ')) {
      ctx.parseConfiguration('confj')
    } else if (isKeyword(ctx.current(), 'CONFL')) {
      ctx.parseConfiguration('confl')
    } else if (ctx.current().kind === 'identifier' && isSymbol(ctx.peek(), ':=')) {
      ctx.parseAssignment()
    } else if (isKeyword(ctx.current(), 'IF')) {
      ctx.parseConditional()
    } else if (isKeyword(ctx.current(), 'WHILE')) {
      ctx.parseWhile()
    } else if (isKeyword(ctx.current(), 'FOR')) {
      ctx.parseFor()
    } else if (isKeyword(ctx.current(), 'EXITDO')) {
      ctx.parseExitDo()
    } else if (isKeyword(ctx.current(), 'MOVEABSJ')) {
      ctx.skipUnsupportedControl()
    } else if (
      isKeyword(ctx.current(), 'ELSEIF') ||
      isKeyword(ctx.current(), 'ELSE') ||
      isKeyword(ctx.current(), 'ENDIF') ||
      isKeyword(ctx.current(), 'ENDWHILE') ||
      isKeyword(ctx.current(), 'ENDFOR')
    ) {
      ctx.addDiagnostic('syntax-error', `${ctx.current().text} 没有对应的 IF/WHILE/FOR 控制流结束结构`)
      ctx.advance()
    } else {
      ctx.addDiagnostic('unsupported-syntax', `首期不支持 ${ctx.current().text || '空语句'}`)
      ctx.skipToStatementEnd()
    }
  }
}
