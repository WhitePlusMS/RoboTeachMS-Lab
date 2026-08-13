import { describe, expect, it } from 'vitest'
import { isRobtargetProgramData, parseRapidProgram, type RapidProgramDataTarget } from './rapid-parser.ts'

/** 从解析结果取 robtarget 点位条目（Program Data 联合中的点位视图）。 */
function robtargets(result: ReturnType<typeof parseRapidProgram>): RapidProgramDataTarget[] {
  return result.data.filter(isRobtargetProgramData)
}

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

  it('为每个运动操作数保留精确范围，并暴露首条/中间/末尾插入锚点', () => {
    const result = parseRapidProgram(VALID_PROGRAM)
    const instruction = result.program[1]

    expect(instruction.operandRanges.target.start.line).toBe(9)
    expect(instruction.operandRanges.speed.start.line).toBe(9)
    expect(instruction.operandRanges.zone.start.line).toBe(9)
    expect(instruction.operandRanges.tool.start.line).toBe(9)
    expect(instruction.operandRanges.wobj?.start.line).toBe(9)
    expect(result.motionInsertionPoints.map((point) => point.index)).toEqual([0, 1, 2, 3])
  })

  it('非法速度诊断定位到速度操作数而不是重复出现的目标文本', () => {
    const source = `
MODULE DuplicateText
    CONST robtarget p1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,p1,fine,tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    const diagnostic = result.diagnostics.find((item) => item.message.includes('速度'))
    expect(diagnostic?.range.start.column).toBe(18)
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
    // v999/tool1/wobj1 未定义 → undefined-symbol（z20 是官方 fly-by 名，票据 04 起可执行，不再 unsupported）。
    expect(codes).toContain('undefined-symbol')
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

describe('RAPID Program Data 派生视图', () => {
  const SOURCE = `
MODULE TeachingDemo
    CONST robtarget pApproach := [[551,613,60],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PERS robtarget p_work := [[551,613,25],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];

    PROC main()
        ! MoveJ pApproach, above: a comment must not count as a reference.
        MoveJ pApproach,v100,fine,tool0;
        MoveL p_work,v50,fine,tool0\\WObj:=wobj0;
        MOVEJ papproach,v200,fine,tool0;
    ENDPROC
ENDMODULE
`

  it('按声明顺序暴露模块级命名 robtarget 的名称、存储类别与值', () => {
    const result = parseRapidProgram(SOURCE)

    expect(robtargets(result)).toHaveLength(2)
    expect(robtargets(result)[0].name).toBe('pApproach') // 保留源码原始拼写。
    expect(robtargets(result)[0].storage).toBe('const')
    expect(robtargets(result)[0].target.trans).toEqual([551, 613, 60])
    expect(robtargets(result)[0].target.rot).toEqual([1, 0, 0, 0])
    expect(robtargets(result)[0].target.robconf).toEqual([0, 0, 0, 0])
    expect(robtargets(result)[0].target.extax).toEqual([9e9, 9e9, 9e9, 9e9, 9e9, 9e9])

    expect(robtargets(result)[1].name).toBe('p_work')
    expect(robtargets(result)[1].storage).toBe('pers')
    expect(robtargets(result)[1].target.trans).toEqual([551, 613, 25])
  })

  it('声明名称范围精确定位源码名 token', () => {
    const result = parseRapidProgram(SOURCE)

    expect(robtargets(result)[0].nameRange.start.line).toBe(3)
    expect(robtargets(result)[0].nameRange.start.column).toBe(21)
    expect(robtargets(result)[0].nameRange.end.column).toBe(30) // 排他：pApproach 长 9 字符后一列。
  })

  it('同一目标被多条 MoveJ/MoveL 引用时，引用数量与每处源码范围准确', () => {
    const result = parseRapidProgram(SOURCE)

    // pApproach 被 MoveJ 第 8 行与 MOVEJ 第 10 行（大小写不同）各引用一次。
    expect(robtargets(result)[0].referenceRanges).toHaveLength(2)
    expect(robtargets(result)[0].referenceRanges[0].start.line).toBe(8)
    expect(robtargets(result)[0].referenceRanges[1].start.line).toBe(10)
    // p_work 只在第 9 行被引用一次。
    expect(robtargets(result)[1].referenceRanges).toHaveLength(1)
    expect(robtargets(result)[1].referenceRanges[0].start.line).toBe(9)
  })

  it('名称匹配遵循 RAPID 大小写不敏感规则，同时保留源码原始拼写', () => {
    const result = parseRapidProgram(SOURCE)

    // 第 8/10 行的 MoveJ 以不同大小写引用同一目标，仍归并到 pApproach。
    expect(robtargets(result)[0].referenceRanges).toHaveLength(2)
    expect(robtargets(result)[0].name).toBe('pApproach')
  })

  it('注释中的同名文本不会被误识别成目标引用', () => {
    const result = parseRapidProgram(SOURCE)

    // 第 6 行注释里的 pApproach 不产生引用。
    expect(robtargets(result)[0].referenceRanges.every((range) => range.start.line !== 6)).toBe(true)
  })

  it('源码存在 error 时仍暴露已识别数据（只读浏览），但不可执行', () => {
    const broken = `
MODULE BrokenView
    CONST robtarget pGood := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ undefinedPoint,v50,fine,tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(broken)

    expect(result.canExecute).toBe(false)
    expect(result.program).toHaveLength(0)
    // 已识别的 pGood 仍可见，供只读 Program Data 浏览。
    expect(robtargets(result)).toHaveLength(1)
    expect(robtargets(result)[0].name).toBe('pGood')
  })
})
