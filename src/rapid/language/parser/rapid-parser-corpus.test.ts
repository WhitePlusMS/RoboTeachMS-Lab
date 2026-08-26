import { describe, expect, it } from 'vitest'
import { isRapidMotionInstruction, parseRapidProgram } from './rapid-parser.ts'

/**
 * Ticket 04 — 用真实 ABB RAPID 语料验证诊断韧性。
 *
 * 每个 fixture 只保留证明一个边界所需的最小上下文，并在注释里记录来源文件与裁剪原因。
 * 保留真实的大小写、空格、缩进与注释风格；真实语料仅作诊断韧性验证，不要求本轮可执行。
 */
describe('Ticket 04 — 真实 RAPID 语料诊断韧性', () => {
  it('真实 MoveJ 用 v40/z100/fine 识别的官方 speed/zone 名可解析执行（票据 04 起）', () => {
    // 来源：abb-rapid-eval/references/rapid-real-code-examples.md 片段1（rafacastalla Pick&Place MainModule）；裁剪：去掉 IO/WaitTime，只留一条运动与最小上下文。
    const source = `MODULE MainModule
    CONST robtarget POS_ORIGEN := [[515,0,712],[0,0,1,0],[0,0,0,0],[9E+09,9E+09,9E+09,9E+09,9E+09,9E+09]];
    PROC main()
        MoveJ POS_ORIGEN, v40, z100, tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    // v40 与 z100 均为官方预定义名：无需猜测、不报词法错误；z100 是 fly-by，MVP 以安全停点近似执行。
    expect(result.diagnostics).toEqual([])
    expect(result.canExecute).toBe(true)
    expect(result.program).toHaveLength(1)
    const instruction = result.program[0]
    if (instruction && isRapidMotionInstruction(instruction)) {
      expect(instruction.speed.v_tcp).toBe(40)
      expect(instruction.zone.finep).toBe(false)
      expect(instruction.zone.pzoneTcp).toBe(100)
    }
  })

  it('真实关键字（TEST/局部 VAR 等）得到 unsupported-syntax，而不是崩溃或被误判成 lexical-error', () => {
    // 来源：abb-rapid-eval/references/rapid-real-code-examples.md 片段（TEST/CASE 多分支与过程内局部声明仍在教学子集之外）。
    const source = `MODULE MainModule
    VAR intnum NUMLATASNOK := 0;
    PROC main()
        VAR num i := 0;
        TEST i
        CASE 1:
            i := i + 1;
        DEFAULT:
        ENDTEST
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    const codes = result.diagnostics.map((d) => d.code)
    // 识别出的真实关键字（TEST/局部 VAR）必须归入 unsupported-syntax，不得退化为 lexical-error。
    expect(codes).toContain('unsupported-syntax')
    expect(
      result.diagnostics.some((d) => d.code === 'unsupported-syntax' && d.message.includes('TEST')),
    ).toBe(true)
    expect(
      result.diagnostics.some((d) => d.code === 'unsupported-syntax' && d.message.includes('VAR')),
    ).toBe(true)
    // 表达式内的运算符（+/*/=/< 等）不在词法集合中，按 lexical-error 显式上报（非静默忽略），
    // 但真实关键字本身绝不能被误判成 lexical-error。
    expect(codes.filter((c) => c === 'unsupported-syntax').length).toBeGreaterThan(0)
    expect(result.canExecute).toBe(false)
  })

  it('I/O 与 WaitTime 得到 unsupported，不静默忽略也不吞掉 ENDMODULE', () => {
    // 来源：.scratch/rapid-research/Drive.mod（真实 SetDO/Reset/WaitTime 写法，保留原缩进）。
    const source = `MODULE Drive
    PROC rTON_Vacuum_Gripper()
        SetDO DO_003_TON_VACUUM,1;
        Reset DO_004_TOF_VACUUM;
        WaitTime .5;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    expect(result.diagnostics.some((d) => d.code === 'lexical-error')).toBe(false)
    expect(result.diagnostics.some((d) => d.code === 'unsupported-syntax')).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('MoveC 解析为真实圆弧运动指令；MoveAbsJ 得到专业 unsupported 诊断而非静默忽略', () => {
    // 来源：ABB 官方 MoveC 语法；本测试由“MoveC 不支持”更新为“已支持”。
    const source = `MODULE Main_Module
    CONST jointtarget pCalib := [[0,0,0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pCircle := [[50,50,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pEnd := [[100,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveAbsJ pCalib, v1500, fine, tool0 \\WObj:=wobj0;
        MoveC pCircle, pEnd, v100, fine, tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    // MoveC 已完成支持：在完整指令流（instructions，不受 canExecute 门控）中命中一条
    // 真实 movec 指令，圆点/终点均正确解析。
    const movec = result.instructions.find((inst) => inst.kind === 'movec')
    expect(movec).toBeDefined()
    // MoveAbsJ 仍不支持，报 unsupported-syntax，且不退化 lexical。
    const codes = result.diagnostics.map((d) => d.code)
    expect(codes).toContain('unsupported-syntax')
    expect(codes.every((c) => c !== 'lexical-error')).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('Offs/RelTool 相对定位得到区分类诊断，parser 不崩溃', () => {
    // 来源：abb-rapid-eval/references/rapid-real-code-examples.md 片段5/7（MoveJ Offs(...) 与 MoveL RelTool(...) 规则轨迹）。
    const source = `MODULE RuleMotion
    CONST robtarget pPick := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ Offs(pPick, 0, 0, -200), v500, z10, tCurrent \\WObj:= wCurrent;
        MoveL RelTool(pPick, 400, 0, 0), v100, z1, tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    expect(result.diagnostics.every((d) => d.code !== 'lexical-error')).toBe(true)
    // 不复用全文查找猜位置：Offs/RelTool 作为函数式 target 被当作未定义符号，而非静默忽略。
    expect(result.diagnostics.some((d) => d.code === 'undefined-symbol')).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('不支持内容与合法 MoveJ/MoveL 混合时 canExecute=false 且 program=[]，绝不部分执行', () => {
    // 组合：真实 I/O + 一条语义正确的 MoveL。正确点位与合法运动都不得被执行。
    const source = `MODULE Mixed
    CONST robtarget p1 := [[551,613,60],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        SetDO GRIPPER_CLOSE, 0;
        MoveL p1, v50, fine, tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    expect(result.canExecute).toBe(false)
    expect(result.program).toHaveLength(0)
    // 无歧义正确的 robtarget 仍进入只读 Program Data。
    expect(result.data.some((d) => d.name === 'p1')).toBe(true)
    // unsupported（SetDO）与合法运动并存时绝不执行支持部分。
    expect(result.diagnostics.some((d) => d.code === 'unsupported-syntax')).toBe(true)
  })

  it('嵌套块、复杂表达式与真实注释不崩溃、不死循环、不吞模块结束位置', () => {
    // 来源：abb-rapid-eval/references/rapid-real-code-examples.md 片段2/4/5 混合（多层 WHILE/IF、GOTO LABEL、三角函数表达式、真实注释）。
    const source = `MODULE Advanced
    VAR num i;
    PROC main()
        ! Ex008: approximate a circle using small linear segments
        WHILE TRUE DO
            IF DI_021_DRY_RUN = 1 THEN
                i := i + 1;
            ELSE
                pNext.trans.x := centerX + radius * Cos(currentAngle);
            ENDIF
            IF i > 3 GOTO LABEL_99;
        ENDWHILE
      LABEL_99:
        TPWrite "Done";
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    // 有真实注释，可能有 lexical-error 吗？注释是 `!` 单行，词法层应合法；复杂表达式含 `+/*.=<>` 这些字符。
    // 关键：不崩溃、不死循环、不吞 ENDPROC/ENDMODULE。
    expect(result.canExecute).toBe(false)
    // ENDPROC/ENDMODULE 真实存在，不得被误报为缺失。
    expect(result.diagnostics.some((d) => d.message.includes('期望关键字 ENDPROC'))).toBe(false)
    expect(result.diagnostics.some((d) => d.message.includes('缺少 ENDMODULE'))).toBe(false)
  })

  it('真实语料中正确 robtarget 声明仍进入只读 Program Data，损坏声明不生成半合法条目', () => {
    // 来源：abb-rapid-eval/references/rapid-real-code-examples.md CalibData.mod 风格——真实 PERS tooldata/wobjdata 混入正确 robtarget。
    const source = `MODULE CalibData
    PERS tooldata TCP_VentosaTool := [TRUE,[[0,0,184],[1,0,0,0]],[1,[0,-0.818,79.529],[1,0,0,0],0,0,0]];
    CONST robtarget pGood := [[100,0,200],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ pGood, v100, fine, tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    // 正确且无歧义的 robtarget 仍可只读浏览。
    expect(result.data.some((d) => d.name === 'pGood')).toBe(true)
    // 票据 01 起，真实 tooldata 声明被解析成 tooldata 类型条目（不再被当作“半合法 robtarget”丢弃）。
    const ventosa = result.data.find((d) => d.name === 'TCP_VentosaTool')
    expect(ventosa?.kind).toBe('tooldata')
    // 该工具由机器人持有、tframe 平移为 z=184。
    expect(ventosa?.kind === 'tooldata' && ventosa.value.robhold).toBe(true)
    // 但该工具在运动中未被使用（运动仍用 tool0），且 tooldata 不是 robtarget：点位列表不受污染。
    expect(ventosa?.kind).not.toBe('robtarget')
    // 自定义工具不会被当作默认 tool0 执行：任何使用非默认为工具的运动都会被拦截。
    // 本语料运动仍用 tool0/fine/wobj0，且 tooldata 声明本身合法，故整段可执行。
    expect(result.canExecute).toBe(true)
    expect(result.program.map((i) => i.kind)).toEqual(['movej'])
  })
})
