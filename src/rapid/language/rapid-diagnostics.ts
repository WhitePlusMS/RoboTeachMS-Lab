import type { RapidSourceRange } from './rapid-lexer.ts'

/**
 * 诊断模型：结构化问题的稳定代码、严重级别与源码范围。
 * 词法、语法、名称解析和静态数据校验产生的诊断统一落在这里。
 * 本模块还提供诊断列表排序与去重的稳定契约（供 parser 出口使用）。
 */

export type RapidDiagnosticCode =
  | 'lexical-error'
  | 'syntax-error'
  | 'unsupported-syntax'
  | 'unsupported-option'
  | 'duplicate-symbol'
  | 'undefined-symbol'
  | 'invalid-data'
  | 'missing-module'
  | 'missing-entrypoint'
  | 'missing-target'

export interface RapidDiagnostic {
  code: RapidDiagnosticCode
  severity: 'error'
  message: string
  range: RapidSourceRange
}

/**
 * 稳定诊断契约：按 (start.offset, end.offset, 生成次序) 升序排列，并按
 * 相同 code + 相同起止 offset 去重，使同一源码重复解析得到顺序完全一致、无重复项的诊断列表。
 * 原地修改传入数组。
 */
export function sortAndDedupeDiagnostics(diagnostics: RapidDiagnostic[]): void {
  diagnostics.sort((a, b) => {
    const aStart = a.range.start.offset
    const bStart = b.range.start.offset
    if (aStart !== bStart) return aStart - bStart
    return a.range.end.offset - b.range.end.offset
  })
  for (let index = 1; index < diagnostics.length; index += 1) {
    const prev = diagnostics[index - 1]
    const cur = diagnostics[index]
    if (
      prev.code === cur.code &&
      prev.range.start.offset === cur.range.start.offset &&
      prev.range.end.offset === cur.range.end.offset
    ) {
      diagnostics.splice(index, 1)
      index -= 1
    }
  }
}
