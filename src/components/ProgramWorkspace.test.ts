// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProgramWorkspace from './ProgramWorkspace.vue'
import { parseRapidProgram } from '@/rapid/rapid-parser.ts'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'
import type { Pose } from '@/robotics/types.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/controlled-rapid-edit.ts'

const SOURCE = `MODULE Demo
    CONST robtarget p1 := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,v100,fine,tool0;
    ENDPROC
ENDMODULE`
const parsed = parseRapidProgram(SOURCE)
const pose: Pose = {
  position: [451, 0, 807.1],
  euler: [0, 0, 0],
  rotation: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
}
const snapshot: ProgramControllerSnapshot = {
  state: 'idle',
  programPointer: 0,
  motionPointer: null,
  stopReason: null,
  error: null,
  variables: new Map(),
  diagnostics: [],
  needsPPtoMain: false,
  offPath: false,
}

function mountWorkspace(view: 'rapid' | 'data', selectedTargetName: string | null = null) {
  return mount(ProgramWorkspace, {
    attachTo: document.body,
    props: {
      view,
      snapshot,
      source: SOURCE,
      program: parsed.program,
      pendingClear: null,
      data: parsed.data,
      activeIndex: null,
      canExecute: true,
      insertionPoints: parsed.motionInsertionPoints,
      pose,
      applyEdit: () => ({ ok: true, result: { source: SOURCE } }),
      selectedTargetName,
    },
  })
}

describe('ProgramWorkspace 受控视图的 RAPID/Program Data 工作区', () => {
  it('由 view prop 驱动切换，切换时保留源码编辑器实例，且无内部页签与固定控制栏', async () => {
    const wrapper = mountWorkspace('rapid')

    const editor = wrapper.get('textarea').element
    expect(wrapper.get('#program-panel-rapid').attributes('hidden')).toBeUndefined()
    expect(wrapper.get('#program-panel-data').attributes('hidden')).toBeDefined()
    // 内部 tab strip 与固定 actions 实例已移除（运行控制移到顶栏 transport）。
    expect(wrapper.find('#program-tab-rapid').exists()).toBe(false)
    expect(wrapper.find('[aria-label="程序控制栏"]').exists()).toBe(false)
    // RAPID 面板显示添加指令工具栏，Program Data 面板不显示。
    expect(wrapper.get('#program-panel-rapid').find('[aria-label="添加运动指令"]').exists()).toBe(
      true,
    )

    await wrapper.setProps({ view: 'data' })
    expect(wrapper.get('#program-panel-rapid').attributes('hidden')).toBeDefined()
    expect(wrapper.get('#program-panel-data').attributes('hidden')).toBeUndefined()
    expect(wrapper.get('textarea').element).toBe(editor)
    expect(wrapper.get('#program-panel-data').find('[aria-label="添加运动指令"]').exists()).toBe(
      false,
    )
  })

  it('查看引用会请求切回 RAPID 视图并生成新的源码定位请求', async () => {
    const wrapper = mountWorkspace('data', 'p1')

    await wrapper.get('.program-data-reference-link').trigger('click')

    expect(wrapper.emitted('update:view')).toEqual([['rapid']])
    const rapidPanel = wrapper.get('#program-panel-rapid')
    expect(rapidPanel.findComponent({ name: 'RapidSourceEditor' }).props('focusRequestId')).toBe(1)

    // 重复查看同一引用也会生成新的定位请求。
    await wrapper.get('.program-data-reference-link').trigger('click')
    expect(wrapper.emitted('update:view')).toEqual([['rapid'], ['rapid']])
    expect(rapidPanel.findComponent({ name: 'RapidSourceEditor' }).props('focusRequestId')).toBe(2)
  })

  it('独立挂载时点击 robtarget 通过回退控制器更新选中态', async () => {
    const wrapper = mountWorkspace('data')

    await wrapper.get('[aria-label="选择点位 p1"]').trigger('click')
    const panel = wrapper.findComponent({ name: 'ProgramDataPanel' })
    expect(panel.props('selectedTargetName')).toBe('p1')

    // 再次点击同一项折叠。
    await wrapper.get('[aria-label="选择点位 p1"]').trigger('click')
    expect(panel.props('selectedTargetName')).toBeNull()
  })

  it('鼠标点击编辑器某行后添加 MoveJ 插在光标行之后，而非 PP 之后（回归）', async () => {
    // 该程序含两段运动：行 5 MoveJ p1、行 6 MoveL p2。
    const twoMotion = `MODULE Demo
    CONST robtarget p1 := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget p2 := [[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,v100,fine,tool0;
        MoveL p2,v100,fine,tool0;
    ENDPROC
ENDMODULE`
    const twoParsed = parseRapidProgram(twoMotion)
    const commands: RapidEditCommand[] = []
    const applyEdit = (command: RapidEditCommand): RapidEditResult => {
      commands.push(command)
      return { ok: true, result: { source: twoMotion } }
    }

    const wrapper = mount(ProgramWorkspace, {
      attachTo: document.body,
      props: {
        view: 'rapid',
        snapshot: { ...snapshot, programPointer: 0 },
        source: twoMotion,
        program: twoParsed.program,
        pendingClear: null,
        data: twoParsed.data,
        activeIndex: null,
        canExecute: true,
        insertionPoints: twoParsed.motionInsertionPoints,
        pose,
        applyEdit,
        selectedTargetName: null,
      },
    })

    // 模拟鼠标点选第二段运动语句行（行 6）。
    const textarea = wrapper.get('textarea').element as HTMLTextAreaElement
    const lines = twoMotion.split('\n')
    const offsetOfLine6 = lines.slice(0, 5).join('\n').length + 1
    textarea.selectionStart = textarea.selectionEnd = offsetOfLine6
    await textarea.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()

    // 光标行已生效：应插到行 6 之后（程序末尾 index 2），而不回退到 PP 之后（index 1）。
    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ type: 'insert-motion', kind: 'movej', insertionIndex: 2 })
  })

  it('从未点击编辑器时添加 MoveJ 回退到 PP 之后（保持既有语义）', async () => {
    const commands: RapidEditCommand[] = []
    const applyEdit = (command: RapidEditCommand): RapidEditResult => {
      commands.push(command)
      return { ok: true, result: { source: SOURCE } }
    }

    const wrapper = mount(ProgramWorkspace, {
      attachTo: document.body,
      props: {
        view: 'rapid',
        snapshot,
        source: SOURCE,
        program: parsed.program,
        pendingClear: null,
        data: parsed.data,
        activeIndex: null,
        canExecute: true,
        insertionPoints: parsed.motionInsertionPoints,
        pose,
        applyEdit,
        selectedTargetName: null,
      },
    })

    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')
    expect(commands).toHaveLength(1)
    // PP 为第 1 条指令（index 0），回退时插到其后 index 1。
    expect(commands[0]).toMatchObject({ type: 'insert-motion', kind: 'movej', insertionIndex: 1 })
  })
})
