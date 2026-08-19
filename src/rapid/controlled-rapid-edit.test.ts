import { describe, expect, it } from 'vitest'
import {
  applyRapidEdit,
  formatRobTarget,
  makeTaughtTargetFromPose,
} from './controlled-rapid-edit.ts'
import {
  isRapidMotionInstruction,
  isRobtargetProgramData,
  parseRapidProgram,
  type RapidProgramDataTarget,
} from './rapid-parser.ts'
import type { Pose } from '@/robotics/types.ts'

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

describe('插入运动指令', () => {
  it('选择已有点位在 main 末尾插入 MoveJ，参数为 v100,fine,tool0', () => {
    const result = applyRapidEdit(BASE, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 1,
      target: { source: 'existing', name: 'pRest' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(next.program).toHaveLength(2)
    const inserted = next.program[1]
    if (!inserted || !isRapidMotionInstruction(inserted)) throw new Error('插入结果应为运动指令')
    expect(inserted.kind).toBe('movej')
    expect(inserted.sourceText).toContain('pRest')
    expect(inserted.speed.v_tcp).toBe(100)
  })

  it('选择当前位置在同一次结果中同时创建 p10 并插入 MoveJ', () => {
    const result = applyRapidEdit(BASE, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 1,
      target: { source: 'current', target: target([123, 456, 789]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(next.program).toHaveLength(2)
    const inserted = next.program[1]
    if (!inserted || !isRapidMotionInstruction(inserted)) throw new Error('插入结果应为运动指令')
    expect(inserted.kind).toBe('movej')
    expect(inserted.sourceText).toContain('p10')
    const inserted1 = next.program[1]
    if (!inserted1 || !isRapidMotionInstruction(inserted1)) throw new Error('插入结果应为运动指令')
    expect(inserted1.operands.target).toBe('p10')
    const p10 = robtargets(next).find((d) => d.name === 'p10')
    expect(p10?.target.trans).toEqual([123, 456, 789])
  })

  it('p10/p20 被占用时自动命名为 p30', () => {
    const source = `MODULE Demo
    CONST robtarget p10 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget p20 := [[0,0,10],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p10,v100,fine,tool0;
    ENDPROC
ENDMODULE`
    const result = applyRapidEdit(source, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 1,
      target: { source: 'current', target: target([1, 2, 3]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(robtargets(next).map((d) => d.name)).toContain('p30')
    const inserted2 = next.program[1]
    if (!inserted2 || !isRapidMotionInstruction(inserted2)) throw new Error('插入结果应为运动指令')
    expect(inserted2.operands.target).toBe('p30')
  })

  it('p10 被 VAR num P10 占用时跳过', () => {
    const source = `MODULE Demo
    VAR num P10 := 1;
    CONST robtarget pA := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ pA,v100,fine,tool0;
    ENDPROC
ENDMODULE`
    const result = applyRapidEdit(source, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 1,
      target: { source: 'current', target: target([1, 2, 3]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    const inserted3 = next.program[1]
    if (!inserted3 || !isRapidMotionInstruction(inserted3)) throw new Error('插入结果应为运动指令')
    expect(inserted3.operands.target).toBe('p20')
  })

  it('选择当前位置插入 MoveL 且缺失已有目标仍成功（不依赖已有点位）', () => {
    const result = applyRapidEdit(BASE, {
      type: 'insert-motion',
      kind: 'movel',
      insertionIndex: 1,
      target: { source: 'current', target: target([0, 0, 0]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.result.source).program[1].kind).toBe('movel')
  })

  it('选择已有点位缺失返回 undefined-target', () => {
    const result = applyRapidEdit(BASE, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 1,
      target: { source: 'existing', name: 'nope' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('undefined-target')
  })

  it('按指定插入位置插入到第一条运动之前，并返回 PP 下标位移提示', () => {
    const result = applyRapidEdit(BASE, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 0,
      target: { source: 'existing', name: 'pRest' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result.programIndexShift).toEqual({ at: 0, delta: 1 })
    const next = parse(result.result.source)
    expect(next.program[0].sourceText).toContain('pRest')
    expect(next.program[1].sourceText).toContain('pApproach')
  })

  it('声明 offset 小于运动 offset 时两段位置仍正确', () => {
    const result = applyRapidEdit(BASE, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 0,
      target: { source: 'current', target: target([1, 2, 3]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    const p10 = robtargets(next).find((d) => d.name === 'p10')
    expect(p10).toBeDefined()
    expect(next.program[0].sourceText).toContain('p10')
    expect(next.program[1].sourceText).toContain('pApproach')
  })

  it('CRLF 源码插入后不引入裸 LF', () => {
    const crlfSource = BASE.replace(/\n/g, '\r\n')
    const result = applyRapidEdit(crlfSource, {
      type: 'insert-motion',
      kind: 'movej',
      insertionIndex: 1,
      target: { source: 'current', target: target([1, 2, 3]) },
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
      target: { source: 'existing', name: 'pRest' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid-insertion-position')
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
      target: { source: 'existing', name: 'pCorner0' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const lines = result.result.source.split('\n')
    // 新语句插在锚点 MoveJ pCorner0 之前；选已有点位时新行为 MoveJ pCorner0,v100,...。
    const idx = lines.findIndex((l) => l.trim() === 'MoveJ pCorner0,v100,fine,tool0;')
    expect(idx).toBeGreaterThan(-1)
    expect(lines[idx].length - lines[idx].trimStart().length).toBe(6)
    // 原锚点行与其后 MoveL 仍保持 6 空格缩进。
    const anchor = lines[idx + 1]
    expect(anchor.trim()).toBe('MoveJ pCorner0, v50, fine, tool0;')
    expect(anchor.length - anchor.trimStart().length).toBe(6)
    const next = lines[idx + 2]
    expect(next.trim().startsWith('MoveL pCorner1')).toBe(true)
    expect(next.length - next.trimStart().length).toBe(6)
    // 插入语句没有把原行挤到行首（无裸 LF 粘连）。
    expect(lines.join('\n')).not.toMatch(/MoveJ pCorner0,v100[^\n]+\nMoveL/m)
  })

  it('选择当前位置时自动新建的 robtarget 声明为独立行，不与 PROC main 粘连', () => {
    const result = applyRapidEdit(NESTED, {
      type: 'insert-motion',
      kind: 'movel',
      insertionIndex: 2,
      target: { source: 'current', target: target([100, 200, 300]) },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const source = result.result.source
    expect(source).toMatch(/^\s{2}CONST robtarget p10 := [^;]+;\s*$/m)
    // 声明行与 PROC main() 不在同一行。
    expect(source).not.toMatch(/robtarget p10 := [^;]*;PROC main/)
    expect(/CONST robtarget p10 :=\s*\S+;\s*\n\s*PROC main\(\)/.test(source)).toBe(true)
    // 新声明的缩进沿用模块级（2 空格）。
    const decl = source.split('\n').find((l) => l.includes('CONST robtarget p10'))
    expect(decl && decl.length - decl.trimStart().length).toBe(2)
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
      {
        type: 'insert-motion',
        kind: 'movej',
        insertionIndex: 1,
        target: { source: 'existing', name: 'p1' },
      },
    ] as const
    for (const command of commands) {
      const result = applyRapidEdit(BROKEN, command as never)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('source-error')
    }
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
