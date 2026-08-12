// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProgramDataPanel from './ProgramDataPanel.vue'
import {
  parseRapidProgram,
  type RapidExecutableInstruction,
  type RapidMotionInsertionPoint,
  type RapidProgramDataTarget,
} from '../rapid/rapid-parser.ts'
import type { Pose } from '../robotics/types.ts'
import type { RapidEditCommand, RapidEditResult } from '../rapid/controlled-rapid-edit.ts'

const SOURCE = `
MODULE Demo
    CONST robtarget pApproach := [[551,613,60],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PERS robtarget p_work := [[551,613,25],[0,1,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ pApproach,v100,fine,tool0;
        MoveL p_work,v50,fine,tool0;
    ENDPROC
ENDMODULE
`

const DEFAULT_PARSED = parseRapidProgram(SOURCE)

const DEFAULT_POSE: Pose = {
  position: [451, 150, 680],
  euler: [0, 0, 0],
  rotation: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
}

const okEdit: (command: RapidEditCommand) => RapidEditResult = vi.fn((_command) => ({
  ok: true as const,
  result: { source: 'x' },
}))

function baseProps(overrides: {
  targets?: readonly RapidProgramDataTarget[]
  canExecute?: boolean
  program?: readonly RapidExecutableInstruction[]
  insertionPoints?: readonly RapidMotionInsertionPoint[]
  applyEdit?: (command: RapidEditCommand) => RapidEditResult
} = {}) {
  return {
    targets: overrides.targets ?? [],
    canExecute: overrides.canExecute ?? true,
    program: overrides.program ?? DEFAULT_PARSED.program,
    insertionPoints: overrides.insertionPoints ?? DEFAULT_PARSED.motionInsertionPoints,
    pose: DEFAULT_POSE,
    applyEdit: overrides.applyEdit ?? okEdit,
  }
}

function mountPanel(overrides: {
  targets?: readonly RapidProgramDataTarget[]
  canExecute?: boolean
} = {}) {
  return mount(ProgramDataPanel, { props: baseProps(overrides) })
}

function mountProgramData(targets: readonly RapidProgramDataTarget[]) {
  return mount(ProgramDataPanel, { props: baseProps({ targets }) })
}

describe('ProgramDataPanel 源码驱动的点位列表', () => {
  it('列出声明顺序的 robtarget，展示名称、存储、坐标与引用次数', () => {
    const result = parseRapidProgram(SOURCE)
    expect(result.data).toHaveLength(2)

    const wrapper = mount(ProgramDataPanel, {
      props: baseProps({ targets: result.data }),
    })
    const text = wrapper.text()
    expect(text).toContain('pApproach')
    expect(text).toContain('p_work')
    expect(text).toContain('551.0, 613.0, 60.0')
    expect(text).toContain('551.0, 613.0, 25.0')
    expect(text).toContain('const')
    expect(text).toContain('pers')
    expect(text).toContain('1 处引用')
  })

  it('有共享引用时显示引用次数，未引用时显示未被引用', () => {
    const shared = `
MODULE Demo
    CONST robtarget p1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,v100,fine,tool0;
        MoveL p1,v100,fine,tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(shared)
    expect(result.data[0].referenceRanges).toHaveLength(2)
    const wrapper = mountProgramData(result.data)
    expect(wrapper.text()).toContain('2 处引用')
    expect(wrapper.text()).toContain('行 5')
    expect(wrapper.text()).toContain('行 6')
  })

  it('源程序存在错误时仍展示已识别点位并提示禁用结构化操作', () => {
    const broken = `
MODULE Demo
    CONST robtarget p1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ missing,v100,fine,tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(broken)
    expect(result.canExecute).toBe(false)
    const wrapper = mount(ProgramDataPanel, {
      props: baseProps({ targets: result.data, canExecute: false }),
    })
    expect(wrapper.text()).toContain('p1')
    expect(wrapper.text()).toContain('含错误')
    expect(wrapper.text()).toContain('只读浏览')
  })

  it('没有声明 robtarget 时显示空态', () => {
    const wrapper = mountPanel({ targets: [] })
    expect(wrapper.text()).toContain('尚未声明 robtarget')
  })
})


describe('ProgramDataPanel 点位示教与编辑操作', () => {
  it('共享目标在示教前显示引用影响提示', () => {
    const shared = `
MODULE Demo
    CONST robtarget p1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,v100,fine,tool0;
        MoveL p1,v100,fine,tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(shared)
    const wrapper = mountProgramData(result.data)
    expect(wrapper.text()).toContain('共享目标：示教将影响 2 处引用')
  })

  it('新建点位从名称输入与当前 TCP 提交 create-target 命令', async () => {
    const captures: unknown[] = []
    const wrapper = mount(ProgramDataPanel, {
      props: {
        ...baseProps({ targets: [] }),
        applyEdit: (command) => {
          captures.push(command)
          return { ok: true, result: { source: 'x' } }
        },
      },
    })
    await wrapper.get('[aria-label="新点位名称"]').setValue('pPick')
    await wrapper.get('button').trigger('click')
    const command = captures[0] as { type: string; name: string; target: { trans: number[]; rot: number[]; robconf: number[]; extax: number[] } }
    expect(command).toMatchObject({ type: 'create-target', name: 'pPick' })
    // 值来自当前 TCP（DEFAULT_POSE 位置）。
    expect(command.target.trans).toEqual([451, 150, 680])
    expect(command.target.rot).toEqual([1, 0, 0, 0])
    expect(command.target.extax).toEqual([9e9, 9e9, 9e9, 9e9, 9e9, 9e9])
  })

  it('删除有引用目标时展示结构化拒绝原因', async () => {
    const denied: string[] = []
    const source = `
MODULE Demo
    CONST robtarget p1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,v100,fine,tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    const wrapper = mount(ProgramDataPanel, {
      props: {
        ...baseProps({ targets: result.data }),
        applyEdit: () => {
          denied.push('delete')
          return { ok: false, error: { code: 'target-referenced', message: 'robtarget p1 仍有 1 处引用，不能删除' } }
        },
      },
    })
    const deleteButton = wrapper.findAll('button').find((b) => b.text() === '删除')
    expect(deleteButton).toBeDefined()
    await deleteButton!.trigger('click')
    expect(denied).toHaveLength(1)
    expect(wrapper.text()).toContain('不能删除')
  })

  it('示教(Modify Position)、插入 MoveJ、插入 MoveL 分别提交对应命令', async () => {
    const captures: Array<{ type: string; name: string; kind?: string; insertionIndex?: number }> = []
    const target = parseRapidProgram(SOURCE).data[0]
    const wrapper = mount(ProgramDataPanel, {
      props: {
        ...baseProps({ targets: parseRapidProgram(SOURCE).data }),
        applyEdit: (command) => {
          captures.push(command as { type: string; name: string; kind?: string; insertionIndex?: number })
          return { ok: true, result: { source: 'x' } }
        },
      },
    })
    const buttons = wrapper.findAll('button')
    const modify = buttons.find((b) => b.text() === 'Modify Position（更新位置）')
    await modify!.trigger('click')
    expect(captures[0]).toMatchObject({ type: 'modify-position', name: target.name })

    const insertJ = buttons.find((b) => b.text() === '插入 MoveJ')
    await insertJ!.trigger('click')
    expect(captures[1]).toMatchObject({ type: 'insert-motion', kind: 'movej', name: target.name })
    expect(captures[1].insertionIndex).toBe(2)

    const insertL = buttons.find((b) => b.text() === '插入 MoveL')
    await insertL!.trigger('click')
    expect(captures[2]).toMatchObject({ type: 'insert-motion', kind: 'movel', name: target.name })
    expect(captures[2].insertionIndex).toBe(2)
  })

  it('重命名：输入新名称后提交 rename-target 命令', async () => {
    const target = parseRapidProgram(SOURCE).data[0]
    const captures: Array<{ type: string; name: string; newName: string }> = []
    const wrapper = mount(ProgramDataPanel, {
      props: {
        ...baseProps({ targets: parseRapidProgram(SOURCE).data }),
        applyEdit: (command) => {
          captures.push(command as { type: string; name: string; newName: string })
          return { ok: true, result: { source: 'x' } }
        },
      },
    })
    const renameButton = wrapper.findAll('button').find((b) => b.text() === '重命名')
    await renameButton!.trigger('click')
    await wrapper.get('[aria-label="重命名点位"]').setValue('pRenamed')
    const confirm = wrapper.findAll('button').find((b) => b.text() === '确认')
    await confirm!.trigger('click')
    expect(captures[0]).toMatchObject({ type: 'rename-target', name: target.name, newName: 'pRenamed' })
  })
})
