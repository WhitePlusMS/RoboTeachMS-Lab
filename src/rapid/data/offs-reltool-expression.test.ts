import { describe, expect, it } from 'vitest'
import { isRapidMotionInstruction, parseRapidProgram } from '../language/index.ts'
import { offsRobTarget, relToolRobTarget } from './target-operations.ts'
import { robTargetToWorldPose } from './workobject-pose.ts'
import { defaultWobj0, type RobTarget, type WobjData } from './index.ts'

/**
 * Ticket 03 — Offs()/RelTool() 目标表达式。
 * Offs 沿工件目标(Object)坐标系平移；RelTool 沿工具坐标系平移并支持可选旋转。
 */

const BASE: RobTarget = {
  trans: [100, 200, 300],
  rot: [1, 0, 0, 0],
  robconf: [0, 0, 0, 0],
  extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
}

/** 绕 Y 轴 90° 的 RAPID 四元数：工具局部 +X 映射到世界 -Z。 */
const ROT_Y90: RobTarget['rot'] = [Math.SQRT1_2, 0, Math.SQRT1_2, 0]
const BASE_ROT: RobTarget = { ...BASE, rot: ROT_Y90 }

function parseMain(body: string): ReturnType<typeof parseRapidProgram> {
  return parseRapidProgram(
    `MODULE T\n    CONST robtarget pBase := [[100,200,300],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n    PROC main()\n${body}    ENDPROC\nENDMODULE\n`,
  )
}

describe('Ticket 03 — Offs 沿 Object 坐标系平移', () => {
  it('offsRobTarget 向 trans 累加 X/Y/Z（对象轴）', () => {
    const offs = offsRobTarget(BASE, 10, -20, 30)
    expect(offs.trans).toEqual([110, 180, 330])
    expect(offs.rot).toEqual(BASE.rot)
  })

  it('MoveJ Offs(pBase,10,0,0) 执行，目标 trans = 基准 + [10,0,0]', () => {
    const result = parseMain('        MoveJ Offs(pBase,10,0,0),v100,fine,tool0;\n')
    expect(result.diagnostics).toEqual([])
    expect(result.canExecute).toBe(true)
    const instruction = result.program[0]
    if (!instruction || !isRapidMotionInstruction(instruction))
      throw new Error('Offs MoveJ 结构异常')
    expect(instruction.target.trans).toEqual([110, 200, 300])
  })

  it('MoveL Offs(pBase,0,0,-50) 执行（对象轴偏移也可执行）', () => {
    const result = parseMain('        MoveL Offs(pBase,0,0,-50),v100,fine,tool0;\n')
    expect(result.diagnostics).toEqual([])
    expect(result.canExecute).toBe(true)
    const instruction = result.program[0]
    if (!instruction || !isRapidMotionInstruction(instruction))
      throw new Error('Offs MoveL 结构异常')
    expect(instruction.target.trans).toEqual([100, 200, 250])
  })
})

describe('Ticket 03 — RelTool 沿工具坐标系平移与旋转', () => {
  it('relToolRobTarget 在恒等姿态下位移等于工具轴自身', () => {
    const rel = relToolRobTarget(BASE, 10, 0, 0)
    expect(rel.trans).toEqual([110, 200, 300])
  })

  it('旋转基准下 RelTool 沿工具轴与世界轴不同：+dx 落到世界 -Z', () => {
    const rel = relToolRobTarget(BASE_ROT, 10, 0, 0)
    // 工具局部 +X（在绕 Y 90° 后）→ 世界 -Z；对象轴(Offs)则 +X。
    expect(rel.trans[2]).toBeCloseTo(290, 6)
    expect(rel.trans[0]).toBeCloseTo(100, 6)
    const offs = offsRobTarget(BASE_ROT, 10, 0, 0)
    expect(offs.trans).toEqual([110, 200, 300])
    // 同一数值偏移：RelTool 与 Offs 结果不同（工具轴 vs 对象轴）。
    expect(offs.trans).not.toEqual(rel.trans)
  })

  it('MoveL RelTool 执行并沿工具轴解释（旋转基准下与 Offs 不同）', () => {
    const result = parseRapidProgram(
      `MODULE T\n    CONST robtarget pBase := [[100,200,300],[${ROT_Y90.join(',')}],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n    PROC main()\n        MoveL RelTool(pBase,10,0,0),v100,fine,tool0;\n    ENDPROC\nENDMODULE\n`,
    )
    expect(result.diagnostics).toEqual([])
    expect(result.canExecute).toBe(true)
    const instruction = result.program[0]
    if (!instruction || !isRapidMotionInstruction(instruction))
      throw new Error('RelTool MoveL 结构异常')
    expect(instruction.target).toBeDefined()
    if (instruction.target) {
      expect(instruction.target.trans[0]).toBeCloseTo(100, 6)
      expect(instruction.target.trans[2]).toBeCloseTo(290, 6)
    }
  })

  it('解析 RelTool 的命名旋转开关，允许省略未使用的旋转轴', () => {
    const result = parseRapidProgram(
      `MODULE T\n    CONST robtarget pBase := [[100,200,300],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n    PROC main()\n        MoveJ RelTool(pBase,10,0,0 \\Rx:=15 \\Rz:=22.5),v100,fine,tool0;\n    ENDPROC\nENDMODULE\n`,
    )
    expect(result.diagnostics).toEqual([])
    expect(result.canExecute).toBe(true)
    const instruction = result.program[0]
    if (!instruction || !isRapidMotionInstruction(instruction))
      throw new Error('RelTool 旋转开关结构异常')
    expect(instruction.target.trans).toEqual([110, 200, 300])
    expect(instruction.target.rot).not.toEqual(BASE.rot)
  })

  it('RelTool 可选旋转参数改变目标姿态', () => {
    const rel = relToolRobTarget(BASE, 0, 0, 0, 90, 0, 0)
    expect(rel.rot).not.toEqual(BASE.rot)
  })
})

describe('Ticket 03 — 表达式错误精确诊断并阻止执行', () => {
  const decl =
    '    CONST robtarget pBase := [[100,200,300],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n'

  it('未定义基准目标报 undefined-symbol', () => {
    const result = parseRapidProgram(
      `MODULE T\n${decl}    PROC main()\n        MoveJ Offs(nope,1,2,3),v100,fine,tool0;\n    ENDPROC\nENDMODULE\n`,
    )
    expect(
      result.diagnostics.some((d) => d.code === 'undefined-symbol' && d.message.includes('nope')),
    ).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('参数数量错误（Offs 2 个）报 invalid-data', () => {
    const result = parseRapidProgram(
      `MODULE T\n${decl}    PROC main()\n        MoveJ Offs(pBase,1,2),v100,fine,tool0;\n    ENDPROC\nENDMODULE\n`,
    )
    expect(
      result.diagnostics.some(
        (d) => d.code === 'invalid-data' && d.message.includes('Offs 需要 3'),
      ),
    ).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('RelTool 参数数量不是 3/6 报 invalid-data', () => {
    const result = parseRapidProgram(
      `MODULE T\n${decl}    PROC main()\n        MoveJ RelTool(pBase,1,2,3,4),v100,fine,tool0;\n    ENDPROC\nENDMODULE\n`,
    )
    expect(
      result.diagnostics.some(
        (d) => d.code === 'invalid-data' && d.message.includes('RelTool 需要 3 或 6'),
      ),
    ).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('非数值参数报 invalid-data', () => {
    const result = parseRapidProgram(
      `MODULE T\n${decl}    PROC main()\n        MoveJ Offs(pBase,x,0,0),v100,fine,tool0;\n    ENDPROC\nENDMODULE\n`,
    )
    expect(
      result.diagnostics.some((d) => d.code === 'invalid-data' && d.message.includes('数字')),
    ).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('缺失括号/残缺参数列表给出精确诊断并阻止执行', () => {
    // Offs(pBase,1,2,3 后没有 `)`：参数列表残缺，parser 会给出 Offs 表达式相关的精确诊断。
    const result = parseRapidProgram(
      `MODULE T\n${decl}    PROC main()\n        MoveJ Offs(pBase,1,2,3,v100,fine,tool0;\n    ENDPROC\nENDMODULE\n`,
    )
    expect(result.diagnostics.some((d) => d.message.includes('Offs'))).toBe(true)
    expect(result.canExecute).toBe(false)
    expect(result.program).toHaveLength(0)
  })

  it('嵌套/不支持的表达式不崩溃并给出诊断，程序不可部分执行', () => {
    const result = parseRapidProgram(
      `MODULE T\n${decl}    PROC main()\n        MoveJ Offs(Offs(pBase,1,2,3),1,2,3),v100,fine,tool0;\n    ENDPROC\nENDMODULE\n`,
    )
    // 外层 Offs 的基准是 Offs(...)，不是已声明 robtarget：必须有诊断（未定义/解析错误），且不可执行。
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.canExecute).toBe(false)
    expect(result.program).toHaveLength(0)
  })
})

describe('Ticket 03 — Offs 沿对象轴而非世界轴（旋转 wobj 下）', () => {
  it('旋转 wobj 的 uframe 下，Offs(10,0,0) 的世界位移 = 对象局部 +X 方向（非世界 +X）', () => {
    // wobj 的 uframe 绕 Y 旋转 30°：对象局部 +X 映射到世界 [cos30, 0, -sin30]。
    const wobj: WobjData = {
      ...defaultWobj0(),
      uframe: { trans: [0, 0, 0], rot: [Math.cos(Math.PI / 12), 0, Math.sin(Math.PI / 12), 0] },
    }
    const base: RobTarget = {
      trans: [100, 200, 300],
      rot: [1, 0, 0, 0],
      robconf: [0, 0, 0, 0],
      extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
    }
    const worldBase = robTargetToWorldPose(base, wobj).position
    const worldOffs = robTargetToWorldPose(offsRobTarget(base, 10, 0, 0), wobj).position
    const delta = [
      worldOffs[0] - worldBase[0],
      worldOffs[1] - worldBase[1],
      worldOffs[2] - worldBase[2],
    ]
    // Offs 沿对象轴：世界位移 = Ry(30°)·[10,0,0] = [8.660, 0, -5]，而非世界 +X 的 [10,0,0]。
    expect(delta[0]).toBeCloseTo(8.66, 2)
    expect(delta[1]).toBeCloseTo(0, 2)
    expect(delta[2]).toBeCloseTo(-5, 2)
  })
})
