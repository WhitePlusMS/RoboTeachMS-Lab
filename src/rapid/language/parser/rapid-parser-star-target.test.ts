import { describe, expect, it } from 'vitest'
import { parseRapidProgram } from './rapid-parser.ts'
import { MAIN_MODULE_CLOSING, MODULE_WITH_P1_MAIN_PREFIX } from './rapid-parser-test-fixtures.ts'

function parseMotionFixture(source: string) {
  return parseRapidProgram(MODULE_WITH_P1_MAIN_PREFIX + source + MAIN_MODULE_CLOSING)
}

describe('FlexPendant 式 `*` 未示教目标占位', () => {
  it('MoveL *,v1000,z50,tool0; 产生 missing-target error 且程序不可执行', () => {
    const result = parseMotionFixture('        MoveL *,v1000,z50,tool0;\n')
    const missing = result.diagnostics.filter((d) => d.code === 'missing-target')
    expect(missing).toHaveLength(1)
    expect(missing[0].severity).toBe('error')
    expect(missing[0].message).toContain('未示教')
    expect(result.canExecute).toBe(false)
    // 有 error 时 program 保持既有契约：为空。
    expect(result.program).toHaveLength(0)
  })

  it('`*` 指令仍进入 instructions 视图，操作数与源码范围精确', () => {
    const source = '        MoveL *,v1000,z50,tool0;\n'
    const result = parseMotionFixture(source)
    expect(result.instructions).toHaveLength(1)
    const instruction = result.instructions[0]
    expect(instruction.kind).toBe('movel')
    if (instruction.kind !== 'movel') throw new Error('unexpected')
    expect(instruction.operands.target).toBe('*')
    expect(instruction.operands.speed).toBe('v1000')
    expect(instruction.operands.zone).toBe('z50')
    // operandRanges.target 恰好覆盖 `*` 字符本身。
    const prefix = MODULE_WITH_P1_MAIN_PREFIX
    const starOffset = (prefix + source).indexOf('*')
    expect(instruction.operandRanges.target.start.offset).toBe(starOffset)
    expect(instruction.operandRanges.target.end.offset).toBe(starOffset + 1)
    expect(instruction.sourceText).toBe('MoveL *,v1000,z50,tool0;')
  })

  it('`*` 不产生任何符号引用（不污染点位引用数）', () => {
    const result = parseMotionFixture('        MoveL *,v1000,z50,tool0;\n        MoveJ p1,v100,fine,tool0;\n')
    // p1 只被第二条 MoveJ 引用一次；`*` 不算引用。
    const p1 = result.data.find((d) => d.name === 'p1')
    expect(p1?.referenceRanges).toHaveLength(1)
    // 两条指令都进入 instructions。
    expect(result.instructions).toHaveLength(2)
  })

  it('速度/转弯区槽位的 `*` 仍是语法错误（占位只允许目标点）', () => {
    const result = parseMotionFixture('        MoveJ p1,*,fine,tool0;\n')
    expect(result.diagnostics.some((d) => d.code === 'missing-target')).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 'syntax-error')).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('可执行程序的 instructions 与 program 内容一致', () => {
    const result = parseMotionFixture('        MoveJ p1,v100,fine,tool0;\n')
    expect(result.canExecute).toBe(true)
    expect(result.instructions).toHaveLength(1)
    expect(result.instructions[0]).toBe(result.program[0])
  })
})
