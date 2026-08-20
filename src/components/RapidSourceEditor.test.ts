// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RapidSourceEditor from './RapidSourceEditor.vue'
import type { EditorView } from '@codemirror/view'
import type {
  RapidExecutableInstruction,
  RapidConditionalInstruction,
} from '@/rapid/rapid-parser.ts'
import { defaultTool0, defaultWobj0, defaultZoneFine } from '@/rapid/rapid-types.ts'

const SOURCE = `MODULE Demo
    CONST robtarget p1 := [[500,100,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];

    PROC main()
        MoveJ p1,v200,fine,tool0;
    ENDPROC
ENDMODULE`

function instruction(line: number): RapidExecutableInstruction {
  return {
    kind: 'movej',
    target: {
      trans: [500, 100, 807.1],
      rot: [1, 0, 0, 0],
      robconf: [0, 0, 0, 0],
      extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
    },
    speed: { v_tcp: 200, v_ori: 500, v_leax: 5000, v_reax: 1000 },
    zone: defaultZoneFine(),
    tool: defaultTool0(),
    wobj: defaultWobj0(),
    sourceRange: {
      start: { offset: 0, line, column: 9 },
      end: { offset: 1, line, column: 40 },
    },
    sourceText: 'MoveJ p1,v200,fine,tool0;',
    operands: { target: 'p1', speed: 'v200', zone: 'fine', tool: 'tool0', wobj: 'wobj0' },
    operandRanges: {
      target: { start: { offset: 0, line, column: 1 }, end: { offset: 1, line, column: 3 } },
      speed: { start: { offset: 0, line, column: 4 }, end: { offset: 1, line, column: 8 } },
      zone: { start: { offset: 0, line, column: 9 }, end: { offset: 1, line, column: 13 } },
      tool: { start: { offset: 0, line, column: 14 }, end: { offset: 1, line, column: 19 } },
      wobj: null,
    },
  }
}

function mountEditor(
  overrides: {
    source?: string
    readonly?: boolean
    ppLine?: number | null
    mpLine?: number | null
    cursorLine?: number | null
    instruction?: RapidExecutableInstruction | null
  } = {},
) {
  return mount(RapidSourceEditor, {
    props: {
      source: overrides.source ?? SOURCE,
      readonly: overrides.readonly ?? false,
      ppLine: overrides.ppLine ?? null,
      mpLine: overrides.mpLine ?? null,
      cursorLine: overrides.cursorLine ?? null,
      instruction: overrides.instruction ?? null,
      diagnosticLines: [],
      runtimeErrorLine: null,
    },
  })
}

interface ExposedVm {
  getView(): EditorView | null
}

/** 取组件暴露的 EditorView；CodeMirror 更新在其事务处理后，等一个宏任务让 DOM/标记落定。 */
async function getView<T extends ExposedVm>(wrapper: ReturnType<typeof mountEditor>): Promise<EditorView> {
  const view = (wrapper.vm as unknown as T).getView()
  if (!view) throw new Error('CodeMirror view 尚未初始化')
  await new Promise((resolve) => setTimeout(resolve, 0))
  return view
}

/**
 * 主机里 CodeMirror 的行号 gutter 单元格列表（含类别 class）。
 * 过滤 jsdom 里第 0 高度、visibility:hidden 的测量占位元素——它不是真实行号。
 */
function gutterCells(wrapper: ReturnType<typeof mountEditor>): Array<{ line: number; classes: string }> {
  const host = wrapper.get('.rapid-codemirror').element
  return Array.from(host.querySelectorAll<HTMLElement>('.cm-gutterElement'))
    .filter((el) => el.style.visibility !== 'hidden')
    .map((el) => ({
      line: Number(el.textContent),
      classes: el.className,
    }))
}

describe('RapidSourceEditor（CodeMirror）行号 gutter', () => {
  it('渲染与源码行数一致的 gutter 行号', async () => {
    const wrapper = mountEditor()
    await getView(wrapper)
    expect(gutterCells(wrapper).length).toBe(SOURCE.split('\n').length)
  })

  it('PP/MP 行标记、同行 both 渐变', async () => {
    const wrapper = mountEditor({ ppLine: 5, mpLine: 6 })
    await getView(wrapper)
    let cells = gutterCells(wrapper)
    expect(cells.find((c) => c.line === 5)?.classes).toContain('pp-line')
    expect(cells.find((c) => c.line === 6)?.classes).toContain('mp-line')

    const both = mountEditor({ ppLine: 5, mpLine: 5 })
    await getView(both)
    cells = gutterCells(both)
    expect(cells.find((c) => c.line === 5)?.classes).toContain('both-line')
  })

  it('诊断与运行时错误行在 gutter 标记对应行', async () => {
    const wrapper = mountEditor()
    await wrapper.setProps({ diagnosticLines: [5], runtimeErrorLine: 6 })
    await getView(wrapper)
    const cells = gutterCells(wrapper)
    expect(cells.find((c) => c.line === 5)?.classes).toContain('diagnostic-line')
    expect(cells.find((c) => c.line === 6)?.classes).toContain('runtime-line')
  })

  it('光标行在 gutter 高亮，未知时不标记', async () => {
    const wrapper = mountEditor({ cursorLine: 5 })
    await getView(wrapper)
    expect(gutterCells(wrapper).find((c) => c.line === 5)?.classes).toContain('cursor-line')

    await wrapper.setProps({ cursorLine: null })
    await getView(wrapper)
    expect(gutterCells(wrapper).some((c) => c.classes.includes('cursor-line'))).toBe(false)
  })

  it('点击 gutter 行号把光标移到该行并上报（FlexPendant 点选行）', async () => {
    const wrapper = mountEditor()
    await getView(wrapper)
    const host = wrapper.get('.rapid-codemirror').element
    const cell = Array.from(host.querySelectorAll('.cm-gutterElement')).find(
      (el) => Number(el.textContent) === 5,
    ) as HTMLElement | undefined
    expect(cell).toBeTruthy()
    cell?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.emitted('cursor-line-change')?.at(-1)).toEqual([5])
  })

  it('编辑器只读（运行中）时点击 gutter 不移动光标', async () => {
    const wrapper = mountEditor({ readonly: true })
    const view = await getView(wrapper)
    const host = wrapper.get('.rapid-codemirror').element
    const cell = Array.from(host.querySelectorAll('.cm-gutterElement')).find(
      (el) => Number(el.textContent) === 5,
    ) as HTMLElement | undefined
    cell?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.emitted('cursor-line-change')).toBeUndefined()
    expect(view.state.readOnly).toBe(true)
  })

  it('运行期只读可切换：readOnly 状态随 prop 变化', async () => {
    const wrapper = mountEditor()
    let view = await getView(wrapper)
    expect(view.state.readOnly).toBe(false)
    await wrapper.setProps({ readonly: true })
    view = await getView(wrapper)
    expect(view.state.readOnly).toBe(true)
  })

  it('编辑发出 source-change', async () => {
    const wrapper = mountEditor()
    const view = await getView(wrapper)
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'MODULE X\nENDMODULE' } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.emitted('source-change')?.[0]).toEqual(['MODULE X\nENDMODULE'])
  })

  it('光标移动上报所在源码行', async () => {
    const wrapper = mountEditor()
    const view = await getView(wrapper)
    const doc = view.state.doc
    const pos = doc.line(5).from
    view.dispatch({ selection: { anchor: pos, head: pos } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.emitted('cursor-line-change')?.at(-1)).toEqual([5])
  })
})

describe('RapidSourceEditor 结构化指令摘要', () => {
  it('无活动指令时显示占位', () => {
    const wrapper = mountEditor()
    expect(wrapper.text()).toContain('无活动指令')
  })

  it('展示当前指令的指令类型与操作数原始名称', () => {
    const wrapper = mountEditor({ instruction: instruction(5) })
    const text = wrapper.text()
    expect(text).toContain('MoveJ')
    expect(text).toContain('p1')
    expect(text).toContain('v200')
    expect(text).toContain('fine')
    expect(text).toContain('tool0')
    expect(text).toContain('wobj0')
  })

  it('条件判断作为当前结构化指令显示 IF/ELSEIF 与源码条件，不读取运动字段', () => {
    const conditional: RapidConditionalInstruction = {
      kind: 'if',
      conditionKind: 'elseif',
      condition: {
        kind: 'bool-literal',
        value: true,
        range: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 4, line: 1, column: 5 },
        },
      },
      trueTarget: 1,
      falseTarget: 2,
      sourceRange: {
        start: { offset: 0, line: 5, column: 9 },
        end: { offset: 18, line: 5, column: 27 },
      },
      sourceText: 'ELSEIF ready THEN',
    }
    const wrapper = mountEditor({ instruction: conditional })
    expect(wrapper.get('[aria-label="当前结构化指令"]').text()).toContain('ELSEIF')
    expect(wrapper.get('[aria-label="当前结构化指令"]').text()).toContain('ELSEIF ready THEN')
  })
})
