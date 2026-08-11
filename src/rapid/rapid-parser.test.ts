import { describe, expect, it } from 'vitest'
import { parseRapidProgram } from './rapid-parser.ts'

const VALID_PROGRAM = `
MODULE TeachingDemo
    CONST robtarget p1 := [[551,613,60],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PERS robtarget p2 := [[551,613,25],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];

    PROC main()
        ! MoveL in a comment must not become an instruction.
        movej p1,v100,fine,tool0;
        MoveL p2,v50,fine,tool0\\WObj:=wobj0;
        MOVEJ p1,v200,fine,tool0;
    ENDPROC
ENDMODULE
`

describe('RAPID 文本解析模块', () => {
  it('解析大小写不敏感的最小 MODULE，并生成可执行 MoveJ/MoveL', () => {
    const result = parseRapidProgram(VALID_PROGRAM)

    expect(result.diagnostics).toEqual([])
    expect(result.program).toHaveLength(3)
    expect(result.program.map((instruction) => instruction.kind)).toEqual([
      'movej',
      'movel',
      'movej',
    ])
    expect(result.program[0].target.trans).toEqual([551, 613, 60])
    expect(result.program[1].speed.v_tcp).toBe(50)
    expect(result.program[0].zone.finep).toBe(true)
    expect(result.program[0].tool.robhold).toBe(true)
    expect(result.program[0].wobj.robhold).toBe(false)
  })

  it('保留每条运动的源码范围，便于运行时规划错误定位', () => {
    const result = parseRapidProgram(VALID_PROGRAM)

    expect(result.program[0].sourceRange.start.line).toBe(8)
    expect(result.program[0].sourceRange.start.column).toBe(9)
    expect(result.program[0].sourceText).toContain('movej p1')
  })

  it('收集未定义点位和不支持指令诊断，并阻止程序执行', () => {
    const source = `
MODULE Broken
    PROC main()
        MoveJ missingPoint,v100,fine,tool0;
        IF TRUE THEN
            MoveL missingPoint,v50,fine,tool0;
        ENDIF
    ENDPROC
ENDMODULE
`

    const result = parseRapidProgram(source)

    expect(result.canExecute).toBe(false)
    expect(result.program).toHaveLength(0)
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code)
    expect(codes).toContain('unsupported-syntax')
    expect(codes.filter((code) => code === 'undefined-symbol')).toHaveLength(2)
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true)
    const undefinedTargetDiagnostic = result.diagnostics.find(
      (diagnostic) => diagnostic.code === 'undefined-symbol',
    )
    expect(undefinedTargetDiagnostic?.range.start.line).toBe(4)
  })

  it('拒绝重复点位、错误记录长度和非默认运动参数', () => {
    const source = `
MODULE InvalidData
    CONST robtarget bad := [[0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget p1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PERS robtarget P1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,v999,z20,tool1\\WObj:=wobj1;
    ENDPROC
ENDMODULE
`

    const result = parseRapidProgram(source)
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code)

    expect(result.canExecute).toBe(false)
    expect(codes).toContain('duplicate-symbol')
    expect(codes).toContain('invalid-data')
    expect(codes).toContain('unsupported-option')
  })

  it('要求唯一的无参数 main 入口', () => {
    const result = parseRapidProgram(`MODULE Empty ENDMODULE`)

    expect(result.canExecute).toBe(false)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'missing-entrypoint' }),
    ])
  })

  it('拒绝 ENDMODULE 后的尾随内容，避免静默忽略源程序', () => {
    const result = parseRapidProgram(`MODULE Empty ENDMODULE MoveJ p1,v50,fine,tool0;`)

    expect(result.canExecute).toBe(false)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unsupported-syntax' }),
        expect.objectContaining({ code: 'missing-entrypoint' }),
      ]),
    )
  })

  it('拒绝 robtarget tuple 的尾逗号', () => {
    const result = parseRapidProgram(`
MODULE TrailingComma
    CONST robtarget p1 := [[0,0,0,],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,v50,fine,tool0;
    ENDPROC
ENDMODULE
`)

    expect(result.canExecute).toBe(false)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-data' }),
      ]),
    )
  })
})
