// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProgramWorkspace from './ProgramWorkspace.vue'
import { parseRapidProgram } from '@/rapid/rapid-parser.ts'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'
import type { Pose } from '@/robotics/types.ts'

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

describe('ProgramWorkspace 右侧 RAPID/Program Data 工作区', () => {
  it('默认显示 RAPID，切换 Program Data 时保留源码编辑器实例和固定程序控制栏', async () => {
    const wrapper = mount(ProgramWorkspace, {
      attachTo: document.body,
      props: {
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
      },
    })

    const editor = wrapper.get('textarea').element
    expect(wrapper.get('#program-tab-rapid').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('#program-panel-rapid').attributes('hidden')).toBeUndefined()
    expect(wrapper.get('[aria-label="程序控制栏"]')).toBeTruthy()

    await wrapper.get('#program-tab-data').trigger('click')
    expect(wrapper.get('#program-tab-data').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('#program-panel-rapid').attributes('hidden')).toBeDefined()
    expect(wrapper.get('#program-panel-data').attributes('hidden')).toBeUndefined()
    expect(wrapper.get('textarea').element).toBe(editor)
    expect(wrapper.get('[aria-label="程序控制栏"]')).toBeTruthy()
  })

  it('重复查看同一引用也会生成新的源码定位请求', async () => {
    const wrapper = mount(ProgramWorkspace, {
      attachTo: document.body,
      props: {
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
      },
    })

    await wrapper.get('#program-tab-data').trigger('click')
    await wrapper.get('[aria-label="选择点位 p1"]').trigger('click')
    const reference = wrapper.get('.program-data-reference-link')
    await reference.trigger('click')
    await wrapper.get('#program-tab-data').trigger('click')
    await wrapper.get('[aria-label="选择点位 p1"]').trigger('click')
    await wrapper.get('.program-data-reference-link').trigger('click')

    const rapidPanel = wrapper.get('#program-panel-rapid')
    expect(rapidPanel.attributes('hidden')).toBeUndefined()
    expect(rapidPanel.findComponent({ name: 'RapidSourceEditor' }).props('focusRequestId')).toBe(2)
  })

  it('方向键切换程序 Tab 后焦点跟随新 Tab', async () => {
    const wrapper = mount(ProgramWorkspace, {
      attachTo: document.body,
      props: {
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
      },
    })

    const rapidTab = wrapper.get('#program-tab-rapid')
    await rapidTab.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(wrapper.get('#program-tab-data').element)
    await wrapper.get('#program-tab-data').trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(rapidTab.element)
  })
})
