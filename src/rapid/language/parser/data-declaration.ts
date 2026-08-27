import type { RapidDataKind } from '../rapid-symbols.ts'
import {
  isKeyword,
  KNOWN_UNSUPPORTED_TYPES,
  normalizeName,
  SUPPORTED_DATA_KINDS,
  SYSTEM_NAMES,
} from '../rapid-symbols.ts'
import type { DataValidationContext } from '../rapid-data-validation.ts'
import { parseDataValue } from '../rapid-data-validation.ts'
import type { Token } from '../rapid-lexer.ts'
import { rangeFromOffsets, rangeFromToken } from '../rapid-lexer.ts'
import type { RapidDiagnosticCode } from '../rapid-diagnostics.ts'
import type { SymbolEntry } from '../rapid-symbols.ts'

/** 模块级数据声明 parser 的最小上下文；符号表所有权仍由 parseRapidProgram 保留。 */
export interface DataDeclarationContext {
  readonly source: string
  readonly lineStarts: readonly number[]
  readonly dataContext: DataValidationContext
  readonly current: () => Token
  readonly advance: () => Token
  readonly expectKeyword: (keyword: string) => Token | null
  readonly expectIdentifier: (description: string) => Token | null
  readonly expectSymbol: (symbol: string) => Token | null
  readonly skipToStatementEnd: () => void
  readonly addDiagnostic: (code: RapidDiagnosticCode, message: string, token?: Token) => void
  readonly addMissingDiagnostic: (code: RapidDiagnosticCode, message: string, token?: Token) => void
  readonly symbols: Map<string, SymbolEntry>
}

function validateStorage(
  ctx: DataDeclarationContext,
  kind: RapidDataKind,
  storageKind: 'const' | 'pers' | 'var',
  typeName: string,
): boolean {
  if (kind === 'num' || kind === 'bool') {
    if (storageKind !== 'var') {
      ctx.addDiagnostic('unsupported-option', `${typeName} 当前只支持模块级 VAR 声明`)
      return false
    }
    return true
  }
  if (
    (kind === 'tooldata' || kind === 'loaddata' || kind === 'wobjdata') &&
    storageKind !== 'pers'
  ) {
    ctx.addDiagnostic('invalid-data', `${typeName} 声明必须使用 PERS（模块级 ${typeName}）`)
    return false
  }
  if (kind === 'speeddata' || kind === 'zonedata') return true
  if (storageKind === 'var') {
    ctx.addDiagnostic('invalid-data', 'robtarget 声明不支持 VAR')
    return false
  }
  return true
}

/** 解析 CONST/PERS/TASK/VAR 数据声明并写入共享符号表。 */
export function parseDataDeclaration(ctx: DataDeclarationContext): void {
  const storage = ctx.advance()
  const declarationStart = storage.start
  let storageKind: 'const' | 'pers' | 'var' = 'const'
  if (isKeyword(storage, 'TASK')) {
    if (!ctx.expectKeyword('PERS')) {
      ctx.skipToStatementEnd()
      return
    }
    storageKind = 'pers'
  } else if (isKeyword(storage, 'PERS')) {
    storageKind = 'pers'
  } else if (isKeyword(storage, 'VAR')) {
    storageKind = 'var'
  }

  const type = ctx.expectIdentifier('数据类型')
  if (!type) {
    ctx.skipToStatementEnd()
    return
  }
  const typeName = normalizeName(type.text)
  const kind = SUPPORTED_DATA_KINDS[typeName]
  if (!kind) {
    if (KNOWN_UNSUPPORTED_TYPES.has(typeName)) {
      ctx.addDiagnostic('unsupported-option', `暂不支持 ${type.text} 声明`, type)
      ctx.skipToStatementEnd()
      return
    }
    ctx.addMissingDiagnostic(
      'syntax-error',
      '缺少数据类型（期望 robtarget/tooldata/wobjdata/loaddata/speeddata/zonedata/num/bool）',
      type,
    )
    ctx.skipToStatementEnd()
    return
  }

  const name = ctx.expectIdentifier(`${typeName} 名称`)
  const assign = ctx.expectSymbol(':=')
  if (!name || !assign) {
    ctx.skipToStatementEnd()
    return
  }
  const valueStartOffset = ctx.current().start
  const parsedValue = parseDataValue(ctx.dataContext, kind)
  const semicolon = ctx.expectSymbol(';')
  if (!parsedValue) return
  validateStorage(ctx, kind, storageKind, typeName)
  const declarationEnd = semicolon ? semicolon.end : ctx.current().start
  const nameRange = rangeFromToken(name, ctx.lineStarts)

  const key = normalizeName(name.text)
  if (ctx.symbols.has(key) || SYSTEM_NAMES.has(key)) {
    const label = SYSTEM_NAMES.has(key)
      ? `系统预定义 ${typeName} ${name.text} 不能重定义`
      : `重复定义 ${typeName} ${name.text}`
    ctx.addDiagnostic('duplicate-symbol', label, name)
    return
  }
  ctx.symbols.set(key, {
    kind,
    value: parsedValue,
    range: nameRange,
    declarationRange: rangeFromOffsets(declarationStart, declarationEnd, ctx.lineStarts),
    valueRange: rangeFromOffsets(
      valueStartOffset,
      semicolon ? semicolon.start : valueStartOffset,
      ctx.lineStarts,
    ),
    storage: storageKind,
    references: [],
  })
}
