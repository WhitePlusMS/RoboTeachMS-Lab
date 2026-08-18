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

function mountWorkspace(view: 'rapid' | 'data') {
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

    await wrapper.setProps({ view: 'data' })
    expect(wrapper.get('#program-panel-rapid').attributes('hidden')).toBeDefined()
    expect(wrapper.get('#program-panel-data').attributes('hidden')).toBeUndefined()
    expect(wrapper.get('textarea').element).toBe(editor)
  })

  it('查看引用会请求切回 RAPID 视图并生成新的源码定位请求', async () => {
    const wrapper = mountWorkspace('data')

    await wrapper.get('[aria-label="选择点位 p1"]').trigger('click')
    await wrapper.get('.program-data-reference-link').trigger('click')

    expect(wrapper.emitted('update:view')).toEqual([['rapid']])
    const rapidPanel = wrapper.get('#program-panel-rapid')
    expect(rapidPanel.findComponent({ name: 'RapidSourceEditor' }).props('focusRequestId')).toBe(1)

    // 重复查看同一引用也会生成新的定位请求。
    await wrapper.get('[aria-label="选择点位 p1"]').trigger('click')
    await wrapper.get('.program-data-reference-link').trigger('click')
    expect(wrapper.emitted('update:view')).toEqual([['rapid'], ['rapid']])
    expect(rapidPanel.findComponent({ name: 'RapidSourceEditor' }).props('focusRequestId')).toBe(2)
  })
})
