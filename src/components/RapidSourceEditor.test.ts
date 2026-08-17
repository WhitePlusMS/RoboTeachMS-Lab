// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RapidSourceEditor from './RapidSourceEditor.vue'
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
    instruction?: RapidExecutableInstruction | null
  } = {},
) {
  return mount(RapidSourceEditor, {
    props: {
      source: overrides.source ?? SOURCE,
      readonly: overrides.readonly ?? false,
      ppLine: overrides.ppLine ?? null,
      mpLine: overrides.mpLine ?? null,
      instruction: overrides.instruction ?? null,
      diagnosticLines: [],
      runtimeErrorLine: null,
    },
  })
}

describe('RapidSourceEditor 行号 gutter', () => {
  it('渲染与源码行数一致的 gutter 行号', () => {
    const wrapper = mountEditor()
    expect(wrapper.findAll('.source-line')).toHaveLength(SOURCE.split('\n').length)
  })

  it('PP 行标记蓝色、MP 行标记橙色，同一行两者并存', () => {
    const wrapper = mountEditor({ ppLine: 5, mpLine: 6 })
    const lines = wrapper.findAll('.source-line')
    expect(lines[4].classes()).toContain('pp-line')
    expect(lines[5].classes()).toContain('mp-line')

    const both = mountEditor({ ppLine: 5, mpLine: 5 })
    const bothLines = both.findAll('.source-line')
    expect(bothLines[4].classes()).toContain('both-line')
  })

  it('parser 诊断和运行时错误分别在 gutter 标记对应行', async () => {
    const wrapper = mountEditor({})
    await wrapper.setProps({ diagnosticLines: [5], runtimeErrorLine: 6 })
    const lines = wrapper.findAll('.source-line')
    expect(lines[4].classes()).toContain('diagnostic-line')
    expect(lines[5].classes()).toContain('runtime-error-line')
  })

  it('编辑器只读时禁用 textarea', () => {
    const wrapper = mountEditor({ readonly: true })
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
  })

  it('编辑发出 source-change', async () => {
    const wrapper = mountEditor()
    await wrapper.get('textarea').setValue('MODULE X ENDMODULE')
    expect(wrapper.emitted('source-change')?.[0]).toEqual(['MODULE X ENDMODULE'])
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
