// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProgramDataReadonlyList from './ProgramDataReadonlyList.vue'
import {
  parseRapidProgram,
  type RapidProgramData,
} from '@/rapid/language/index.ts'
import type { RapidScalarVariable } from '@/rapid/data/index.ts'

const MULTI = `
MODULE Multi
    PERS tooldata tGrip := [TRUE,[[0,0,184],[1,0,0,0]],[0.5,[0,0,92],[1,0,0,0],1,2,3]];
    PERS wobjdata wTable := [FALSE,TRUE,"",[[100,0,0],[1,0,0,0]],[[0,0,0],[1,0,0,0]]];
    VAR speeddata vFast := [250,300,4000,800];
    CONST zonedata zEnd := [FALSE,100,150,150,15,150,15];
    VAR num cycleCount := 3;
    VAR bool ready := TRUE;
    CONST robtarget pA := [[551,613,25],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveL pA,vFast,zEnd,tGrip\\WObj:=wTable;
    ENDPROC
ENDMODULE
`

const parsed = parseRapidProgram(MULTI)

function baseProps(
  overrides: {
    data?: readonly RapidProgramData[]
    activeKind?: 'tooldata' | 'wobjdata' | 'speeddata' | 'zonedata' | 'loaddata' | 'num' | 'bool'
    runtimeValues?: ReadonlyMap<string, RapidScalarVariable>
    activeOperandNames?: { target: string; speed: string; zone: string; tool: string; wobj: string }
  } = {},
) {
  return {
    data: overrides.data ?? [],
    activeKind: overrides.activeKind ?? 'tooldata',
    runtimeValues: overrides.runtimeValues,
    activeOperandNames: overrides.activeOperandNames ?? { target: '', speed: '', zone: '', tool: '', wobj: '' },
  }
}

function mountList(
  overrides: {
    data?: readonly RapidProgramData[]
    activeKind?: 'tooldata' | 'wobjdata' | 'speeddata' | 'zonedata' | 'loaddata' | 'num' | 'bool'
    runtimeValues?: ReadonlyMap<string, RapidScalarVariable>
    activeOperandNames?: { target: string; speed: string; zone: string; tool: string; wobj: string }
  } = {},
) {
  return mount(ProgramDataReadonlyList, { props: baseProps(overrides) })
}

async function selectReadonly(
  wrapper: ReturnType<typeof mountList>,
  kind: string,
  name: string,
): Promise<void> {
  await wrapper.get(`[aria-label="选择 ${kind} ${name}"]`).trigger('click')
}

describe('ProgramDataReadonlyList — 五类数据浏览与只读', () => {
  it('零条目时展示占位提示', () => {
    const wrapper = mountList({ data: [], activeKind: 'tooldata' })
    expect(wrapper.text()).toContain('源码/系统中尚未声明 tooldata')
  })

  it('tooldata 列表：渲染名称/存储/关键字段/引用', () => {
    const wrapper = mountList({ data: parsed.data, activeKind: 'tooldata' })
    const list = wrapper.get('[aria-label="tooldata 数据列表"]')
    expect(list.text()).toContain('tGrip')
    expect(list.text()).toContain('pers')
    expect(list.text()).toContain('0.0, 0.0, 184.0')
    expect(list.text()).toContain('1 处引用')
  })

  it('选中条目：展开详情（ABB 字段），无写操作按钮', async () => {
    const wrapper = mountList({ data: parsed.data, activeKind: 'tooldata' })
    await selectReadonly(wrapper, 'tooldata', 'tGrip')
    const detail = wrapper.get('[aria-label="tooldata 详情"]')
    expect(detail.text()).toContain('0.5')
    expect(detail.text()).toContain('tload.cog')
    expect(detail.text()).toContain('0.0, 0.0, 92.0')
    expect(detail.text()).toContain('1 处引用')
    // 无任何写操作按钮（Modify Position / 删除 等）。
    expect(wrapper.findAll('button').every((b) => !b.text().includes('Modify Position'))).toBe(true)
    expect(wrapper.findAll('button').every((b) => b.text() !== '删除')).toBe(true)
  })

  it('wobjdata 列表与详情展开', async () => {
    const wrapper = mountList({ data: parsed.data, activeKind: 'wobjdata' })
    const list = wrapper.get('[aria-label="wobjdata 数据列表"]')
    expect(list.text()).toContain('wTable')
    expect(list.text()).toContain('100.0, 0.0, 0.0')
    await selectReadonly(wrapper, 'wobjdata', 'wTable')
    const detail = wrapper.get('[aria-label="wobjdata 详情"]')
    expect(detail.text()).toContain('ufprog')
    expect(detail.text()).toContain('uframe.trans')
  })

  it('speeddata 列表与详情展开', async () => {
    const wrapper = mountList({ data: parsed.data, activeKind: 'speeddata' })
    const list = wrapper.get('[aria-label="speeddata 数据列表"]')
    expect(list.text()).toContain('vFast')
    expect(list.text()).toContain('250 mm/s')
    await selectReadonly(wrapper, 'speeddata', 'vFast')
    const detail = wrapper.get('[aria-label="speeddata 详情"]')
    expect(detail.text()).toContain('v_tcp')
    expect(detail.text()).toContain('250 mm/s')
  })

  it('zonedata 列表与详情展开', async () => {
    const wrapper = mountList({ data: parsed.data, activeKind: 'zonedata' })
    const list = wrapper.get('[aria-label="zonedata 数据列表"]')
    expect(list.text()).toContain('zEnd')
    expect(list.text()).toContain('100 mm')
    await selectReadonly(wrapper, 'zonedata', 'zEnd')
    const detail = wrapper.get('[aria-label="zonedata 详情"]')
    expect(detail.text()).toContain('finep')
    expect(detail.text()).toContain('pzone_tcp')
  })

  it('系统预定义项（tool0/z50/v100）显示只读标记与系统分节头', async () => {
    const wrapper = mountList({ data: parsed.data, activeKind: 'speeddata' })
    // 官方 speed（如 v100）应在列表中，分节头「系统预定义 · 只读」。
    expect(wrapper.text()).toContain('系统预定义 · 只读')
    expect(wrapper.get('[aria-label="speeddata 数据列表"]').text()).toContain('v100')
    await selectReadonly(wrapper, 'speeddata', 'v100')
    const detail = wrapper.get('[aria-label="speeddata 详情"]')
    expect(detail.text()).toContain('系统预定义 · 只读')
  })

  it('num Tab 展示声明类型、VAR 存储类别、声明初值和当前运行值', async () => {
    const runtimeValues = new Map<string, RapidScalarVariable>([
      ['cyclecount', { kind: 'num', value: 8 }],
    ])
    const wrapper = mountList({ data: parsed.data, activeKind: 'num', runtimeValues })
    const list = wrapper.get('[aria-label="num 数据列表"]')
    expect(list.text()).toContain('cycleCount')
    expect(list.text()).toContain('var')
    expect(list.text()).toContain('初值 3')
    expect(list.text()).toContain('当前 8')
    await selectReadonly(wrapper, 'num', 'cycleCount')
    const detail = wrapper.get('[aria-label="num 详情"]')
    expect(detail.text()).toContain('类型')
    expect(detail.text()).toContain('num')
    expect(detail.text()).toContain('初值')
    expect(detail.text()).toContain('3')
    expect(detail.text()).toContain('当前值')
    expect(detail.text()).toContain('8')
  })

  it('bool Tab 展示声明类型、初值和当前运行值', async () => {
    const runtimeValues = new Map<string, RapidScalarVariable>([
      ['ready', { kind: 'bool', value: false }],
    ])
    const wrapper = mountList({ data: parsed.data, activeKind: 'bool', runtimeValues })
    const list = wrapper.get('[aria-label="bool 数据列表"]')
    expect(list.text()).toContain('ready')
    expect(list.text()).toContain('TRUE')
    expect(list.text()).toContain('当前 FALSE')
  })

  it('activeOperandNames 高亮当前指令使用的条目（如 zEnd）', () => {
    const wrapper = mountList({
      data: parsed.data,
      activeKind: 'zonedata',
      activeOperandNames: { target: 'pA', speed: 'vFast', zone: 'zEnd', tool: 'tGrip', wobj: 'wTable' },
    })
    const zEndRow = wrapper.findAll('.program-data-item').find((li) => li.text().includes('zEnd'))
    expect(zEndRow?.classes()).toContain('active')
  })

  it('查看引用：点击引用链接 emit view-reference', async () => {
    const wrapper = mountList({ data: parsed.data, activeKind: 'tooldata' })
    await selectReadonly(wrapper, 'tooldata', 'tGrip')
    const refLink = wrapper.get('.program-data-reference-link')
    await refLink.trigger('click')
    const emitted = wrapper.emitted('view-reference')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toHaveProperty('start')
  })
})
