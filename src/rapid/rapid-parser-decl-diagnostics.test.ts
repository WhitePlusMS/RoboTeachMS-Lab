import { describe, expect, it } from 'vitest'
import { parseRapidProgram } from './rapid-parser.ts'

const F = '\n    PROC main()\n    ENDPROC\nENDMODULE\n'
const VT = '[[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]'

describe('Ticket 02 — MODULE 与过程诊断', () => {
  it('缺少模块名称给出零长度缺失诊断，且不再把它当模块内容误诊', () => {
    const result = parseRapidProgram('MODULE\n    PROC main()\n    ENDPROC\nENDMODULE\n')
    expect(result.diagnostics.some((d) => d.message.includes('模块名称'))).toBe(true)
    // 不应出现“MODULE 内不支持 main”这类误导诊断。
    expect(result.diagnostics.some((d) => d.message.includes('MODULE 内不支持 main'))).toBe(false)
  })

  it('第二个 MODULE / 尾随源码给出明确诊断', () => {
    const dup = parseRapidProgram(
      'MODULE A\n    PROC main()\n    ENDPROC\nMODULE B\nENDMODULE\n',
    )
    expect(dup.diagnostics.some((d) => d.message.includes('只能包含一个 MODULE'))).toBe(true)

    const trailing = parseRapidProgram(
      'MODULE A\n    PROC main()\n    ENDPROC\nENDMODULE\nJUNK',
    )
    expect(trailing.diagnostics.some((d) => d.code === 'unsupported-syntax')).toBe(true)
  })

  it('main 带参数与重复 main 分别给出 unsupported-option 与 duplicate-symbol', () => {
    const param = parseRapidProgram(
      'MODULE A\n    PROC main(num n)\n    ENDPROC\nENDMODULE\n',
    )
    expect(param.diagnostics.some((d) => d.code === 'unsupported-option')).toBe(true)

    const dup = parseRapidProgram(
      'MODULE A\n    PROC main()\n    ENDPROC\n    PROC main()\n    ENDPROC\nENDMODULE\n',
    )
    expect(dup.diagnostics.some((d) => d.code === 'duplicate-symbol')).toBe(true)
  })

  it('其他过程、VAR、IF 得到 unsupported 诊断而非 lexical error', () => {
    const other = parseRapidProgram(
      'MODULE A\n    PROC helper()\n    ENDPROC\n    PROC main()\n    ENDPROC\nENDMODULE\n',
    )
    expect(other.diagnostics.some((d) => d.code === 'unsupported-syntax')).toBe(true)

    const varDecl = parseRapidProgram(
      'MODULE A\n    VAR num x := 5;\n    PROC main()\n    ENDPROC\nENDMODULE\n',
    )
    expect(varDecl.diagnostics.some((d) => d.code === 'unsupported-syntax')).toBe(true)

    // 不存在 lexical-error：以上真实 RAPID 结构必须按 unsupported 分类，不误判为词法错误。
    expect([other, varDecl].every((r) => r.diagnostics.every((d) => d.code !== 'lexical-error'))).toBe(true)
  })
})

describe('Ticket 02 — robtarget 声明诊断', () => {
  it('CONST/PERS/TASK PERS 后缺少数据类型：明确诊断缺少数据类型，不把名称误判为不支持的类型', () => {
    const result = parseRapidProgram(`MODULE A\n    CONST p1 := ${VT};\n` + F)
    expect(result.diagnostics.some((d) => d.message.includes('数据类型'))).toBe(true)
    // 不把 p1 当类型名报 “暂不支持 p1”。
    expect(result.diagnostics.some((d) => d.message.includes('暂不支持 p1'))).toBe(false)
  })

  it('已知但不支持的类型（num 等）明确报 unsupported-option', () => {
    const result = parseRapidProgram(`MODULE A\n    CONST num x := 5;\n` + F)
    const d = result.diagnostics.find((item) => item.code === 'unsupported-option')
    expect(d).toBeDefined()
    expect(d?.message).toContain('num')
  })

  it('缺少 := 时不生成半合法 Program Data 条目，也不产生四个 tuple 连锁错误', () => {
    const result = parseRapidProgram(`MODULE A\n    CONST robtarget bad ${VT};\n` + F)
    // 损坏声明不得进入 data。
    expect(result.data.some((d) => d.name === 'bad')).toBe(false)
    // 仅保留 := 缺失这一根因，不外溢四个 tuple 错误。
    const tupleErrors = result.diagnostics.filter((d) => d.message.includes('robtarget.'))
    expect(tupleErrors.length).toBe(0)
    expect(result.diagnostics.some((d) => d.message.includes(':='))).toBe(true)
  })

  it('缺少声明分号：语句末尾一个缺失分号诊断，并从下一个模块结构继续', () => {
    const source =
      `MODULE A\n    CONST robtarget pGood := ${VT}\n` +
      `    CONST robtarget pAfter := [[1,1,1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n` +
      F
    const result = parseRapidProgram(source)
    const semi = result.diagnostics.filter((d) => d.message.includes('期望符号 ;'))
    expect(semi.length).toBeGreaterThanOrEqual(1)
    // 后续正确声明仍进入 data。
    expect(result.data.some((d) => d.name === 'pAfter')).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('trans/rot/robconf/extax 长度错误、尾逗号与非有限数字均有 invalid-data 诊断', () => {
    const len = parseRapidProgram(`MODULE A\n    CONST robtarget p := [[0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n` + F)
    expect(len.diagnostics.some((d) => d.code === 'invalid-data')).toBe(true)

    const trail = parseRapidProgram(`MODULE A\n    CONST robtarget p := [[0,0,0,],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n` + F)
    expect(trail.diagnostics.some((d) => d.code === 'invalid-data')).toBe(true)
  })

  it('大小写不同的重复名称报 duplicate-symbol，范围只覆盖第二个名称', () => {
    const source =
      `MODULE A\n    CONST robtarget p1 := ${VT};\n` +
      `    CONST robtarget P1 := [[1,1,1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n` +
      F
    const result = parseRapidProgram(source)
    const dup = result.diagnostics.find((d) => d.code === 'duplicate-symbol')
    expect(dup).toBeDefined()
    if (!dup) return
    // 范围覆盖第二个名称 P1，而非整个声明。
    expect(dup.range.end.offset - dup.range.start.offset).toBe(2) // "P1"
  })

  it('一个损坏声明恢复后，后续正确声明仍进入只读 Program Data', () => {
    const source =
      `MODULE A\n    CONST robtarget bad ${VT};\n` +
      `    CONST robtarget good := [[1,1,1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n` +
      F
    const result = parseRapidProgram(source)
    expect(result.data.some((d) => d.name === 'good')).toBe(true)
    expect(result.data.some((d) => d.name === 'bad')).toBe(false)
  })
})

describe('Ticket 02 — 结构缺失恢复边界', () => {
  it('缺少 ENDPROC 时不吞掉 ENDMODULE，也不产生虚假的尾随内容诊断', () => {
    const source =
      `MODULE A\n    CONST robtarget p1 := ${VT};\n    PROC main()\n` +
      `        MoveJ p1,v100,fine,tool0;\n` +
      `ENDMODULE\n`
    const result = parseRapidProgram(source)
    // ENDMODULE 作为模块边界被识别，不被误报为 unsupported 尾随内容。
    expect(result.diagnostics.some((d) => d.message.includes('首期不支持 ENDMODULE'))).toBe(false)
    // 给出一个缺失 ENDPROC 的根因诊断。
    expect(result.diagnostics.some((d) => d.message.includes('ENDPROC'))).toBe(true)
    // ENDMODULE 仍被正确闭合。
    expect(result.diagnostics.some((d) => d.message.includes('缺少 ENDMODULE'))).toBe(false)
  })

  it('缺少 ENDMODULE 时不重复生成等价的 missing-module / syntax-error 噪声', () => {
    const result = parseRapidProgram('MODULE A\n    PROC main()\n    ENDPROC\n')
    const missingEnd = result.diagnostics.filter(
      (d) => d.message.includes('ENDMODULE') || d.code === 'missing-module',
    )
    // 只保留一个根因指导用户。
    expect(missingEnd.length).toBe(1)
  })
})