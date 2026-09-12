// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProgramControlPanel from './ProgramControlPanel.vue'
import type { EditorView } from '@codemirror/view'
import type { ProgramSessionSnapshot } from '@/application/program/use-program-session.ts'

/** 取模具内 RapidSourceEditor 暴露的 EditorView（script-setup 的 exposed 在 $.exposed 下）。 */
function getEditorView(wrapper: ReturnType<typeof mount>): EditorView {
  const vm = wrapper.findComponent({ name: 'RapidSourceEditor' }).vm as unknown as {
    $: { exposed: { getView: () => EditorView | null } }
  }
  const view = vm.$.exposed.getView()
  if (!view) throw new Error('CodeMirror view 尚未初始化')
  return view
}

const SOURCE = 'MODULE Demo ENDMODULE'

function snapshot(overrides: Partial<ProgramSessionSnapshot> = {}): ProgramSessionSnapshot {
  return {
    state: 'idle',
    programPointer: 0,
    motionPointer: null,
    stopReason: null,
    error: null,
    variables: new Map(),
    diagnostics: [],
    needsPPtoMain: false,
    offPath: false,
    ...overrides,
  }
}

function mountPanel(value: ProgramSessionSnapshot, pendingClear: 'run' | 'step' | null = null) {
  return mount(ProgramControlPanel, {
    props: { snapshot: value, source: SOURCE, program: [], pendingClear },
  })
}

describe('ProgramControlPanel 按钮可用性与命令映射', () => {
  it('idle 时运行/单步/PP available，停止禁用；运行按钮发出 run', async () => {
    const wrapper = mountPanel(snapshot())
    const [run, step, stop, pp] = wrapper.findAll(
      '.program-control-footer > .program-actions > button',
    )
    expect(run.attributes('disabled')).toBeUndefined()
    expect(step.attributes('disabled')).toBeUndefined()
    expect(stop.attributes('disabled')).toBeDefined()
    expect(pp.attributes('disabled')).toBeUndefined()

    await run.trigger('click')
    expect(wrapper.emitted('run')).toHaveLength(1)
  })

  it('running 时只有停止可用，运行/单步/PP 禁用', () => {
    const wrapper = mountPanel(snapshot({ state: 'running', motionPointer: 0 }))
    const [run, step, stop, pp] = wrapper.findAll(
      '.program-control-footer > .program-actions > button',
    )
    expect(run.attributes('disabled')).toBeDefined()
    expect(step.attributes('disabled')).toBeDefined()
    expect(stop.attributes('disabled')).toBeUndefined()
    expect(pp.attributes('disabled')).toBeDefined()
  })

  it('stopped 时可继续运行/单步/PP to Main', async () => {
    const wrapper = mountPanel(snapshot({ state: 'stopped', programPointer: 2 }))
    const [run, step, stop, pp] = wrapper.findAll(
      '.program-control-footer > .program-actions > button',
    )
    expect(run.attributes('disabled')).toBeUndefined()
    expect(step.attributes('disabled')).toBeUndefined()
    expect(stop.attributes('disabled')).toBeDefined()
    expect(pp.attributes('disabled')).toBeUndefined()

    await step.trigger('click')
    expect(wrapper.emitted('step')).toHaveLength(1)
  })

  it('completed 后 PP to Main 可用，运行/单步禁用并可发出 pp', async () => {
    const wrapper = mountPanel(snapshot({ state: 'completed', programPointer: 3 }))
    const [run, , , pp] = wrapper.findAll('.program-control-footer > .program-actions > button')
    expect(run.attributes('disabled')).toBeDefined()
    expect(pp.attributes('disabled')).toBeUndefined()

    await pp.trigger('click')
    expect(wrapper.emitted('pp')).toHaveLength(1)
  })

  it('运行期间源码锁定，停止后可编辑', async () => {
    const running = mountPanel(snapshot({ state: 'running', motionPointer: 0 }))
    expect(running.findComponent({ name: 'RapidSourceEditor' }).props('readonly')).toBe(true)

    const stopped = mountPanel(snapshot({ state: 'stopped' }))
    expect(stopped.findComponent({ name: 'RapidSourceEditor' }).props('readonly')).toBe(false)
  })
})

describe('ProgramControlPanel 状态显示', () => {
  it('显示运行状态', () => {
    const wrapper = mountPanel(snapshot({ state: 'running', programPointer: 2, motionPointer: 2 }))
    expect(wrapper.text()).toContain('运行中')
  })

  it('程序快照条已移除（PP/MP 读数由顶栏 pill 承载）', () => {
    const wrapper = mountPanel(snapshot({ state: 'idle' }))
    expect(wrapper.text()).toContain('空闲')
    expect(wrapper.find('[aria-label="程序快照"]').exists()).toBe(false)
  })

  it('显示规划错误信息', () => {
    const wrapper = mountPanel(
      snapshot({
        state: 'error',
        error: { index: 1, code: 'unreachable', message: '目标不可达' },
      }),
    )
    expect(wrapper.text()).toContain('错误')
    expect(wrapper.get('.program-panel').text()).toContain('指令 1 · unreachable — 目标不可达')
  })

  it('编辑 RAPID 源程序发出 source-change', async () => {
    const idle = mountPanel(snapshot())
    const view = getEditorView(idle)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'MODULE Changed ENDMODULE' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(idle.emitted('source-change')?.[0]).toEqual(['MODULE Changed ENDMODULE'])
  })

  it('显示 RAPID 静态诊断的位置和代码', () => {
    const wrapper = mountPanel(
      snapshot({
        state: 'error',
        diagnostics: [
          {
            code: 'undefined-symbol',
            severity: 'error',
            message: '未定义 robtarget missing',
            range: {
              start: { offset: 10, line: 4, column: 15 },
              end: { offset: 17, line: 4, column: 22 },
            },
          },
        ],
      }),
    )

    expect(wrapper.get('[aria-label="RAPID 诊断"]').text()).toContain(
      '行 4 列 15 · undefined-symbol',
    )
    expect(wrapper.get('[aria-label="RAPID 诊断"]').text()).toContain('未定义 robtarget missing')
  })

  it('存在静态诊断时禁用运行与单步', () => {
    const wrapper = mountPanel(
      snapshot({
        diagnostics: [
          {
            code: 'syntax-error',
            severity: 'error',
            message: '缺少分号',
            range: {
              start: { offset: 1, line: 2, column: 1 },
              end: { offset: 2, line: 2, column: 2 },
            },
          },
        ],
      }),
    )
    const [run, step] = wrapper.findAll('.program-control-footer > .program-actions > button')
    expect(run.attributes('disabled')).toBeDefined()
    expect(step.attributes('disabled')).toBeDefined()
  })
})

describe('ProgramControlPanel 指令摘要条', () => {
  const LONG_SOURCE = Array.from({ length: 12 }, () => '').join('\n')

  function mountWithCursor(line: number | null) {
    return mount(ProgramControlPanel, {
      props: {
        snapshot: snapshot({ state: 'running', programPointer: 0, motionPointer: 0 }),
        source: LONG_SOURCE,
        program: programWith([5, 6], ['pHome', 'pWork']),
        pendingClear: null,
        cursorLine: line,
      },
    })
  }

  it('摘要跟随光标所在行而非程序指针', async () => {
    const wrapper = mountWithCursor(5)
    expect(wrapper.get('[aria-label="当前结构化指令"]').text()).toContain('pHome')

    await wrapper.setProps({ cursorLine: 6 })
    expect(wrapper.get('[aria-label="当前结构化指令"]').text()).toContain('pWork')
  })

  it('光标在无指令行时显示空态', () => {
    const wrapper = mountWithCursor(1)
    expect(wrapper.get('[aria-label="当前结构化指令"]').text()).toContain('无活动指令')
  })
})

describe('ProgramControlPanel 停止态 PP 与 off-path', () => {
  it('PP 无法映射时禁用运行与单步', () => {
    const wrapper = mountPanel(snapshot({ state: 'stopped', needsPPtoMain: true }))
    const [run, step] = wrapper.findAll('.program-control-footer > .program-actions > button')
    expect(run.attributes('disabled')).toBeDefined()
    expect(step.attributes('disabled')).toBeDefined()
  })

  it('off-path 时运行按钮仍可用以触发确认', () => {
    const wrapper = mountPanel(snapshot({ state: 'stopped', offPath: true }))
    const [run] = wrapper.findAll('.program-control-footer > .program-actions > button')
    expect(run.attributes('disabled')).toBeUndefined()
  })

  it('存在静态诊断时即使 idle 也不能运行', () => {
    const wrapper = mountPanel(
      snapshot({
        diagnostics: [
          {
            code: 'syntax-error',
            severity: 'error',
            message: '错误',
            range: {
              start: { offset: 0, line: 1, column: 1 },
              end: { offset: 1, line: 1, column: 2 },
            },
          },
        ],
      }),
    )
    expect(
      wrapper
        .findAll('.program-control-footer > .program-actions > button')[0]
        .attributes('disabled'),
    ).toBeDefined()
  })

  it('off-path 待确认时展示 Clear 确认并发出 confirm/取消事件', async () => {
    const wrapper = mountPanel(snapshot({ state: 'stopped', offPath: true }), 'run')
    const confirm = wrapper.get('[aria-label="偏离路径确认"]')
    expect(confirm.text()).toContain('从当前位置规划到下一目标')

    const confirmButton = confirm.findAll('button').find((b) => b.text() === '确认')
    await confirmButton!.trigger('click')
    expect(wrapper.emitted('confirm-clear')).toHaveLength(1)

    const cancelButton = confirm.findAll('button').find((b) => b.text() === '取消')
    await cancelButton!.trigger('click')
    expect(wrapper.emitted('cancel-clear')).toHaveLength(1)
  })
})

import type { RapidMotionInstruction } from '@/rapid/language/index.ts'
import { defaultTool0, defaultWobj0, defaultZoneFine } from '@/rapid/data/index.ts'

function programWith(lines: number[], operands: string[]): RapidMotionInstruction[] {
  return lines.map((line, index) => ({
    kind: 'movej' as const,
    target: {
      trans: [0, 0, 0],
      rot: [1, 0, 0, 0],
      robconf: [0, 0, 0, 0],
      extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
    },
    speed: { v_tcp: 200, v_ori: 500, v_leax: 5000, v_reax: 1000 },
    zone: defaultZoneFine(),
    tool: defaultTool0(),
    wobj: defaultWobj0(),
    sourceRange: { start: { offset: 0, line, column: 9 }, end: { offset: 1, line, column: 40 } },
    sourceText: `MoveJ p${index},v200,fine,tool0;`,
    operands: {
      target: operands[index],
      speed: 'v200',
      zone: 'fine',
      tool: 'tool0',
      wobj: 'wobj0',
    },
    operandRanges: {
      target: { start: { offset: 0, line, column: 9 }, end: { offset: 1, line, column: 10 } },
      speed: { start: { offset: 0, line, column: 11 }, end: { offset: 1, line, column: 14 } },
      zone: { start: { offset: 0, line, column: 15 }, end: { offset: 1, line, column: 19 } },
      tool: { start: { offset: 0, line, column: 20 }, end: { offset: 1, line, column: 25 } },
      wobj: null,
    },
  }))
}

describe('ProgramControlPanel PP/MP gutter 与结构化指令', () => {
  const LONG_SOURCE = Array.from({ length: 12 }, () => '').join('\n')

  it('PP 与 MP 按快照映射到对应源码行标记', () => {
    // 指令位于第 8、9、10 行；PP=1（第 9 行）、MP=1（同一行）。
    const program = programWith([8, 9, 10], ['pA', 'pB', 'pC'])
    const wrapper = mount(ProgramControlPanel, {
      props: {
        snapshot: snapshot({ state: 'running', programPointer: 1, motionPointer: 1 }),
        source: LONG_SOURCE,
        program,
        pendingClear: null,
      },
    })
    // CodeMirror gutter 单元格（过滤 jsdom 的隐藏测量占位元素）；第 9 行同时承载 PP 与 MP。
    const editor = wrapper.get('.rapid-codemirror').element
    const lines = Array.from(editor.querySelectorAll<HTMLElement>('.cm-gutterElement')).filter(
      (el) => el.style.visibility !== 'hidden',
    )
    const line9 = lines.find((el) => Number(el.textContent) === 9)
    expect(line9?.className).toContain('both-line')
  })

  it('摘要条显示光标行指令（光标优先于程序指针）', () => {
    const program = programWith([8, 9], ['pA', 'pB'])
    const wrapper = mount(ProgramControlPanel, {
      props: {
        snapshot: snapshot({ state: 'running', motionPointer: 0, programPointer: 0 }),
        source: LONG_SOURCE,
        program,
        pendingClear: null,
        cursorLine: 9,
      },
    })
    expect(wrapper.get('[aria-label="当前结构化指令"]').text()).toContain('pB')
  })

  it('空闲且无活动程序时摘要为空', () => {
    const wrapper = mountPanel(snapshot({ state: 'idle' }))
    expect(wrapper.get('[aria-label="当前结构化指令"]').text()).toContain('无活动指令')
  })

  it('活动指令使用非 fine（fly-by）zone 时显示未模拟路径融合提示（票据 04）', () => {
    const program = programWith([8], ['pA']).map((inst) => ({
      ...inst,
      zone: { ...inst.zone, finep: false },
      operands: { ...inst.operands, zone: 'z50' },
    }))
    const wrapper = mount(ProgramControlPanel, {
      props: {
        snapshot: snapshot({ state: 'running', programPointer: 0, motionPointer: 0 }),
        source: SOURCE,
        program,
        pendingClear: null,
      },
    })
    expect(wrapper.text()).toContain('z50')
    expect(wrapper.text()).toContain('fly-by')
    expect(wrapper.text()).toContain('未模拟')
  })

  it('活动指令用 fine 时提示 fly-by 未出现', () => {
    const program = programWith([8], ['pA'])
    const wrapper = mount(ProgramControlPanel, {
      props: {
        snapshot: snapshot({ state: 'running', programPointer: 0, motionPointer: 0 }),
        source: SOURCE,
        program,
        pendingClear: null,
      },
    })
    expect(wrapper.text()).not.toContain('fly-by')
  })
})
