import { describe, expect, it } from 'vitest'
import {
  applyRapidEdit,
  makeTaughtTargetFromPose,
} from './controlled-rapid-edit.ts'
import { formatRobTarget } from './formatting.ts'
import {
  isRapidMotionInstruction,
  isRobtargetProgramData,
  parseRapidProgram,
  type RapidProgramDataTarget,
} from '../language/index.ts'
import type { Pose } from '@/robotics/model/index.ts'

const BASE = `MODULE TeachingDemo
    CONST robtarget pApproach := [[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pRest := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];

    PROC main()
        MoveJ pApproach,v200,fine,tool0;
        ! a comment that mentions pWork must not be touched
    ENDPROC
ENDMODULE
`

function parse(source: string) {
  return parseRapidProgram(source)
}

/** 从解析结果中取 robtarget 点位条目（受控编辑只作用于点位符号）。 */
function robtargets(parsed: ReturnType<typeof parse>): RapidProgramDataTarget[] {
  return parsed.data.filter(isRobtargetProgramData)
}

function target(trans: [number, number, number]) {
  return {
    trans,
    rot: [1, 0, 0, 0] as [number, number, number, number],
    robconf: [0, 0, 0, 0] as [number, number, number, number],
    extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9] as [number, number, number, number, number, number],
  }
}

describe('新建目标', () => {
  it('在 main 之前新建模块级 CONST robtarget，源程序保持可执行', () => {
    const result = applyRapidEdit(BASE, {
      type: 'create-target',
      name: 'pWork',
      target: target([300, 0, 400]),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    const rb = robtargets(next)
    expect(rb.map((d) => d.name)).toEqual(['pApproach', 'pRest', 'pWork'])
    expect(rb[2].storage).toBe('const')
    expect(rb[2].target.trans).toEqual([300, 0, 400])
    expect(rb[2].target.extax).toEqual([9e9, 9e9, 9e9, 9e9, 9e9, 9e9])
  })

  it('非法名称被拒绝且源文本逐字不变', () => {
    const result = applyRapidEdit(BASE, {
      type: 'create-target',
      name: '9bad',
      target: target([0, 0, 0]),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-name')
  })

  it('大小写不敏感的重名被拒绝', () => {
    const result = applyRapidEdit(BASE, {
      type: 'create-target',
      name: 'papproach',
      target: target([0, 0, 0]),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('duplicate-name')
  })

  it('跨类型重名（VAR num 占用 p10）被拒绝', () => {
    const source = `MODULE Demo
    VAR num p10 := 1;
    CONST robtarget pA := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ pA,v100,fine,tool0;
    ENDPROC
ENDMODULE`
    const result = applyRapidEdit(source, {
      type: 'create-target',
      name: 'p10',
      target: target([0, 0, 0]),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('duplicate-name')
  })
})

describe('Modify Position', () => {
  it('只替换目标值，其余源码与引用保持不变', () => {
    const result = applyRapidEdit(BASE, {
      type: 'modify-position',
      name: 'pApproach',
      target: target([999, 111, 222]),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    const entry = robtargets(next).find((d) => d.name === 'pApproach')
    expect(entry?.target.trans).toEqual([999, 111, 222])
    // 未涉及的声明（pRest）保持原样。
    expect(robtargets(next).find((d) => d.name === 'pRest')?.target.trans).toEqual([451, 0, 807.1])
    // 注释中的 pWork 未被改动。
    expect(result.result.source).toContain('! a comment that mentions pWork must not be touched')
  })

  it('缺失目标返回 undefined-target', () => {
    const result = applyRapidEdit(BASE, {
      type: 'modify-position',
      name: 'nope',
      target: target([0, 0, 0]),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('undefined-target')
  })
})

describe('重命名', () => {
  it('更新声明名与所有引用，不修改相似名称或注释', () => {
    // pApproach 在声明与 MoveJ 各出现一次（大小写不同）。
    const result = applyRapidEdit(BASE, {
      type: 'rename-target',
      name: 'pApproach',
      newName: 'pStart',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(robtargets(next).map((d) => d.name)).toEqual(['pStart', 'pRest'])
    expect(next.program[0].sourceText).toContain('pStart')
    // 声明中新名称已替换。
    expect(result.result.source).toContain('CONST robtarget pStart :=')
    // 未涉及的 pRest 与注释保持原样。
    expect(result.result.source).toContain('! a comment that mentions pWork must not be touched')
  })

  it('重命名为已存在名称（大小写不敏感）被拒绝', () => {
    const result = applyRapidEdit(BASE, {
      type: 'rename-target',
      name: 'pApproach',
      newName: 'PREST',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('duplicate-name')
  })

  it('重命名为跨类型已存在名称被拒绝', () => {
    const source = `MODULE Demo
    VAR num p10 := 1;
    CONST robtarget pA := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ pA,v100,fine,tool0;
    ENDPROC
ENDMODULE`
    const result = applyRapidEdit(source, {
      type: 'rename-target',
      name: 'pA',
      newName: 'p10',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('duplicate-name')
  })
})

describe('删除目标', () => {
  it('零引用目标删除整行，源程序仍可执行', () => {
    // pRest 未被 MoveJ/MoveL 引用。
    const result = applyRapidEdit(BASE, { type: 'delete-target', name: 'pRest' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(robtargets(next).map((d) => d.name)).toEqual(['pApproach'])
  })

  it('有引用目标返回稳定错误且源码逐字不变', () => {
    const result = applyRapidEdit(BASE, { type: 'delete-target', name: 'pApproach' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('target-referenced')
  })

  it('CRLF 源码删除后不引入裸 LF', () => {
    const crlfSource = BASE.replace(/\n/g, '\r\n')
    const result = applyRapidEdit(crlfSource, { type: 'delete-target', name: 'pRest' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result.source).toContain('\r\n')
    expect(result.result.source.replace(/\r\n/g, '').includes('\n')).toBe(false)
    expect(result.result.source.replace(/\r\n/g, '').includes('\r')).toBe(false)
    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
  })
})

describe('插入运动指令（FlexPendant 添加指令）', () => {
  it('插入 MoveJ 生成 `*` 未示教占位与默认参数 v1000,z50,tool0', () => {
    const result = applyRapidEdit(BASE, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result.source).toContain('MoveJ *,v1000,z50,tool0;')
    const next = parse(result.result.source)
    // `*` 占位使程序不可运行（真机一致），但指令进入 instructions 视图。
    expect(next.canExecute).toBe(false)
    expect(next.diagnostics.some((d) => d.code === 'missing-target')).toBe(true)
    expect(next.instructions).toHaveLength(2)
    const inserted = next.instructions[1]
    if (!inserted || !isRapidMotionInstruction(inserted)) throw new Error('插入结果应为运动指令')
    expect(inserted.kind).toBe('movej')
    expect(inserted.operands.target).toBe('*')
  })

  it('按指定插入位置插入到第一条运动之前，并返回 PP 重映射信息', () => {
    const result = applyRapidEdit(BASE, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result.programRemap).toEqual({ inserted: { at: 0, count: 1 } })
    const next = parse(result.result.source)
    expect(next.instructions[0].sourceText).toContain('MoveJ *')
    expect(next.instructions[1].sourceText).toContain('pApproach')
  })

  it('CRLF 源码插入后不引入裸 LF', () => {
    const crlfSource = BASE.replace(/\n/g, '\r\n')
    const result = applyRapidEdit(crlfSource, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result.source).toContain('\r\n')
    expect(result.result.source).not.toMatch(/[^\r]\n/)
  })

  it('无效 insertionIndex 失败且源码不变', () => {
    const result = applyRapidEdit(BASE, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 99,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-insertion-position')
  })

  it('含 `*` 占位的程序仍可继续插入指令（missing-target 不阻塞编辑）', () => {
    const first = applyRapidEdit(BASE, { type: 'insert-motion', kind: 'movel', insertionIndex: 1 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applyRapidEdit(first.result.source, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 2,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(parse(second.result.source).instructions).toHaveLength(3)
  })
})

describe('插入运动指令的源码格式化（沿用邻居缩进、独立换行）', () => {
  // 2 空格基础缩进 + WHILE 嵌套（WHILE 体内 6 空格），复现用户真实程序布局。
  const NESTED = `MODULE M
  CONST robtarget pHome := [[451,0,807],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pCorner0 := [[351,-200,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  CONST robtarget pCorner1 := [[651,-200,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
  PROC main()
    MoveJ pHome, v100, fine, tool0;
    WHILE TRUE DO
      MoveJ pCorner0, v50, fine, tool0;
      MoveL pCorner1, v50, fine, tool0;
    ENDWHILE
  ENDPROC
ENDMODULE`

  it('新运动语句行缩进与锚点行一致，原行缩进不被破坏', () => {
    const result = applyRapidEdit(NESTED, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 2,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const lines = result.result.source.split('\n')
    // 新语句插在锚点 MoveJ pCorner0 之前。
    const idx = lines.findIndex((l) => l.trim() === 'MoveJ *,v1000,z50,tool0;')
    expect(idx).toBeGreaterThan(-1)
    expect(lines[idx].length - lines[idx].trimStart().length).toBe(6)
    // 原锚点行与其后 MoveL 仍保持 6 空格缩进。
    const anchor = lines[idx + 1]
    expect(anchor.trim()).toBe('MoveJ pCorner0, v50, fine, tool0;')
    expect(anchor.length - anchor.trimStart().length).toBe(6)
    const next = lines[idx + 2]
    expect(next.trim().startsWith('MoveL pCorner1')).toBe(true)
    expect(next.length - next.trimStart().length).toBe(6)
  })
})

describe('编辑运动指令参数（FlexPendant 参数编辑器）', () => {
  const STAR = `MODULE TeachingDemo
    CONST robtarget pApproach := [[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pRest := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ pApproach,v200,fine,tool0;
        MoveL *,v1000,z50,tool0;
    ENDPROC
ENDMODULE
`

  it('目标点选已有点位：`*` 占位被替换，程序恢复可执行', () => {
    const result = applyRapidEdit(STAR, {
      type: 'edit-motion-operand',
      index: 1,
      operand: 'target',
      value: { source: 'existing', name: 'pRest' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result.programTextChangedAt).toBe(1)
    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(next.program[1].sourceText).toBe('MoveL pRest,v1000,z50,tool0;')
  })

  it('目标点新建：原子创建 p10 声明（记录示教值）并引用', () => {
    const result = applyRapidEdit(STAR, {
      type: 'edit-motion-operand',
      index: 1,
      operand: 'target',
      value: { source: 'new', target: target([123, 456, 789]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    const p10 = robtargets(next).find((d) => d.name === 'p10')
    expect(p10?.target.trans).toEqual([123, 456, 789])
    expect(next.program[1].sourceText).toBe('MoveL p10,v1000,z50,tool0;')
    // 声明为模块级独立行，不与 PROC main 粘连。
    expect(result.result.source).toMatch(/CONST robtarget p10 := [^;]+;\s*\n\s*PROC main\(\)/)
  })

  it('p10/p20 被占用时自动命名为 p30；被 VAR num 占用时跳过', () => {
    const occupied = `MODULE Demo
    CONST robtarget p10 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget p20 := [[0,0,10],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ *,v1000,z50,tool0;
    ENDPROC
ENDMODULE`
    const result = applyRapidEdit(occupied, {
      type: 'edit-motion-operand',
      index: 0,
      operand: 'target',
      value: { source: 'new', target: target([1, 2, 3]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const next = parse(result.result.source)
    expect(robtargets(next).map((d) => d.name)).toContain('p30')
    expect(next.program[0].sourceText).toContain('p30')

    const crossType = `MODULE Demo
    VAR num P10 := 1;
    CONST robtarget pA := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ *,v1000,z50,tool0;
    ENDPROC
ENDMODULE`
    const skipped = applyRapidEdit(crossType, {
      type: 'edit-motion-operand',
      index: 0,
      operand: 'target',
      value: { source: 'new', target: target([1, 2, 3]) },
    })
    expect(skipped.ok).toBe(true)
    if (!skipped.ok) return
    expect(parse(skipped.result.source).program[0].sourceText).toContain('p20')
  })

  it('目标点选已有点位可整体替换 Offs 表达式', () => {
    const source = `MODULE Demo
    CONST robtarget p10 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pRest := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveL Offs(p10,100,0,0),v1000,z50,tool0;
    ENDPROC
ENDMODULE`
    const result = applyRapidEdit(source, {
      type: 'edit-motion-operand',
      index: 0,
      operand: 'target',
      value: { source: 'existing', name: 'pRest' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.result.source).program[0].sourceText).toBe('MoveL pRest,v1000,z50,tool0;')
  })

  it('目标点选不存在的点位返回 undefined-target', () => {
    const result = applyRapidEdit(STAR, {
      type: 'edit-motion-operand',
      index: 1,
      operand: 'target',
      value: { source: 'existing', name: 'nope' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('undefined-target')
  })

  it('速度/转弯区替换为用户或系统预定义数据，大小写不敏感', () => {
    const speed = applyRapidEdit(STAR, {
      type: 'edit-motion-operand',
      index: 0,
      operand: 'speed',
      value: { name: 'V50' },
    })
    expect(speed.ok).toBe(true)
    if (!speed.ok) return
    // 使用数据列表中的原始拼写替换。
    expect(parse(speed.result.source).instructions[0].sourceText).toContain(',v50,')

    const zone = applyRapidEdit(STAR, {
      type: 'edit-motion-operand',
      index: 0,
      operand: 'zone',
      value: { name: 'fine' },
    })
    expect(zone.ok).toBe(true)
    if (!zone.ok) return
    expect(parse(zone.result.source).instructions[0].sourceText).toContain(',fine,')
  })

  it('速度/转弯区不存在返回 undefined-operand', () => {
    const result = applyRapidEdit(STAR, {
      type: 'edit-motion-operand',
      index: 0,
      operand: 'speed',
      value: { name: 'v9999' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('undefined-operand')
  })

  it('非运动指令与越界下标返回 invalid-instruction', () => {
    const source = `MODULE Demo
    CONST robtarget pA := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    VAR num nCount := 0;
    PROC main()
        nCount := 1;
        MoveJ pA,v100,fine,tool0;
    ENDPROC
ENDMODULE`
    const notMotion = applyRapidEdit(source, {
      type: 'edit-motion-operand',
      index: 0,
      operand: 'speed',
      value: { name: 'v50' },
    })
    expect(notMotion.ok).toBe(false)
    if (!notMotion.ok) expect(notMotion.error.code).toBe('invalid-instruction')

    const outOfRange = applyRapidEdit(source, {
      type: 'edit-motion-operand',
      index: 99,
      operand: 'speed',
      value: { name: 'v50' },
    })
    expect(outOfRange.ok).toBe(false)
    if (!outOfRange.ok) expect(outOfRange.error.code).toBe('invalid-instruction')
  })
})

describe('指令级编辑（删除/注释/切换运动类型）', () => {
  const THREE = `MODULE Demo
    CONST robtarget pA := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget pB := [[100,0,807],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ pA,v100,fine,tool0;
        MoveL pB,v200,z10,tool0;
        MoveJ pB,v50,fine,tool0;
    ENDPROC
ENDMODULE
`

  it('删除中间一条指令：整行移除并返回 removed 重映射', () => {
    const result = applyRapidEdit(THREE, { type: 'delete-instruction', index: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.programRemap).toEqual({ removed: [1] })
    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(next.program.map((i) => i.sourceText)).toEqual([
      'MoveJ pA,v100,fine,tool0;',
      'MoveJ pB,v50,fine,tool0;',
    ])
  })

  it('删除 IF 头破坏结构时整体拒绝且源码不变', () => {
    const source = `MODULE Demo
    CONST robtarget pA := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    VAR num nCount := 0;
    PROC main()
        IF nCount > 0 THEN
            MoveJ pA,v100,fine,tool0;
        ENDIF
    ENDPROC
ENDMODULE`
    const result = applyRapidEdit(source, { type: 'delete-instruction', index: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('source-error')
  })

  it('注释指令行首加 `!`，指令从程序移除；取消注释恢复', () => {
    const commented = applyRapidEdit(THREE, { type: 'comment-instructions', indices: [1] })
    expect(commented.ok).toBe(true)
    if (!commented.ok) return
    expect(commented.result.programRemap).toEqual({ removed: [1] })
    expect(commented.result.source).toContain('!        MoveL pB,v200,z10,tool0;')
    const parsedCommented = parse(commented.result.source)
    expect(parsedCommented.canExecute).toBe(true)
    expect(parsedCommented.instructions).toHaveLength(2)

    // 取消注释：按行号恢复。
    const line = commented.result.source
      .slice(0, commented.result.source.indexOf('!        MoveL'))
      .split('\n').length
    const restored = applyRapidEdit(commented.result.source, {
      type: 'uncomment-lines',
      lines: [line],
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.result.programRemap).toEqual({ inserted: { at: 1, count: 1 } })
    expect(parse(restored.result.source).instructions).toHaveLength(3)
  })

  it('取消注释非注释行被拒绝', () => {
    const result = applyRapidEdit(THREE, { type: 'uncomment-lines', lines: [1] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-instruction')
  })

  it('注释 WHILE 头破坏结构时整体拒绝', () => {
    const source = `MODULE Demo
    CONST robtarget pA := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        WHILE TRUE DO
            MoveJ pA,v100,fine,tool0;
        ENDWHILE
    ENDPROC
ENDMODULE`
    const result = applyRapidEdit(source, { type: 'comment-instructions', indices: [0] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('source-error')
  })

  it('Change to MoveJ/MoveL：关键字互换，操作数不变', () => {
    const result = applyRapidEdit(THREE, { type: 'change-motion-kind', index: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.result.programTextChangedAt).toBe(1)
    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(next.program[1].sourceText).toBe('MoveJ pB,v200,z10,tool0;')

    const back = applyRapidEdit(result.result.source, { type: 'change-motion-kind', index: 1 })
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(parse(back.result.source).program[1].sourceText).toBe('MoveL pB,v200,z10,tool0;')
  })

  it('非运动指令切换运动类型被拒绝', () => {
    const source = `MODULE Demo
    VAR num nCount := 0;
    PROC main()
        nCount := 1;
    ENDPROC
ENDMODULE`
    const result = applyRapidEdit(source, { type: 'change-motion-kind', index: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-instruction')
  })
})

describe('源程序存在 error 时禁止结构化编辑', () => {
  const BROKEN = `MODULE Broken
    CONST robtarget p1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ undefinedPoint,v50,fine,tool0;
    ENDPROC
ENDMODULE
`

  it('所有命令都返回 source-error 且不产生任何部分修改', () => {
    const commands = [
      { type: 'create-target', name: 'p2', target: target([0, 0, 0]) },
      { type: 'modify-position', name: 'p1', target: target([1, 1, 1]) },
      { type: 'rename-target', name: 'p1', newName: 'pX' },
      { type: 'delete-target', name: 'p1' },
      { type: 'insert-motion', kind: 'movej', insertionIndex: 1 },
      { type: 'delete-instruction', index: 0 },
      { type: 'comment-instructions', indices: [0] },
      { type: 'change-motion-kind', index: 0 },
      {
        type: 'edit-motion-operand',
        index: 0,
        operand: 'speed',
        value: { name: 'v50' },
      },
    ] as const
    for (const command of commands) {
      const result = applyRapidEdit(BROKEN, command as never)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('source-error')
    }
  })

  it('仅 missing-target 的诊断不阻塞任何结构化编辑', () => {
    const STAR_ONLY = `MODULE Demo
    CONST robtarget p1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveL *,v1000,z50,tool0;
    ENDPROC
ENDMODULE`
    expect(parse(STAR_ONLY).canExecute).toBe(false)
    const result = applyRapidEdit(STAR_ONLY, {
      type: 'create-target',
      name: 'p2',
      target: target([0, 0, 0]),
    })
    expect(result.ok).toBe(true)
  })
})

describe('值格式化', () => {
  it('按 ABB 顺序输出 trans/rot/robconf/extax，外部轴用 9E9', () => {
    const text = formatRobTarget({
      trans: [451, 150, 680],
      rot: [1, 0, 0, 0],
      robconf: [0, 0, 0, 0],
      extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
    })
    expect(text).toBe('[[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]]')
  })
})

describe('makeTaughtTargetFromPose', () => {
  it('单位旋转生成 [1,0,0,0] 与零 robconf、未使用外部轴', () => {
    const pose: Pose = {
      position: [100, 200, 300],
      euler: [0, 0, 0],
      rotation: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    }
    const taught = makeTaughtTargetFromPose(pose)
    expect(taught.trans).toEqual([100, 200, 300])
    expect(taught.rot).toEqual([1, 0, 0, 0])
    expect(taught.robconf).toEqual([0, 0, 0, 0])
    expect(taught.extax).toEqual([9e9, 9e9, 9e9, 9e9, 9e9, 9e9])
  })

  it('非单位旋转按 ABB 顺序 [w,x,y,z] 输出', () => {
    // 绕 Z 轴旋转 90 度的旋转矩阵。
    const pose: Pose = {
      position: [0, 0, 0],
      euler: [0, 0, 90],
      rotation: [
        [0, -1, 0],
        [1, 0, 0],
        [0, 0, 1],
      ],
    }
    const taught = makeTaughtTargetFromPose(pose)
    expect(taught.rot[0]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(taught.rot[3]).toBeCloseTo(Math.SQRT1_2, 6)
    expect(taught.rot[1]).toBeCloseTo(0, 6)
    expect(taught.rot[2]).toBeCloseTo(0, 6)
  })
})
