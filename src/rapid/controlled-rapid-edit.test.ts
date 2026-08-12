import { describe, expect, it } from 'vitest'
import { applyRapidEdit, formatRobTarget } from './controlled-rapid-edit.ts'
import { parseRapidProgram } from './rapid-parser.ts'

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

function target(trans: [number, number, number]) {
  return { trans, rot: [1, 0, 0, 0] as [number, number, number, number], robconf: [0, 0, 0, 0] as [number, number, number, number], extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9] as [number, number, number, number, number, number] }
}

describe('新建目标', () => {
  it('在 main 之前新建模块级 CONST robtarget，源程序保持可执行', () => {
    const result = applyRapidEdit(BASE, { type: 'create-target', name: 'pWork', target: target([300, 0, 400]) })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(next.data.map((d) => d.name)).toEqual(['pApproach', 'pRest', 'pWork'])
    expect(next.data[2].storage).toBe('const')
    expect(next.data[2].target.trans).toEqual([300, 0, 400])
    expect(next.data[2].target.extax).toEqual([9e9, 9e9, 9e9, 9e9, 9e9, 9e9])
  })

  it('非法名称被拒绝且源文本逐字不变', () => {
    const result = applyRapidEdit(BASE, { type: 'create-target', name: '9bad', target: target([0, 0, 0]) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-name')
  })

  it('大小写不敏感的重名被拒绝', () => {
    const result = applyRapidEdit(BASE, { type: 'create-target', name: 'papproach', target: target([0, 0, 0]) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('duplicate-name')
  })
})

describe('Modify Position', () => {
  it('只替换目标值，其余源码与引用保持不变', () => {
    const result = applyRapidEdit(BASE, { type: 'modify-position', name: 'pApproach', target: target([999, 111, 222]) })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    const entry = next.data.find((d) => d.name === 'pApproach')
    expect(entry?.target.trans).toEqual([999, 111, 222])
    // 未涉及的声明（pRest）保持原样。
    expect(next.data.find((d) => d.name === 'pRest')?.target.trans).toEqual([451, 0, 807.1])
    // 注释中的 pWork 未被改动。
    expect(result.result.source).toContain('! a comment that mentions pWork must not be touched')
  })

  it('缺失目标返回 undefined-target', () => {
    const result = applyRapidEdit(BASE, { type: 'modify-position', name: 'nope', target: target([0, 0, 0]) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('undefined-target')
  })
})

describe('重命名', () => {
  it('更新声明名与所有引用，不修改相似名称或注释', () => {
    // pApproach 在声明与 MoveJ 各出现一次（大小写不同）。
    const result = applyRapidEdit(BASE, { type: 'rename-target', name: 'pApproach', newName: 'pStart' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(next.data.map((d) => d.name)).toEqual(['pStart', 'pRest'])
    expect(next.program[0].sourceText).toContain('pStart')
    // 声明中新名称已替换。
    expect(result.result.source).toContain('CONST robtarget pStart :=')
    // 未涉及的 pRest 与注释保持原样。
    expect(result.result.source).toContain('! a comment that mentions pWork must not be touched')
  })

  it('重命名为已存在名称（大小写不敏感）被拒绝', () => {
    const result = applyRapidEdit(BASE, { type: 'rename-target', name: 'pApproach', newName: 'PREST' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('duplicate-name')
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
    expect(next.data.map((d) => d.name)).toEqual(['pApproach'])
  })

  it('有引用目标返回稳定错误且源码逐字不变', () => {
    const result = applyRapidEdit(BASE, { type: 'delete-target', name: 'pApproach' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('target-referenced')
  })
})

describe('插入运动指令', () => {
  it('在 main 末尾插入引用现有目标的 MoveJ，参数为 v100,fine,tool0', () => {
    const result = applyRapidEdit(BASE, { type: 'insert-motion', name: 'pRest', kind: 'movej', insertionIndex: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const next = parse(result.result.source)
    expect(next.canExecute).toBe(true)
    expect(next.program).toHaveLength(2)
    expect(next.program[1].kind).toBe('movej')
    expect(next.program[1].sourceText).toContain('pRest')
    expect(next.program[1].speed.v_tcp).toBe(100)
  })

  it('插入 MoveL 且缺失目标返回 undefined-target', () => {
    const ok = applyRapidEdit(BASE, { type: 'insert-motion', name: 'pRest', kind: 'movel', insertionIndex: 1 })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(parse(ok.result.source).program[1].kind).toBe('movel')

    const missing = applyRapidEdit(BASE, { type: 'insert-motion', name: 'nope', kind: 'movej', insertionIndex: 1 })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('undefined-target')
  })

  it('按指定插入位置插入到第一条运动之前，并返回 PP 下标位移提示', () => {
    const result = applyRapidEdit(BASE, { type: 'insert-motion', name: 'pRest', kind: 'movej', insertionIndex: 0 })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result.programIndexShift).toEqual({ at: 0, delta: 1 })
    const next = parse(result.result.source)
    expect(next.program[0].sourceText).toContain('pRest')
    expect(next.program[1].sourceText).toContain('pApproach')
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
      { type: 'insert-motion', name: 'p1', kind: 'movej', insertionIndex: 1 },
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
