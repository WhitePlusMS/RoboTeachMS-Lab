import { describe, expect, it } from 'vitest'
import { parseRapidProgram } from '../rapid/rapid-parser.ts'

/**
 * Ticket 04 — 用真实 ABB RAPID 语料验证诊断韧性。
 *
 * 每个 fixture 只保留证明一个边界所需的最小上下文，并在注释里记录来源文件与裁剪原因。
 * 保留真实的大小写、空格、缩进与注释风格；真实语料仅作诊断韧性验证，不要求本轮可执行。
 */
describe('Ticket 04 — 真实 RAPID 语料诊断韧性', () => {
  it('真实 MoveJ 用 z100 速度与 \WObj，得到 unsupported-option 而非崩溃', () => {
    // 来源：docs/rapid-real-code-examples.md 片段1（rafacastalla Pick&Place MainModule）；裁剪：去掉 IO/WaitTime，只留一条运动与最小上下文。
    const source = `MODULE MainModule
    CONST robtarget POS_ORIGEN := [[515,0,712],[0,0,1,0],[0,0,0,0],[9E+09,9E+09,9E+09,9E+09,9E+09,9E+09]];
    PROC main()
        MoveJ POS_ORIGEN, v40, z100, tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    // 真实存在但暂不支持的 zone/speed 命名得到 unsupported / undefined，而非 lexical-error。
    expect(result.diagnostics.some((d) => d.code === 'lexical-error')).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.canExecute).toBe(false)
    // 正确拼写但平台边界外的能力按 unsupported/undefined 分类。
    expect(
      result.diagnostics.some((d) => d.code === 'unsupported-option' || d.code === 'undefined-symbol'),
    ).toBe(true)
  })

  it('VAR 赋值与控制流得到 unsupported-syntax，而不是崩溃或被静默忽略', () => {
    // 来源：docs/rapid-real-code-examples.md 片段2/8（可变声明、WHILE、IF/ELSE/ENDIF）。
    const source = `MODULE MainModule
    VAR intnum NUMLATASNOK := 0;
    PROC main()
        VAR num i := 0;
        WHILE i < 3 DO
            i := i + 1;
        ENDWHILE
        IF i = 3 THEN
            num := i;
        ENDIF
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    const codes = result.diagnostics.map((d) => d.code)
    // 识别出的真实关键字（VAR/WHILE/IF）必须归入 unsupported-syntax，不得退化为 lexical-error。
    expect(codes).toContain('unsupported-syntax')
    // 具体到这些关键字都应产生 unsupported-syntax 分类，而不是 lexical-error。
    expect(
      result.diagnostics.some((d) => d.code === 'unsupported-syntax' && d.message.includes('VAR')),
    ).toBe(true)
    expect(
      result.diagnostics.some((d) => d.code === 'unsupported-syntax' && d.message.includes('WHILE')),
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

  it('MoveC 与 MoveAbsJ 得到专业 unsupported 诊断而非 lexical 或静默忽略', () => {
    // 来源：docs/rapid-real-code-examples.md 片段6（MoveAbsJ）与 ABB 官方 MoveC 语法。
    const source = `MODULE Main_Module
    CONST jointtarget pCalib := [[0,0,0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveAbsJ pCalib, v1500, fine, tool0 \\WObj:=wobj0;
        MoveC pCircle, pEnd, v100, fine, tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    const codes = result.diagnostics.map((d) => d.code)
    expect(codes).toContain('unsupported-syntax')
    expect(codes.every((c) => c !== 'lexical-error')).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('Offs/RelTool 相对定位得到区分类诊断，parser 不崩溃', () => {
    // 来源：docs/rapid-real-code-examples.md 片段5/7（MoveJ Offs(...) 与 MoveL RelTool(...) 规则轨迹）。
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
    // 来源：docs/rapid-real-code-examples.md 片段2/4/5 混合（多层 WHILE/IF、GOTO LABEL、三角函数表达式、真实注释）。
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
    // 来源：docs/rapid-real-code-examples.md CalibData.mod 风格——真实 PERS tooldata/wobjdata 混入正确 robtarget。
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
    // tooldata 声明（真实但暂不支持的类型）不产生半合法 robtarget 数据。
    expect(result.data.every((d) => d.name !== 'TCP_VentosaTool')).toBe(true)
    expect(result.canExecute).toBe(false)
  })
})
