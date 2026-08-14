import { describe, expect, it } from 'vitest'
import {
  isRapidMotionInstruction,
  parseRapidProgram,
  type RapidExecutableInstruction,
  type RapidForInstruction,
  type RapidWhileInstruction,
} from './rapid-parser.ts'

const TARGET = (x: number) => `[[${x},0,700],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]`

function asWhile(instruction: RapidExecutableInstruction): RapidWhileInstruction {
  if (instruction.kind !== 'while') throw new Error('测试样例应为 while 指令')
  return instruction
}

function asFor(instruction: RapidExecutableInstruction): RapidForInstruction {
  if (instruction.kind !== 'for') throw new Error('测试样例应为 for 指令')
  return instruction
}

describe('RAPID WHILE 循环解析', () => {
  it('展平循环头与循环体，循环体末条回跳循环头', () => {
    const result = parseRapidProgram(`MODULE L
    VAR num i := 0;
    CONST robtarget pA := ${TARGET(1)};
    CONST robtarget pB := ${TARGET(2)};
    PROC main()
        WHILE i < 3 DO
            i := i + 1;
            MoveJ pA,v100,fine,tool0;
        ENDWHILE
        MoveJ pB,v100,fine,tool0;
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.program.map((instruction) => instruction.kind)).toEqual([
      'while',
      'assign',
      'movej',
      'movej',
    ])

    const head = asWhile(result.program[0])
    expect(head.trueTarget).toBe(1) // 进入循环体
    expect(head.falseTarget).toBe(3) // 退出到 MoveJ pB
    // 循环体末条 (MoveJ pA) 回跳循环头
    const bodyMotion = result.program[2]
    expect(bodyMotion && isRapidMotionInstruction(bodyMotion) && bodyMotion.nextPointer).toBe(0)
  })

  it('WHILE 条件必须是 bool', () => {
    const result = parseRapidProgram(`MODULE L
    VAR num i := 0;
    CONST robtarget pA := ${TARGET(1)};
    PROC main()
        WHILE i DO
            i := i + 1;
        ENDWHILE
    ENDPROC
ENDMODULE`)
    expect(result.canExecute).toBe(false)
    expect(result.diagnostics.some((item) => item.code === 'invalid-data')).toBe(true)
  })
})

describe('RAPID FOR 循环解析', () => {
  it('解析 FOR 循环变量、FROM/TO/STEP 与循环体', () => {
    const result = parseRapidProgram(`MODULE L
    VAR num i := 0;
    CONST robtarget pA := ${TARGET(1)};
    PROC main()
        FOR i FROM 1 TO 5 STEP 2 DO
            MoveJ pA,v100,fine,tool0;
        ENDFOR
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.program.map((instruction) => instruction.kind)).toEqual(['for', 'movej'])

    const head = asFor(result.program[0])
    expect(head.loopVar.name).toBe('i')
    expect(head.fromExpr.kind).toBe('num-literal')
    expect(head.stepExpr).not.toBeNull()
    expect(head.trueTarget).toBe(1)
    expect(head.falseTarget).toBe(2)
  })

  it('省略 STEP 时步长为空（默认按 1 处理）', () => {
    const result = parseRapidProgram(`MODULE L
    VAR num i := 0;
    PROC main()
        FOR i FROM 1 TO 3 DO
        ENDFOR
    ENDPROC
ENDMODULE`)
    const head = asFor(result.program[0])
    expect(head.stepExpr).toBeNull()
  })
})

describe('RAPID 嵌套条件与嵌套循环解析', () => {
  it('WHILE 循环体内容纳嵌套 IF', () => {
    const result = parseRapidProgram(`MODULE L
    VAR num i := 0;
    CONST robtarget pA := ${TARGET(1)};
    PROC main()
        WHILE i < 3 DO
            IF i = 2 THEN
                i := i + 1;
            ENDIF
            i := i + 1;
        ENDWHILE
    ENDPROC
ENDMODULE`)
    expect(result.canExecute).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.program.map((instruction) => instruction.kind)).toEqual([
      'while',
      'if',
      'assign',
      'assign',
    ])
  })

  it('FOR 循环体内可以嵌套另一个 FOR（双重循环）', () => {
    const result = parseRapidProgram(`MODULE L
    VAR num i := 0;
    VAR num j := 0;
    PROC main()
        FOR i FROM 1 TO 3 DO
            FOR j FROM 1 TO 2 DO
            ENDFOR
        ENDFOR
    ENDPROC
ENDMODULE`)
    expect(result.canExecute).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.program.map((instruction) => instruction.kind)).toEqual(['for', 'for'])
  })
})

describe('RAPID EXITDO 解析', () => {
  it('EXITDO 在循环体内展平为循环退出目标', () => {
    const result = parseRapidProgram(`MODULE L
    VAR num i := 0;
    CONST robtarget pA := ${TARGET(1)};
    PROC main()
        WHILE i < 10 DO
            i := i + 1;
            IF i >= 5 THEN
                EXITDO;
            ENDIF
        ENDWHILE
        MoveJ pA,v100,fine,tool0;
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(true)
    expect(result.diagnostics).toEqual([])
    const exitdo = result.program.find((instruction) => instruction.kind === 'exitdo')
    expect(exitdo && exitdo.kind === 'exitdo').toBe(true)
    if (exitdo && exitdo.kind === 'exitdo') {
      // 退出到 WHILE 之后的下一条（MoveJ pA）
      expect(exitdo.target).toBe(4)
    }
  })

  it('EXITDO 出现在循环体外时按位置错误诊断并阻止执行', () => {
    const result = parseRapidProgram(`MODULE L
    CONST robtarget pA := ${TARGET(1)};
    PROC main()
        EXITDO;
        MoveJ pA,v100,fine,tool0;
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(false)
    expect(result.diagnostics.some((item) => item.code === 'syntax-error')).toBe(true)
    expect(result.program.some((instruction) => instruction.kind === 'exitdo')).toBe(false)
  })

  it('嵌套循环内 EXITDO 只退出最近一层内循环，不跳出外层循环', () => {
    const result = parseRapidProgram(`MODULE L
    VAR num i := 0;
    VAR num j := 0;
    CONST robtarget pA := ${TARGET(1)};
    PROC main()
        WHILE i < 100 DO
            i := i + 1;
            WHILE j < 100 DO
                j := j + 1;
                EXITDO;
            ENDWHILE
            i := i + 10;
        ENDWHILE
        MoveJ pA,v100,fine,tool0;
    ENDPROC
ENDMODULE`)

    expect(result.canExecute).toBe(true)
    expect(result.diagnostics).toEqual([])
    const exitdo = result.program.find((instruction) => instruction.kind === 'exitdo')
    expect(exitdo && exitdo.kind === 'exitdo').toBe(true)
    if (exitdo && exitdo.kind === 'exitdo') {
      // 内层 EXITDO 应退到内层 WHILE 之后（i := i+10，仍在外层循环体内），而非跳出外层到 MoveJ。
      // program: while(0) assign(1) while(2) assign(3) exitdo(4) assign(5) movej(6)
      expect(exitdo.target).toBe(5)
    }
  })
})
