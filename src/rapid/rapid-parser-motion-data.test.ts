import { describe, expect, it } from 'vitest'
import { isRapidMotionInstruction, parseRapidProgram } from './rapid-parser.ts'
import { isDefaultTool0, isDefaultWobj0 } from './rapid-types.ts'

/**
 * Ticket 01 — 统一 RAPID 运动数据与系统符号基础。
 * 验证五类 ABB record 解析、存储规则、系统预定义符号、wobj0.ufprog 与重定义/未定义诊断。
 */

const RT = '[[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]'

/** 最小可执行 main + 声明片段：在 {body} 前插入模块级声明。 */
function program(decls: string, body = ''): string {
  return `MODULE T\n${decls}\n    PROC main()\n${body}    ENDPROC\nENDMODULE\n`
}

describe('Ticket 01 — 五类 ABB record 解析为领域类型', () => {
  it('tooldata：结构、负载与源码范围', () => {
    const src = program('    PERS tooldata tGripper := [TRUE,[[0,0,184],[1,0,0,0]],[0.5,[0,0,92],[1,0,0,0],1,2,3]];')
    const result = parseRapidProgram(src)
    const entry = result.data.find((d) => d.name === 'tGripper')
    expect(entry?.kind).toBe('tooldata')
    if (entry?.kind !== 'tooldata') return
    expect(entry.value.robhold).toBe(true)
    expect(entry.value.tframe.trans).toEqual([0, 0, 184])
    expect(entry.value.tload.mass).toBe(0.5)
    expect(entry.value.tload.cog).toEqual([0, 0, 92])
    expect(entry.value.tload.ix).toBe(1)
    expect(entry.storage).toBe('pers')
    expect(entry.system).toBe(false)
    // 值字面量范围覆盖由 `[` 开头。
    expect(src.slice(entry.valueRange.start.offset)).toContain('[TRUE')
  })

  it('wobjdata：固定用户坐标系（ufprog）与 frame 平移/旋转', () => {
    const src = program('    PERS wobjdata wTable := [FALSE,TRUE,"",[[100,0,0],[1,0,0,0]],[[0,0,0],[1,0,0,0]]];')
    const result = parseRapidProgram(src)
    const entry = result.data.find((d) => d.name === 'wTable')
    expect(entry?.kind).toBe('wobjdata')
    if (entry?.kind !== 'wobjdata') return
    expect(entry.value.robhold).toBe(false)
    expect(entry.value.ufprog).toBe(true)
    expect(entry.value.ufmec).toBe('')
    expect(entry.value.uframe.trans).toEqual([100, 0, 0])
  })

  it('loaddata、speeddata、zonedata 解析为各自领域类型且字段完整', () => {
    const src = program([
      '    PERS loaddata ld := [1.5,[0,0,50],[1,0,0,0],0,0,0];',
      '    VAR speeddata vs := [250,300,4000,800];',
      '    CONST zonedata zc := [FALSE,5,8,8,0.8,8,0.8];',
    ].join('\n'))
    const result = parseRapidProgram(src)
    expect(result.data.find((d) => d.name === 'ld')?.kind).toBe('loaddata')
    expect(result.data.find((d) => d.name === 'vs')?.kind).toBe('speeddata')
    const zone = result.data.find((d) => d.name === 'zc')
    expect(zone?.kind).toBe('zonedata')
    if (zone?.kind !== 'zonedata') return
    expect(zone.value.finep).toBe(false)
    expect(zone.value.pzoneTcp).toBe(5)
    expect(zone.value.zoneOri).toBe(0.8)
  })

  it('存储规则：tooldata/wobjdata/loaddata 必须 PERS；robtarget 不支持 VAR；speed/zone 允许 VAR/CONST', () => {
    // CONST tooldata 违反 PERS 规则 → invalid-data。
    const badTool = parseRapidProgram(program('    CONST tooldata t := [TRUE,[[0,0,0],[1,0,0,0]],[0,[0,0,0],[1,0,0,0],0,0,0]];'))
    expect(badTool.diagnostics.some((d) => d.code === 'invalid-data' && d.message.includes('PERS'))).toBe(true)

    // VAR robtarget 不允许 → invalid-data。
    const badRob = parseRapidProgram(program(`    VAR robtarget p := ${RT};`))
    expect(badRob.diagnostics.some((d) => d.code === 'invalid-data' && d.message.includes('VAR'))).toBe(true)

    // VAR speeddata 允许 → 无非法存储诊断。
    const okSpeed = parseRapidProgram(program('    VAR speeddata vs := [10,100,1000,100];'))
    expect(okSpeed.diagnostics.some((d) => d.code === 'invalid-data')).toBe(false)
  })

  it('畸形 record（字段数/类型/数值）给出精确 invalid-data 诊断，不生成半合法条目', () => {
    const src = program('    PERS tooldata t := [TRUE,[[0,0],[1,0,0,0]],[0,[0,0,0],[1,0,0,0],0,0,0]];')
    const result = parseRapidProgram(src)
    expect(result.diagnostics.some((d) => d.code === 'invalid-data')).toBe(true)
    expect(result.data.some((d) => d.name === 't')).toBe(false)
  })

  it('speeddata/zonedata 中间字段错误只保留一个 invalid-data 根因', () => {
    const speed = parseRapidProgram(program('    CONST speeddata fast := [100,broken,100,100];'))
    expect(speed.diagnostics).toHaveLength(1)
    expect(speed.diagnostics[0]?.code).toBe('invalid-data')
    expect(speed.data.some((entry) => entry.name === 'fast')).toBe(false)

    const zone = parseRapidProgram(program('    CONST zonedata brokenZone := [FALSE,5,8,broken,0.8,8,0.8];'))
    expect(zone.diagnostics).toHaveLength(1)
    expect(zone.diagnostics[0]?.code).toBe('invalid-data')
    expect(zone.data.some((entry) => entry.name === 'brokenZone')).toBe(false)
  })

  it('非归一化四元数（robtarget.rot / 框架 rot / aom）给出 invalid-data 精确诊断', () => {
    // robtarget.rot 长度 2 而非 1：应被诊断并且不进入 Program Data（票据 01 验收）。
    const rt = program('    CONST robtarget p := [[0,0,0],[2,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];')
    const rtResult = parseRapidProgram(rt)
    expect(rtResult.diagnostics.some((d) => d.code === 'invalid-data' && d.message.includes('未归一化'))).toBe(true)
    expect(rtResult.canExecute).toBe(false)

    // wobj 框架 uframe.rot 非单位。
    const wobj = program('    PERS wobjdata w := [FALSE,TRUE,"",[[0,0,0],[0,2,0,0]],[[0,0,0],[1,0,0,0]]];')
    const wobjResult = parseRapidProgram(wobj)
    expect(wobjResult.diagnostics.some((d) => d.code === 'invalid-data' && d.message.includes('未归一化'))).toBe(true)

    // load 的 aom 非单位。
    const load = program('    PERS loaddata ld := [1,[0,0,0],[3,0,0,0],0,0,0];')
    const loadResult = parseRapidProgram(load)
    expect(loadResult.diagnostics.some((d) => d.code === 'invalid-data' && d.message.includes('未归一化'))).toBe(true)
  })
})

describe('Ticket 01 — 模块级 VAR 标量 Program Data', () => {
  it('解析大小写不敏感的 num/bool 初值，并保留声明元数据', () => {
    const src = program([
      '    VAR num cycleCount := -1.25e2;',
      '    VAR bool Ready := tRuE;',
      '    CONST robtarget p1 := ' + RT + ';',
    ].join('\n'), '        MoveJ p1,v100,fine,tool0;\n')
    const result = parseRapidProgram(src)

    expect(result.diagnostics).toEqual([])
    expect(result.canExecute).toBe(true)
    expect(result.program).toHaveLength(1)

    const count = result.data.find((entry) => entry.name === 'cycleCount')
    expect(count).toMatchObject({ kind: 'num', storage: 'var', system: false, value: -125 })
    expect(count && src.slice(count.valueRange.start.offset, count.valueRange.end.offset)).toBe('-1.25e2')

    const ready = result.data.find((entry) => entry.name === 'Ready')
    expect(ready).toMatchObject({ kind: 'bool', storage: 'var', system: false, value: true })
  })

  it('缺少初值、初值类型错误和非有限数值均阻止执行且不生成半合法条目', () => {
    const missing = parseRapidProgram(program('    VAR num count;'))
    expect(missing.canExecute).toBe(false)
    expect(
      missing.diagnostics.some((diagnostic) => diagnostic.message.includes(':=')),
    ).toBe(true)
    expect(missing.data.some((entry) => entry.name === 'count')).toBe(false)

    const wrongType = parseRapidProgram(program('    VAR bool ready := 1;'))
    expect(wrongType.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-data')).toBe(true)
    expect(wrongType.data.some((entry) => entry.name === 'ready')).toBe(false)

    const nonFinite = parseRapidProgram(program('    VAR num count := 1e999;'))
    expect(nonFinite.diagnostics.some((diagnostic) => diagnostic.message.includes('非有限'))).toBe(true)
    expect(nonFinite.data.some((entry) => entry.name === 'count')).toBe(false)
  })

  it('标量只能使用 VAR，且与六类运动数据共享大小写不敏感的符号空间', () => {
    const unsupportedStorage = parseRapidProgram(program('    CONST num count := 1;'))
    expect(unsupportedStorage.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-option')).toBe(true)

    const duplicate = parseRapidProgram(program([
      '    CONST robtarget p1 := ' + RT + ';',
      '    VAR bool P1 := FALSE;',
    ].join('\n')))
    expect(duplicate.diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-symbol')).toBe(true)
    expect(duplicate.diagnostics.find((diagnostic) => diagnostic.code === 'duplicate-symbol')?.range.start.line).toBe(3)

    const local = parseRapidProgram(`MODULE T\n    PROC main()\n        VAR num localCount := 1;\n    ENDPROC\nENDMODULE\n`)
    expect(local.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-syntax')).toBe(true)
    expect(local.data.some((entry) => entry.name === 'localCount')).toBe(false)
  })
})

describe('Ticket 01 — 系统预定义符号', () => {
  it('tool0/wobj0/load0 与官方 speed/zone 名称进入只读 Program Data', () => {
    const result = parseRapidProgram(program(''))
    expect(result.data.some((d) => d.name === 'tool0' && d.system && d.kind === 'tooldata')).toBe(true)
    expect(result.data.some((d) => d.name === 'wobj0' && d.system && d.kind === 'wobjdata')).toBe(true)
    expect(result.data.some((d) => d.name === 'load0' && d.system)).toBe(true)
    expect(result.data.some((d) => d.name === 'v100' && d.system && d.kind === 'speeddata')).toBe(true)
    expect(result.data.some((d) => d.name === 'z50' && d.system && d.kind === 'zonedata')).toBe(true)
  })

  it('wobj0.ufprog 为 TRUE（ABB 官方默认固定用户坐标）', () => {
    const wobj0 = parseRapidProgram(program('')).data.find((d) => d.name === 'wobj0')
    if (wobj0?.kind !== 'wobjdata') throw new Error('wobj0 应为 wobjdata')
    expect(wobj0.value.ufprog).toBe(true)
    // 默认程序仍判为默认 wobj0 / 默认 tool0。
    expect(isDefaultWobj0(wobj0.value)).toBe(true)
    const tool0 = parseRapidProgram(program('')).data.find((d) => d.name === 'tool0')
    if (tool0?.kind !== 'tooldata') throw new Error('tool0 应为 tooldata')
    expect(isDefaultTool0(tool0.value)).toBe(true)
  })

  it('官方 speed/zone 名称可作为运动操作数解析；任意猜测的 v<n>/z<n> 报未定义', () => {
    const decl = `    CONST robtarget pTarget := ${RT};`
    const ok = parseRapidProgram(program(decl, '        MoveJ pTarget,v40,z100,tool0;\n'))
    // v40/z100 是官方名称，仅因 fly-by(z100) 不可执行而拦截，但不报未定义/词法错误。
    expect(ok.diagnostics.some((d) => d.code === 'undefined-symbol')).toBe(false)
    expect(ok.diagnostics.some((d) => d.code === 'lexical-error')).toBe(false)

    const guess = parseRapidProgram(program(decl, '        MoveJ pTarget,v999,z77,tool0;\n'))
    expect(guess.diagnostics.some((d) => d.code === 'undefined-symbol' && d.message.includes('v999'))).toBe(true)
    expect(guess.diagnostics.some((d) => d.code === 'undefined-symbol' && d.message.includes('z77'))).toBe(true)
  })

  it('官方 speed/zone 名称记录携带引用；vmax 在运行期解析前不执行', () => {
    const src = program('    CONST robtarget pTarget := ' + RT + ';', '        MoveJ pTarget,vmax,fine,tool0;\n')
    const result = parseRapidProgram(src)
    // vmax 是官方名称：不报未定义，但 v_tcp 依赖机器人型号，MVP 未实现 → 明确 unsupported-option。
    expect(result.diagnostics.some((d) => d.code === 'undefined-symbol' && d.message.includes('vmax'))).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 'unsupported-option' && d.message.includes('vmax'))).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('系统名称只读：源码不能重定义 tool0/wobj0/v100/z50/load0', () => {
    for (const decl of [
      '    PERS tooldata tool0 := [TRUE,[[0,0,0],[1,0,0,0]],[0,[0,0,0],[1,0,0,0],0,0,0]];',
      '    PERS wobjdata wobj0 := [FALSE,TRUE,"",[[0,0,0],[1,0,0,0]],[[0,0,0],[1,0,0,0]]];',
      '    VAR speeddata v100 := [1,1,1,1];',
      '    PERS loaddata load0 := [0.001,[0,0,0.001],[1,0,0,0],0,0,0];',
    ]) {
      const result = parseRapidProgram(program(decl))
      expect(result.diagnostics.some((d) => d.code === 'duplicate-symbol' && d.message.includes('不能重定义'))).toBe(true)
    }
  })

  it('大小写不敏感：V100 / Z50 与官方名称匹配，不产生未定义', () => {
    const src = program('    CONST robtarget pTarget := ' + RT + ';', '        MoveL pTarget,V100,z50,tool0;\n')
    const result = parseRapidProgram(src)
    // z50 是 fly-by，不可执行但 V100（不区分大小写）不报未定义。
    expect(result.diagnostics.some((d) => d.code === 'undefined-symbol')).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 'lexical-error')).toBe(false)
  })
})

describe('Ticket 01 — 只读浏览与回归', () => {
  it('含无关错误时仍暴露已声明的合法五类数据，但不可执行', () => {
    const src = program(
      '    PERS tooldata tGrip := [TRUE,[[0,0,184],[1,0,0,0]],[0,[0,0,0],[1,0,0,0],0,0,0]];\n    CONST robtarget pGood := ' + RT + ';',
      '        MoveJ pGood,v100,fine,tool0;\n        WaitTime 1;\n',
    )
    const result = parseRapidProgram(src)
    // 无关的 WaitTime 阻止执行，但五类数据仍可只读浏览。
    expect(result.canExecute).toBe(false)
    expect(result.program).toHaveLength(0)
    expect(result.data.some((d) => d.name === 'tGrip')).toBe(true)
    expect(result.data.some((d) => d.name === 'pGood')).toBe(true)
  })

  it('默认 tool0/wobj0 的既有 MoveJ/MoveL 保持可执行（wobj0.ufprog 修正不回归）', () => {
    const src = program('    CONST robtarget pApproach := ' + RT + ';', '        MoveJ pApproach,v200,fine,tool0;')
    const result = parseRapidProgram(src)
    expect(result.diagnostics).toEqual([])
    expect(result.canExecute).toBe(true)
    expect(result.program).toHaveLength(1)
    const instruction = result.program[0]
    if (instruction && isRapidMotionInstruction(instruction)) {
      expect(isDefaultTool0(instruction.tool)).toBe(true)
      expect(isDefaultWobj0(instruction.wobj)).toBe(true)
      expect(instruction.wobj.ufprog).toBe(true)
    }
  })
})
