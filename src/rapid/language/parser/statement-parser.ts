import { isKeyword, isSymbol } from '../rapid-symbols.ts'
import type { RapidDiagnosticCode } from '../rapid-diagnostics.ts'
import type { Token } from '../rapid-lexer.ts'
import { LEAF_INSTRUCTION_KEYWORDS } from '../../instructions/index.ts'

/** 运动/模式叶子指令的关键字集合；与 rapid/instructions/index.ts 的注册表共用同一份真源，不重复维护。 */
const MOTION_KEYWORDS = [
  ...LEAF_INSTRUCTION_KEYWORDS.movej,
  ...LEAF_INSTRUCTION_KEYWORDS.movel,
  ...LEAF_INSTRUCTION_KEYWORDS.movec,
]
const [SINGAREA_KEYWORD] = LEAF_INSTRUCTION_KEYWORDS.singarea
const [CONFJ_KEYWORD] = LEAF_INSTRUCTION_KEYWORDS.confj
const [CONFL_KEYWORD] = LEAF_INSTRUCTION_KEYWORDS.confl

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
    if (MOTION_KEYWORDS.some((keyword) => isKeyword(ctx.current(), keyword))) {
      ctx.parseMotion()
    } else if (isKeyword(ctx.current(), SINGAREA_KEYWORD)) {
      ctx.parseSingArea()
    } else if (isKeyword(ctx.current(), CONFJ_KEYWORD)) {
      ctx.parseConfiguration('confj')
    } else if (isKeyword(ctx.current(), CONFL_KEYWORD)) {
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
