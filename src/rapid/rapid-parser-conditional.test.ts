import { describe, expect, it } from 'vitest'
import {
  isRapidMotionInstruction,
  parseRapidProgram,
  type RapidConditionalInstruction,
  type RapidExecutableInstruction,
} from './rapid-parser.ts'

const TARGET = (x: number) => `[[${x},0,700],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]`

const BRANCH_SOURCE = `MODULE BranchDemo
    VAR bool ready := TRUE;
    VAR num level := 2;
    VAR num count := 0;
    CONST robtarget pIf := ${TARGET(500)};
    CONST robtarget pElseIf := ${TARGET(520)};
    CONST robtarget pElse := ${TARGET(540)};
    CONST robtarget pAfter := ${TARGET(560)};
    PROC main()
        IF ready THEN
            count := 1;
            MoveJ pIf,v100,fine,tool0;
        ELSEIF level > 1 THEN
            MoveJ pElseIf,v100,fine,tool0;
        ELSE
            MoveL pElse,v100,fine,tool0;
        ENDIF
        MoveJ pAfter,v100,fine,tool0;
    ENDPROC
ENDMODULE`

function asConditional(instruction: RapidExecutableInstruction): RapidConditionalInstruction {
  if (instruction.kind !== 'if') throw new Error('测试样例应为条件指令')
  return instruction
}

describe('RAPID 非嵌套 IF/ELSEIF/ELSE 解析', () => {
  it('展平到同一执行计划，条件目标与分支退出跳转按源码顺序生成', () => {
    const result = parseRapidProgram(BRANCH_SOURCE)

    expect(result.canExecute).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.program.map((instruction) => instruction.kind)).toEqual([
      'if',
      'assign',
      'movej',
      'if',
      'movej',
      'movel',
      'movej',
    ])

    const first = asConditional(result.program[0])
    const elseif = asConditional(result.program[3])
    expect(first.conditionKind).toBe('if')
    expect(first.trueTarget).toBe(1)
    expect(first.falseTarget).toBe(3)
    expect(elseif.conditionKind).toBe('elseif')
    expect(elseif.trueTarget).toBe(4)
    expect(elseif.falseTarget).toBe(5)

    const ifMotion = result.program[2]
    const elseifMotion = result.program[4]
    const elseMotion = result.program[5]
    expect(ifMotion && isRapidMotionInstruction(ifMotion) && ifMotion.nextPointer).toBe(6)
    expect(elseifMotion && isRapidMotionInstruction(elseifMotion) && elseifMotion.nextPointer).toBe(6)
    expect(elseMotion && isRapidMotionInstruction(elseMotion) && elseMotion.nextPointer).toBe(6)
    expect(result.motionInsertionPoints.map((point) => point.index)).toEqual([2, 4, 5, 6, 7])
  })

  it('空分支和无 ELSE 分支直接跳过到 ENDIF 后的下一条可见语句', () => {
    const result = parseRapidProgram(`MODULE EmptyBranch
    VAR bool ready := TRUE;
    CONST robtarget p := ${TARGET(500)};
    PROC main()
        IF ready THEN
        ENDIF
        MoveJ p,v100,fine,tool0;
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(true)
    expect(result.program).toHaveLength(2)
    const condition = asConditional(result.program[0])
    expect(condition.trueTarget).toBe(1)
    expect(condition.falseTarget).toBe(1)
  })

  it.each([
    {
      name: '数值条件',
      body: `IF count THEN
        ENDIF`,
      code: 'invalid-data',
    },
    {
      name: '缺少 THEN',
      body: `IF ready
            MoveJ pIf,v100,fine,tool0;
        ENDIF`,
      code: 'syntax-error',
    },
    {
      name: '缺少 ENDIF',
      body: `IF ready THEN
            MoveJ pIf,v100,fine,tool0;`,
      code: 'syntax-error',
    },
    {
      name: '重复 ELSE',
      body: `IF ready THEN
        ELSE
            MoveJ pIf,v100,fine,tool0;
        ELSE
            MoveJ pElse,v100,fine,tool0;
        ENDIF`,
      code: 'syntax-error',
    },
    {
      name: '嵌套 IF',
      body: `IF ready THEN
            IF ready THEN
                MoveJ pIf,v100,fine,tool0;
            ENDIF
        ENDIF`,
      code: 'unsupported-syntax',
    },
  ])('$name 给出诊断并阻止部分执行', ({ body, code }) => {
    const result = parseRapidProgram(`MODULE BrokenBranch
    VAR bool ready := TRUE;
    VAR num count := 1;
    CONST robtarget pIf := ${TARGET(500)};
    CONST robtarget pElse := ${TARGET(540)};
    PROC main()
        ${body}
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(false)
    expect(result.program).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true)
  })

  it('ELSEIF/ELSE/ENDIF 出现在 IF 之外时按位置错误诊断', () => {
    const result = parseRapidProgram(`MODULE BrokenPosition
    VAR bool ready := TRUE;
    PROC main()
        ELSEIF ready THEN
        ELSE
        ENDIF
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(false)
    expect(result.program).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'syntax-error')).toBe(true)
  })
})
