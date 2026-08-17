import { describe, expect, it } from 'vitest'
import { isRobtargetProgramData, parseRapidProgram, type RapidDiagnostic } from './rapid-parser.ts'
import { MAIN_MODULE_CLOSING, MODULE_WITH_P1_MAIN_PREFIX } from './rapid-parser-test-fixtures.ts'

function getDiagnostics(source: string): readonly RapidDiagnostic[] {
  return parseRapidProgram(source).diagnostics
}

/** 诊断按 (start.offset, end.offset, 生成次序) 升序排序。 */
function isSortedByOffset(diagnostics: readonly RapidDiagnostic[]): boolean {
  for (let i = 1; i < diagnostics.length; i += 1) {
    const prev = diagnostics[i - 1]
    const cur = diagnostics[i]
    if (
      cur.range.start.offset < prev.range.start.offset ||
      (cur.range.start.offset === prev.range.start.offset &&
        cur.range.end.offset < prev.range.end.offset)
    ) {
      return false
    }
  }
  return true
}

describe('Ticket 01 — 诊断稳定契约', () => {
  it('同一含多错误源码重复解析时，诊断 code 与范围顺序完全一致', () => {
    const source =
      MODULE_WITH_P1_MAIN_PREFIX +
      '        MoveJ p1,v100\n        MoveL unknown,v50,fine,tool0;\n' +
      MAIN_MODULE_CLOSING
    const first = parseRapidProgram(source)
    const second = parseRapidProgram(source)
    expect(second.diagnostics).toEqual(first.diagnostics)
  })

  it('诊断严格按 start.offset、end.offset、生成次序升序排列', () => {
    // 人为制造跨位置的多 error：缺操作数（前）与未定义符号（后）。
    const source =
      MODULE_WITH_P1_MAIN_PREFIX +
      '        MoveJ p1,v100\n        MoveL nope,v50,fine,tool0;\n' +
      MAIN_MODULE_CLOSING
    const result = parseRapidProgram(source)
    expect(result.diagnostics.length).toBeGreaterThan(1)
    expect(isSortedByOffset(result.diagnostics)).toBe(true)
    const offsets = result.diagnostics.map((d) => d.range.start.offset)
    expect([...offsets]).toEqual([...offsets].sort((a, b) => a - b))
  })

  it('相同 code 与相同起止 offset 的重复诊断只保留一条', () => {
    // 缺 MODULE 的根因：missing-module 可能被抛出两处，去重后只留一条。
    const result = parseRapidProgram('PROC main()\nENDPROC\n')
    const missing = result.diagnostics.filter((d) => d.code === 'missing-module')
    expect(missing.length).toBeLessThanOrEqual(1)
  })

  it('缺失关键字/expec 的 token 使用零长度范围，指向应插入的位置', () => {
    // 缺 MODULE 关键字：应插入位置在 offset 0，零长度范围。
    const d = getDiagnostics('PROC main()\nENDPROC\n')[0]
    expect(d.range.start.offset).toBe(d.range.end.offset)
  })

  it('已有错误内容只覆盖最小错误 token（非零范围）', () => {
    // 缺 ENDMODULE 转为… 这里用一个尾随多余 token 的场景验证非零范围。
    const source = 'MODULE T\nPROC main()\nENDPROC\nENDMODULE\nextra'
    const d = getDiagnostics(source).find((x) => x.code === 'unsupported-syntax')
    expect(d?.range.start.offset).toBeLessThan(d?.range.end.offset ?? -1)
  })

  it('一处根因不派生一串“后续所有操作数均缺失”的连锁错误', () => {
    // MoveJ 后只有 target，却缺逗号/速度/zone/tool：只应有一条指向根因，且不再吞掉 ENDPROC。
    const result = parseRapidProgram(
      MODULE_WITH_P1_MAIN_PREFIX + '        MoveJ p1\n' + MAIN_MODULE_CLOSING,
    )
    const commas = result.diagnostics.filter((d) => d.message.includes('期望符号 ,'))
    expect(commas.length).toBeLessThanOrEqual(1)
    // ENDPROC / ENDMODULE 真实存在，不能被误报为缺失。
    expect(result.diagnostics.some((d) => d.message.includes('期望关键字 ENDPROC'))).toBe(false)
    expect(result.diagnostics.some((d) => d.message.includes('缺少 ENDMODULE'))).toBe(false)
  })

  it('运动断裂后恢复到下一条已知运动，不把下一条指令误当操作数', () => {
    const source =
      MODULE_WITH_P1_MAIN_PREFIX +
      '        MoveJ garbage garbage2\n        MoveL p1,v50,fine,tool0;\n' +
      MAIN_MODULE_CLOSING
    const result = parseRapidProgram(source)
    // 下一条合法 MoveL 的操作数不能被误报为“暂不支持 fine/tool0”。
    expect(
      result.diagnostics.some((d) => d.code === 'unsupported-option' && d.message.includes('fine')),
    ).toBe(false)
    // 但仍需保留根因：garbage 是未定义符号。
    expect(result.diagnostics.some((d) => d.code === 'undefined-symbol')).toBe(true)
  })

  it('LF 与 CRLF 的同一程序得到相同逻辑行、列与源码片段', () => {
    const lf =
      MODULE_WITH_P1_MAIN_PREFIX +
      '        MoveJ p1,v100,fine,tool0;\n' +
      '        MoveL p1,v50,fine,tool0\\WObj:=wobj0;\n' +
      MAIN_MODULE_CLOSING
    const crlf = lf.replace(/\n/g, '\r\n')
    const a = parseRapidProgram(lf)
    const b = parseRapidProgram(crlf)
    expect(a.program).toHaveLength(2)
    expect(b.program).toHaveLength(2)
    // 逐条对比行、列与源码片段，排除 \r 造成的偏移。
    for (let i = 0; i < a.program.length; i += 1) {
      const ia = a.program[i]
      const ib = b.program[i]
      expect(ib.sourceRange.start.line).toBe(ia.sourceRange.start.line)
      expect(ib.sourceRange.start.column).toBe(ia.sourceRange.start.column)
      expect(ib.sourceRange.end.column).toBe(ia.sourceRange.end.column)
      expect(ib.sourceText).toBe(ia.sourceText)
    }
  })

  it('注释中的 MoveJ/MoveL 与点位名不成为指令或引用，空行不改变指令顺序', () => {
    const source =
      MODULE_WITH_P1_MAIN_PREFIX +
      '\n\n        ! comment MoveJ p1,v100,fine,tool0;\n\n' +
      '        MoveJ p1,v100,fine,tool0;\n' +
      MAIN_MODULE_CLOSING
    const result = parseRapidProgram(source)
    expect(result.program).toHaveLength(1)
    expect(result.program[0].kind).toBe('movej')
    expect(result.data[0].referenceRanges).toHaveLength(1)
    expect(result.canExecute).toBe(true)
  })

  it('现有合法 MoveJ/MoveL 的 Program Data 与插入锚点保持原行为（回归）', () => {
    const source =
      MODULE_WITH_P1_MAIN_PREFIX +
      '        MoveJ p1,v100,fine,tool0;\n' +
      '        MoveL p1,v50,fine,tool0\\WObj:=wobj0;\n' +
      MAIN_MODULE_CLOSING
    const result = parseRapidProgram(source)
    expect(result.diagnostics).toEqual([])
    expect(result.canExecute).toBe(true)
    expect(result.program).toHaveLength(2)
    // 只读 Program Data 中的 robtarget 点位保持原语义（其余四类 + 系统预定义项不在此断言之列）。
    const rb = result.data.filter(isRobtargetProgramData)
    expect(rb).toHaveLength(1)
    expect(rb[0].referenceRanges).toHaveLength(2)
    expect(result.motionInsertionPoints.map((p) => p.index)).toEqual([0, 1, 2])
  })
})
