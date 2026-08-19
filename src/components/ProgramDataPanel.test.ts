// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProgramDataPanel from './ProgramDataPanel.vue'
import {
  parseRapidProgram,
  type RapidExecutableInstruction,
  type RapidProgramData,
} from '@/rapid/rapid-parser.ts'
import type { Pose } from '@/robotics/types.ts'
import type { RapidScalarVariable } from '@/rapid/rapid-types.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/controlled-rapid-edit.ts'

const SOURCE = `
MODULE Demo
    CONST robtarget pApproach := [[551,613,60],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PERS robtarget p_work := [[551,613,25],[0,1,0,0],[1,-1,0,1],[1,2,3,4,5,6]];
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

function baseProps(
  overrides: {
    data?: readonly RapidProgramData[]
    activeIndex?: number | null
    canExecute?: boolean
    program?: readonly RapidExecutableInstruction[]
    runtimeValues?: ReadonlyMap<string, RapidScalarVariable>
    applyEdit?: (command: RapidEditCommand) => RapidEditResult
    selectedTargetName?: string | null
  } = {},
) {
  return {
    data: overrides.data ?? [],
    activeIndex: overrides.activeIndex ?? null,
    canExecute: overrides.canExecute ?? true,
    program: overrides.program ?? DEFAULT_PARSED.program,
    runtimeValues: overrides.runtimeValues,
    pose: DEFAULT_POSE,
    applyEdit: overrides.applyEdit ?? okEdit,
    selectedTargetName: overrides.selectedTargetName,
  }
}

function mountPanel(
  overrides: {
    data?: readonly RapidProgramData[]
    activeIndex?: number | null
    canExecute?: boolean
    program?: readonly RapidExecutableInstruction[]
    runtimeValues?: ReadonlyMap<string, RapidScalarVariable>
    applyEdit?: (command: RapidEditCommand) => RapidEditResult
  } = {},
) {
  return mount(ProgramDataPanel, { props: baseProps(overrides) })
}

async function selectTarget(wrapper: ReturnType<typeof mountPanel>, name: string): Promise<void> {
  await wrapper.get(`[aria-label="选择点位 ${name}"]`).trigger('click')
  await wrapper.setProps({ selectedTargetName: name })
}

async function selectReadonly(
  wrapper: ReturnType<typeof mountPanel>,
  kind: string,
  name: string,
): Promise<void> {
  await wrapper.get(`[aria-label="选择 ${kind} ${name}"]`).trigger('click')
}

describe('ProgramDataPanel ABB 式 robtarget 列表', () => {
  it('显示连续目标列表、类型计数和名称筛选，选中后在行内展开', async () => {
    const result = parseRapidProgram(SOURCE)
    const wrapper = mountPanel({ data: result.data })

    expect(wrapper.get('.program-data-type-count').text()).toContain('robtarget · 2 项')
    expect(wrapper.get('[aria-label="robtarget 点位列表"]').text()).toContain('pApproach')

    await wrapper.get('[aria-label="按名称筛选点位"]').setValue('work')
    expect(wrapper.get('[aria-label="robtarget 点位列表"]').text()).toContain('p_work')
    expect(wrapper.get('[aria-label="robtarget 点位列表"]').text()).not.toContain('pApproach')

    await wrapper.get('[aria-label="按名称筛选点位"]').setValue('')
    await selectTarget(wrapper, 'pApproach')
    expect(wrapper.get('[aria-label="选中点位详情"]').text()).toContain(
      'Modify Position（更新位置）',
    )
    expect(wrapper.get('[aria-label="选中点位详情"]').text()).toContain('1 处引用')

    // 再次点击同一行折叠。
    await wrapper.get('[aria-label="选择点位 pApproach"]').trigger('click')
    await wrapper.setProps({ selectedTargetName: null })
    expect(wrapper.findAll('[aria-label="选中点位详情"]')).toHaveLength(0)
  })

  it('共享引用在选中行内显示引用行，并可发出源码定位事件', async () => {
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
    const wrapper = mountPanel({ data: result.data })
    await selectTarget(wrapper, 'p1')

    expect(wrapper.get('[aria-label="选中点位详情"]').text()).toContain(
      '共享目标：示教将影响 2 处引用',
    )
    const references = wrapper.findAll('.program-data-reference-link')
    expect(references).toHaveLength(2)
    await references[0].trigger('click')
    expect(wrapper.emitted('view-reference')?.[0]?.[0]).toMatchObject({ start: { line: 5 } })
  })

  it('源程序存在错误时可浏览但禁用所有结构化写操作', async () => {
    const broken = `
MODULE Demo
    CONST robtarget p1 := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ missing,v100,fine,tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(broken)
    const wrapper = mountPanel({ data: result.data, canExecute: false })
    expect(wrapper.text()).toContain('p1')
    expect(wrapper.text()).toContain('含错误')
    expect(wrapper.text()).toContain('只读浏览')

    await selectTarget(wrapper, 'p1')
    expect(wrapper.find('.program-data-inline-actions').exists()).toBe(false)
  })

  it('没有声明 robtarget 时显示空态，筛选无结果时显示不同空态', async () => {
    const wrapper = mountPanel({ data: [] })
    expect(wrapper.text()).toContain('尚未声明 robtarget')

    const populated = mountPanel({ data: DEFAULT_PARSED.data })
    await populated.get('[aria-label="按名称筛选点位"]').setValue('missing')
    expect(populated.text()).toContain('没有匹配的点位')
  })
})

describe('ProgramDataPanel 点位详情与受控编辑', () => {
  it('新建点位以默认值（非当前 TCP）提交 create-target 命令', async () => {
    const captures: unknown[] = []
    const wrapper = mountPanel({
      applyEdit: (command) => {
        captures.push(command)
        return { ok: true, result: { source: 'x' } }
      },
    })
    await wrapper.get('[aria-label="新点位名称"]').setValue('pPick')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '新建点位')!
      .trigger('click')

    const command = captures[0] as {
      type: string
      name: string
      target: { trans: number[]; rot: number[]; extax: number[] }
    }
    expect(command).toMatchObject({ type: 'create-target', name: 'pPick' })
    // FlexPendant 式默认值：trans 全零、单位四元数、零 robconf、9E9 外轴（位置用 Modify Position 录入）。
    expect(command.target.trans).toEqual([0, 0, 0])
    expect(command.target.rot).toEqual([1, 0, 0, 0])
    expect(command.target.extax).toEqual([9e9, 9e9, 9e9, 9e9, 9e9, 9e9])
  })

  it('选中目标后行内显示字段和 Modify Position、编辑位置、重命名、删除', async () => {
    const wrapper = mountPanel({ data: DEFAULT_PARSED.data })
    await selectTarget(wrapper, 'pApproach')

    expect(wrapper.get('[aria-label="选中点位详情"]').text()).toContain('当前 MVP 未模拟构型控制')
    expect(wrapper.get('[aria-label="选中点位详情"]').text()).toContain('551.0, 613.0, 60.0')
    expect(wrapper.findAll('button').some((button) => button.text() === '编辑位置')).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text() === '重命名')).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text() === '删除')).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text() === '返回列表')).toBe(false)
  })

  it('Modify Position 提交当前 TCP 的完整姿态', async () => {
    const captures: Array<{ type: string; name: string; target: { trans: number[] } }> = []
    const wrapper = mountPanel({
      data: DEFAULT_PARSED.data,
      applyEdit: (command) => {
        captures.push(command as (typeof captures)[number])
        return { ok: true, result: { source: 'x' } }
      },
    })
    await selectTarget(wrapper, 'pApproach')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Modify Position（更新位置）')!
      .trigger('click')

    expect(captures[0]).toMatchObject({ type: 'modify-position', name: 'pApproach' })
    expect(captures[0].target.trans).toEqual([451, 150, 680])
  })

  it('编辑位置只修改 trans，rot/robconf/extax 保持', async () => {
    const captures: Array<{
      type: string
      name: string
      target: { trans: number[]; rot: number[]; robconf: number[]; extax: number[] }
    }> = []
    const wrapper = mountPanel({
      data: DEFAULT_PARSED.data,
      applyEdit: (command) => {
        captures.push(command as (typeof captures)[number])
        return { ok: true, result: { source: 'x' } }
      },
    })
    await selectTarget(wrapper, 'p_work')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '编辑位置')!
      .trigger('click')
    await wrapper.get('[aria-label="X"]').setValue('111')
    await wrapper.get('[aria-label="Y"]').setValue('222')
    await wrapper.get('[aria-label="Z"]').setValue('333')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认')!
      .trigger('click')

    expect(captures[0]).toMatchObject({ type: 'modify-position', name: 'p_work' })
    expect(captures[0].target.trans).toEqual([111, 222, 333])
    expect(captures[0].target.rot).toEqual([0, 1, 0, 0])
    expect(captures[0].target.robconf).toEqual([1, -1, 0, 1])
    expect(captures[0].target.extax).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('空值、NaN、Infinity 不提交编辑位置', async () => {
    const applyEdit = vi.fn((_command: RapidEditCommand) => ({
      ok: true as const,
      result: { source: 'x' },
    }))
    const wrapper = mountPanel({ data: DEFAULT_PARSED.data, applyEdit })
    await selectTarget(wrapper, 'pApproach')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '编辑位置')!
      .trigger('click')
    await wrapper.get('[aria-label="X"]').setValue('')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认')!
      .trigger('click')

    expect(applyEdit).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('不能为空')
  })

  it('重命名提交对应受控命令', async () => {
    const captures: Array<{ type: string; name: string; newName?: string }> = []
    const wrapper = mount(ProgramDataPanel, {
      props: baseProps({
        data: DEFAULT_PARSED.data,
        applyEdit: (command) => {
          captures.push(command as (typeof captures)[number])
          return { ok: true, result: { source: 'x' } }
        },
      }),
    })
    await selectTarget(wrapper, 'pApproach')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重命名')!
      .trigger('click')
    await wrapper.get('[aria-label="重命名点位"]').setValue('pRenamed')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认重命名')!
      .trigger('click')

    expect(captures[0]).toMatchObject({
      type: 'rename-target',
      name: 'pApproach',
      newName: 'pRenamed',
    })
  })

  it('受控删除被拒绝时保留展开和结构化错误（二次确认后提交）', async () => {
    const wrapper = mountPanel({
      data: DEFAULT_PARSED.data,
      applyEdit: () => ({
        ok: false,
        error: {
          code: 'target-referenced',
          message: 'robtarget pApproach 仍有 1 处引用，不能删除',
        },
      }),
    })
    await selectTarget(wrapper, 'pApproach')
    // 第一次点击仅进入确认态，不提交删除。
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '删除')!
      .trigger('click')
    expect(wrapper.text()).not.toContain('不能删除')
    // 再次点击确认才真正提交受控删除。
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认删除？')!
      .trigger('click')
    expect(wrapper.text()).toContain('不能删除')
    expect(wrapper.findAll('[aria-label="选中点位详情"]')).toHaveLength(1)
  })

  it('选中/清空时发出 select-target 事件，自身不保存第二份名称', async () => {
    const wrapper = mountPanel({ data: DEFAULT_PARSED.data })
    await wrapper.get('[aria-label="选择点位 pApproach"]').trigger('click')
    expect(wrapper.emitted('select-target')).toEqual([['pApproach']])

    // 模拟父级更新受控 prop 后再次点击同一行，应发出清空事件。
    await wrapper.setProps({ selectedTargetName: 'pApproach' })
    await wrapper.get('[aria-label="选择点位 pApproach"]').trigger('click')
    expect(wrapper.emitted('select-target')).toEqual([['pApproach'], [null]])
  })

  it('重命名成功后立即发出 select-target(newName)，保持高亮不闪失', async () => {
    const wrapper = mount(ProgramDataPanel, {
      props: baseProps({
        data: DEFAULT_PARSED.data,
        selectedTargetName: 'pApproach',
        applyEdit: () => ({ ok: true, result: { source: 'x' } }),
      }),
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重命名')!
      .trigger('click')
    await wrapper.get('[aria-label="重命名点位"]').setValue('pRenamed')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '确认重命名')!
      .trigger('click')

    expect(wrapper.emitted('select-target')).toEqual([['pRenamed']])
  })
})

describe('ProgramDataPanel Ticket 05 — 五类数据浏览与只读', () => {
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

  it('默认 robtarget Tab 并可在各数据类型 Tab 间切换浏览', async () => {
    const wrapper = mountPanel({ data: parsed.data })
    // 默认 robtarget 列表。
    expect(wrapper.get('[aria-label="robtarget 点位列表"]').text()).toContain('pA')
    // 切到 tooldata。
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('tooldata'))!
      .trigger('click')
    expect(wrapper.get('[aria-label="tooldata 数据列表"]').text()).toContain('tGrip')
    // 切到 wobjdata。
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('wobjdata'))!
      .trigger('click')
    expect(wrapper.get('[aria-label="wobjdata 数据列表"]').text()).toContain('wTable')
    // 切到 speeddata。
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('speeddata'))!
      .trigger('click')
    expect(wrapper.get('[aria-label="speeddata 数据列表"]').text()).toContain('vFast')
    // 切到 zonedata。
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('zonedata'))!
      .trigger('click')
    expect(wrapper.get('[aria-label="zonedata 数据列表"]').text()).toContain('zEnd')
  })

  it('非 robtarget 数据只读：无 Modify Position / 删除等写操作', async () => {
    const wrapper = mountPanel({ data: parsed.data, canExecute: true })
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('tooldata'))!
      .trigger('click')
    await selectReadonly(wrapper, 'tooldata', 'tGrip')
    // 只读详情展示 ABB 字段。
    expect(wrapper.get('[aria-label="tooldata 详情"]').text()).toContain('0.5')
    expect(wrapper.get('[aria-label="tooldata 详情"]').text()).toContain('tload.cog')
    // 没有任何写操作按钮（Modify Position / 删除 / 新建点位）。
    expect(wrapper.text()).not.toContain('Modify Position')
    expect(wrapper.findAll('button').some((b) => b.text() === '删除')).toBe(false)
    expect(wrapper.text()).not.toContain('新建点位')
  })

  it('系统预定义项（tool0/z50/v100）显示只读标记', async () => {
    const wrapper = mountPanel({ data: parsed.data })
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('speeddata'))!
      .trigger('click')
    // 官方 speed（如 v100）应在列表中。
    expect(wrapper.get('[aria-label="speeddata 数据列表"]').text()).toContain('v100')
    await selectReadonly(wrapper, 'speeddata', 'v100')
    expect(wrapper.get('[aria-label="speeddata 详情"]').text()).toContain('系统预定义')
  })

  it('num/bool Tab 展示声明类型、VAR 存储类别、声明初值和当前运行值', async () => {
    const runtimeValues = new Map<string, RapidScalarVariable>([
      ['cyclecount', { kind: 'num', value: 8 }],
      ['ready', { kind: 'bool', value: false }],
    ])
    const wrapper = mountPanel({ data: parsed.data, runtimeValues })

    await wrapper
      .findAll('.program-data-kind-tab')
      .find((button) => button.text().includes('num'))!
      .trigger('click')
    expect(wrapper.get('[aria-label="num 数据列表"]').text()).toContain('cycleCount')
    expect(wrapper.get('[aria-label="num 数据列表"]').text()).toContain('var')
    expect(wrapper.get('[aria-label="num 数据列表"]').text()).toContain('3')
    expect(wrapper.get('[aria-label="num 数据列表"]').text()).toContain('当前 8')
    await selectReadonly(wrapper, 'num', 'cycleCount')
    expect(wrapper.get('[aria-label="num 详情"]').text()).toContain('类型num')
    expect(wrapper.get('[aria-label="num 详情"]').text()).toContain('初值3')
    expect(wrapper.get('[aria-label="num 详情"]').text()).toContain('当前值8')

    await wrapper
      .findAll('.program-data-kind-tab')
      .find((button) => button.text().includes('bool'))!
      .trigger('click')
    expect(wrapper.get('[aria-label="bool 数据列表"]').text()).toContain('ready')
    expect(wrapper.get('[aria-label="bool 数据列表"]').text()).toContain('TRUE')
    expect(wrapper.get('[aria-label="bool 数据列表"]').text()).toContain('当前 FALSE')
  })

  it('当前指令高亮并提示 fly-by（zEnd 非 fine）', async () => {
    const wrapper = mountPanel({ data: parsed.data, program: parsed.program, activeIndex: 0 })
    // 活动指令 MoveL 使用 tGrip / wTable / vFast / zEnd。
    expect(wrapper.text()).toContain('MoveL')
    expect(wrapper.text()).toContain('工具 tGrip')
    expect(wrapper.text()).toContain('工件 wTable')
    expect(wrapper.text()).toContain('fly-by：MVP 未模拟路径融合')
    // zEnd 是高亮状态。
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('zonedata'))!
      .trigger('click')
    const zEndRow = wrapper.findAll('.program-data-item').find((li) => li.text().includes('zEnd'))
    expect(zEndRow?.classes()).toContain('active')
  })
})
