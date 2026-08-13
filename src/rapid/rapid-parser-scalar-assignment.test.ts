import { describe, expect, it } from 'vitest'
import {
  isRapidMotionInstruction,
  parseRapidProgram,
  type RapidAssignmentInstruction,
  type RapidExecutableInstruction,
} from './rapid-parser.ts'

const ROBTARGET = '[[500,100,700],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]'

function asAssignment(instruction: RapidExecutableInstruction): RapidAssignmentInstruction {
  if (instruction.kind !== 'assign') throw new Error('测试样例应为赋值指令')
  return instruction
}

describe('RAPID num/bool 赋值解析', () => {
  it('按源码顺序解析赋值与运动，并保留表达式优先级和变量初值', () => {
    const result = parseRapidProgram(`MODULE Demo
    VAR num count := 1;
    VAR bool ready := FALSE;
    CONST robtarget p := ${ROBTARGET};
    PROC main()
        count := (count + 2) * 3 - 1;
        ready := count >= 8 AND NOT FALSE;
        count := count-1;
        MoveJ p,v100,fine,tool0;
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.program).toHaveLength(4)
    expect(result.program.map((instruction) => instruction.kind)).toEqual([
      'assign',
      'assign',
      'assign',
      'movej',
    ])

    const first = asAssignment(result.program[0])
    const second = asAssignment(result.program[1])
    const third = asAssignment(result.program[2])
    expect(first.target).toMatchObject({ name: 'count', valueKind: 'num' })
    expect(first.expression.kind).toBe('binary')
    if (first.expression.kind === 'binary') {
      expect(first.expression.operator).toBe('-')
      expect(first.expression.left.kind).toBe('binary')
      if (first.expression.left.kind === 'binary') expect(first.expression.left.operator).toBe('*')
    }
    expect(second.target).toMatchObject({ name: 'ready', valueKind: 'bool' })
    expect(second.expression.kind).toBe('binary')
    expect(third.sourceText).toContain('count-1')

    const scalars = result.data.filter((entry) => entry.kind === 'num' || entry.kind === 'bool')
    expect(scalars).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'num', name: 'count', value: 1, storage: 'var' }),
      expect.objectContaining({ kind: 'bool', name: 'ready', value: false, storage: 'var' }),
    ]))
    expect(result.motionInsertionPoints.map((point) => point.index)).toEqual([3, 4])
    const motion = result.program[3]
    expect(motion && isRapidMotionInstruction(motion)).toBe(true)
  })

  it('支持大小写不敏感的变量名与逻辑运算符，并允许声明位于 main 之后', () => {
    const result = parseRapidProgram(`MODULE Demo
    PROC main()
        READY := TRUE oR FALSE aNd NOT FALSE;
        COUNT := COUNT + 1;
    ENDPROC
    VAR num count := 2;
    VAR bool ready := FALSE;
ENDMODULE`)

    expect(result.canExecute).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.program).toHaveLength(2)
    expect(asAssignment(result.program[0]).target.valueKind).toBe('bool')
    expect(asAssignment(result.program[1]).target.valueKind).toBe('num')
  })

  it.each([
    {
      name: '未定义变量',
      source: `MODULE Demo
    VAR num count := 1;
    PROC main()
        count := missing + 1;
    ENDPROC
ENDMODULE`,
      code: 'undefined-symbol',
    },
    {
      name: '类型不匹配',
      source: `MODULE Demo
    VAR num count := 1;
    VAR bool ready := FALSE;
    PROC main()
        count := ready + 1;
    ENDPROC
ENDMODULE`,
      code: 'invalid-data',
    },
    {
      name: '非 VAR 目标',
      source: `MODULE Demo
    CONST num count := 1;
    PROC main()
        count := 2;
    ENDPROC
ENDMODULE`,
      code: 'unsupported-option',
    },
  ])('$name 诊断会阻止生成部分程序', ({ source, code }) => {
    const result = parseRapidProgram(source)
    expect(result.canExecute).toBe(false)
    expect(result.program).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true)
  })

  it('缺少表达式分号时只保留诊断，不生成半条赋值指令', () => {
    const result = parseRapidProgram(`MODULE Demo
    VAR num count := 1;
    PROC main()
        count := count + ;
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(false)
    expect(result.program).toEqual([])
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'syntax-error')).toBe(true)
  })
})
