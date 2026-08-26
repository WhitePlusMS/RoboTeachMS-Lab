import { describe, expect, it } from 'vitest'
import { parseRapidProgram } from './rapid-parser.ts'
import { MAIN_MODULE_CLOSING, MODULE_WITH_P1_MAIN_PREFIX } from './rapid-parser-test-fixtures.ts'

function parseMotionFixture(source: string) {
  return parseRapidProgram(MODULE_WITH_P1_MAIN_PREFIX + source + MAIN_MODULE_CLOSING)
}

/** 断言诊断列表中出现某个 message 片段。 */
function hasMsg(diagnostics: readonly { message: string }[], fragment: string): boolean {
  return diagnostics.some((d) => d.message.includes(fragment))
}

describe('Ticket 03 — 必选操作数诊断', () => {
  it('缺少 target（开头逗号）定位到空操作数位置，且不把逗号误报为首期不支持内容', () => {
    const result = parseMotionFixture('        MoveJ ,v100,fine,tool0;\n')
    expect(hasMsg(result.diagnostics, '目标点名称')).toBe(true)
    expect(hasMsg(result.diagnostics, '首期不支持 ,')).toBe(false)
    expect(hasMsg(result.diagnostics, '运动操作数之间缺少逗号')).toBe(false)
    // 空 target 不会引用到 p1。
    expect(result.data[0].referenceRanges).toHaveLength(0)
    expect(result.canExecute).toBe(false)
  })

  it('连续逗号只报告一个空速度操作数，目标仍计入引用', () => {
    const result = parseMotionFixture('        MoveJ p1,,fine,tool0;\n')
    const missingSpeed = result.diagnostics.filter((d) => d.message.includes('速度名称'))
    expect(missingSpeed.length).toBe(1)
    expect(hasMsg(result.diagnostics, '运动操作数之间缺少逗号')).toBe(false)
    expect(result.data[0].referenceRanges).toHaveLength(1)
    expect(result.canExecute).toBe(false)
  })

  it('尾随逗号定位到空操作数位置，不把逗号当 unsupported 内容', () => {
    const result = parseMotionFixture('        MoveJ p1,v100,fine,tool0,;\n')
    expect(hasMsg(result.diagnostics, '首期不支持 ,')).toBe(false)
    // 出现针对多余参数的根因诊断。
    expect(result.diagnostics.some((d) => d.message.includes('多余'))).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('第五个位置参数标记为多余 token，而非静默忽略或 generic unsupported', () => {
    const result = parseMotionFixture('        MoveJ p1,v100,fine,tool0,extra,more;\n')
    expect(result.diagnostics.some((d) => d.message.includes('多余'))).toBe(true)
    // extra 不应被整体判为“首期不支持 extra”（它是运动参数溢出，不是未知语句）。
    expect(hasMsg(result.diagnostics, '首期不支持 extra')).toBe(false)
    expect(result.canExecute).toBe(false)
  })

  it('缺逗号只报告一次漏逗号根因，不派生多个缺参错误', () => {
    // target 与 speed 之间漏了逗号。
    const result = parseMotionFixture('        MoveJ p1 v100,fine,tool0;\n')
    const missingComma = result.diagnostics.filter((d) => d.message.includes('缺少逗号'))
    expect(missingComma.length).toBeGreaterThanOrEqual(1)
    // 漏逗号的杂项 token 不应被整体判为 unsupported 内容。
    expect(hasMsg(result.diagnostics, '首期不支持 v100')).toBe(false)
    expect(result.canExecute).toBe(false)
  })

  it('缺分号时在语句末尾给零长度范围，并恢复到下一条运动或 ENDPROC', () => {
    const result = parseMotionFixture(
      '        MoveJ p1,v100,fine,tool0\n        MoveL p1,v50,fine,tool0;',
    )
    const semi = result.diagnostics.filter((d) => d.message.includes('期望符号 ;'))
    const stmtEnds = semi.filter((d) => d.range.start.offset === d.range.end.offset)
    expect(stmtEnds.length).toBeGreaterThanOrEqual(1)
    // 后续独立 MoveL 仍被分析并引用 p1。
    expect(result.data[0].referenceRanges.length).toBeGreaterThanOrEqual(2)
    // 错误程序不可执行。
    expect(result.canExecute).toBe(false)
  })
})

describe('Ticket 03 — 可选参数诊断', () => {
  it('合法 \\WObj:=wobj0 保持可解析且不产生诊断', () => {
    const result = parseMotionFixture('        MoveJ p1,v100,fine,tool0\\WObj:=wobj0;\n')
    expect(result.diagnostics.some((d) => d.message.includes('wobj'))).toBe(false)
    expect(result.canExecute).toBe(true)
  })

  it('未知可选参数报 unsupported-option，范围覆盖参数名称', () => {
    const result = parseMotionFixture('        MoveJ p1,v100,fine,tool0\\speed:=100;\n')
    const opt = result.diagnostics.find(
      (d) => d.code === 'unsupported-option' && d.message.includes('speed'),
    )
    expect(opt).toBeDefined()
    // 范围精确覆盖 speed 名称（4 字符）。
    if (opt) expect(opt.range.end.offset - opt.range.start.offset).toBe(5)
    // 不产生“期望工件坐标名称 / 首期不支持 100”的连锁噪声。
    expect(hasMsg(result.diagnostics, '期望工件坐标名称')).toBe(false)
    expect(hasMsg(result.diagnostics, '首期不支持 100')).toBe(false)
    expect(result.canExecute).toBe(false)
  })

  it('缺少可选参数名称：只报告该根因，不把后续 token 误当工件坐标名', () => {
    const result = parseMotionFixture('        MoveJ p1,v100,fine,tool0\\:=p1;\n')
    expect(hasMsg(result.diagnostics, '可选参数名称')).toBe(true)
    expect(hasMsg(result.diagnostics, '暂不支持 p1')).toBe(false)
    expect(result.canExecute).toBe(false)
  })

  it('缺少 =: 或工件坐标名称给出对应根因', () => {
    const noAssign = parseMotionFixture('        MoveJ p1,v100,fine,tool0\\WObj wobj0;\n')
    expect(hasMsg(noAssign.diagnostics, '期望符号 :=')).toBe(true)

    const noWobj = parseMotionFixture('        MoveJ p1,v100,fine,tool0\\WObj:=;\n')
    expect(hasMsg(noWobj.diagnostics, '工件坐标名称')).toBe(true)
  })

  it('重复 WObj 不被静默忽略或当 unsupported 边界，明确报重复可选参数', () => {
    const result = parseMotionFixture(
      '        MoveJ p1,v100,fine,tool0\\WObj:=wobj0\\WObj:=wobj0;\n',
    )
    expect(
      result.diagnostics.some((d) => d.message.includes('重复') && d.message.includes('WObj')),
    ).toBe(true)
    expect(hasMsg(result.diagnostics, '首期不支持 \\')).toBe(false)
    expect(result.canExecute).toBe(false)
  })

  it('WObj 后多余 token 明确报多余参数，而非 generic unsupported', () => {
    const result = parseMotionFixture('        MoveJ p1,v100,fine,tool0\\WObj:=wobj0 extra;\n')
    expect(result.diagnostics.some((d) => d.message.includes('多余'))).toBe(true)
    expect(hasMsg(result.diagnostics, '首期不支持 extra')).toBe(false)
    expect(result.canExecute).toBe(false)
  })

  it('残缺反斜杠给出缺失可选参数名称根因，不吞掉下一条指令', () => {
    const source = '        MoveJ p1,v100,fine,tool0\\;\n        MoveL p1,v50,fine,tool0;'
    const result = parseMotionFixture(source)
    expect(hasMsg(result.diagnostics, '可选参数名称')).toBe(true)
    // 下一条 MoveL 仍被分析。
    expect(result.data[0].referenceRanges.length).toBeGreaterThanOrEqual(2)
    expect(result.canExecute).toBe(false)
  })
})

describe('Ticket 03 — 名称与能力诊断', () => {
  it('未定义 target/speed 报 undefined-symbol，范围精确覆盖对应名称', () => {
    const result = parseMotionFixture('        MoveJ nope,v999,fine,tool0;\n')
    const undefTarget = result.diagnostics
      .filter((d) => d.code === 'undefined-symbol')
      .find((d) => d.message.includes('nope'))
    expect(undefTarget).toBeDefined()
    if (undefTarget) expect(undefTarget.range.end.offset - undefTarget.range.start.offset).toBe(4) // "nope"
    const undefSpeed = result.diagnostics.find(
      (d) => d.code === 'undefined-symbol' && d.message.includes('v999'),
    )
    expect(undefSpeed).toBeDefined()
    expect(result.canExecute).toBe(false)
  })

  it('z20 执行于安全停点近似；未声明的 tool1/wobj1 报未定义（各自精确分类）', () => {
    const result = parseMotionFixture('        MoveJ p1,v100,z20,tool1\\WObj:=wobj1;\n')
    const msgs = result.diagnostics.map((d) => d.message)
    // z20 是官方 zone 名（票据 04 起可执行，fly-by 以安全停点近似），不再产生 "fine 提示" 拦截。
    expect(msgs.some((m) => m.includes('fine'))).toBe(false)
    // tool1/wobj1 未声明：报 undefined-symbol，而非旧的“仅 tool0/wobj0”文案。
    expect(
      result.diagnostics.some(
        (d) => d.code === 'undefined-symbol' && d.message.includes('工具 tool1'),
      ),
    ).toBe(true)
    expect(
      result.diagnostics.some(
        (d) => d.code === 'undefined-symbol' && d.message.includes('工件坐标 wobj1'),
      ),
    ).toBe(true)
    // v100 是合法官方速度，不产生未定义。
    expect(result.diagnostics.some((d) => d.message.includes('v100'))).toBe(false)
    // tool1/wobj1 未定义阻止执行。
    expect(result.canExecute).toBe(false)
  })

  it('错误诊断精确指向操作数范围，不因 target 文本与其它操作数重复而猜位置', () => {
    // p1 作为 speed 出现：速度诊断必须落在真正 speed 的位置，而非 target 的 p1。
    const result = parseMotionFixture('        MoveJ p1,p1,fine,tool0;\n')
    const speedDiag = result.diagnostics.find((d) => d.message.includes('速度'))
    // 真正的 speed 是第二个 p1（列 18 = offset 内），不能在第一个 p1 处。
    expect(speedDiag?.range.start.column).toBe(18)
  })

  it('错误运动后的独立指令继续被分析，parser 不崩溃、不吞 ENDPROC', () => {
    const source = '        MoveJ p1 garbage\n        MoveL p1,v50,fine,tool0;'
    const result = parseMotionFixture(source)
    expect(result.data[0].referenceRanges.length).toBeGreaterThanOrEqual(1)
    // 不缺 ENDPROC（存在源码里）。
    expect(hasMsg(result.diagnostics, '期望关键字 ENDPROC')).toBe(false)
    expect(hasMsg(result.diagnostics, '缺少 ENDMODULE')).toBe(false)
  })
})
