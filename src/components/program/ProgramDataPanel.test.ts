// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProgramDataPanel from './ProgramDataPanel.vue'
import {
  parseRapidProgram,
  type RapidExecutableInstruction,
  type RapidProgramData,
} from '@/rapid/language/index.ts'
import type { Pose } from '@/robot-geometry/robot-types.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/editing/index.ts'

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
    applyEdit?: (command: RapidEditCommand) => RapidEditResult
    selectedTargetName?: string | null
  } = {},
) {
  return {
    data: overrides.data ?? [],
    activeIndex: overrides.activeIndex ?? null,
    canExecute: overrides.canExecute ?? true,
    program: overrides.program ?? [],
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
    applyEdit?: (command: RapidEditCommand) => RapidEditResult
  } = {},
) {
  return mount(ProgramDataPanel, { props: baseProps(overrides) })
}

describe('ProgramDataPanel — shell 协调与 Tab 切换', () => {
  it('渲染标题「程序数据」与就绪状态', () => {
    const wrapper = mountPanel({ data: parsed.data })
    expect(wrapper.text()).toContain('程序数据')
    expect(wrapper.text()).toContain('就绪')
  })

  it('canExecute=false 时展示「含错误」状态与禁用提示', () => {
    const wrapper = mountPanel({ data: parsed.data, canExecute: false })
    expect(wrapper.text()).toContain('含错误')
    expect(wrapper.text()).toContain('源程序存在错误：仅只读浏览，已禁用结构化编辑与运行')
  })

  it('display=content 模式不渲染标题行（dock 内嵌模式）', () => {
    const wrapper = mount(ProgramDataPanel, {
      props: { ...baseProps({ data: parsed.data }), display: 'content' },
    })
    expect(wrapper.find('#program-data-title').exists()).toBe(false)
  })

  it('默认 robtarget Tab，可在各数据类型 Tab 间切换', async () => {
    const wrapper = mountPanel({ data: parsed.data })
    // 默认 robtarget。
    expect(wrapper.get('[aria-label="robtarget 点位列表"]').text()).toContain('pA')
    // 切到 tooldata。
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('工具数据'))!
      .trigger('click')
    expect(wrapper.get('[aria-label="tooldata 数据列表"]').text()).toContain('tGrip')
    // 切到 num。
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('数字'))!
      .trigger('click')
    expect(wrapper.get('[aria-label="num 数据列表"]').text()).toContain('cycleCount')
  })

  it('含系统预定义项的 Tab（tooldata/speeddata/zonedata）添加 has-system 类', () => {
    const wrapper = mountPanel({ data: parsed.data })
    const tabs = wrapper.findAll('.program-data-kind-tab')
    const speedTab = tabs.find((t) => t.text().includes('speeddata'))
    expect(speedTab?.classes()).toContain('has-system')
  })

  it('activeIndex 非 null 时展示当前指令操作数横幅（MoveL/目标/速度/转弯区/工具/工件）', () => {
    const wrapper = mountPanel({ data: parsed.data, program: parsed.program, activeIndex: 0 })
    expect(wrapper.text()).toContain('MoveL')
    expect(wrapper.text()).toContain('目标 pA')
    expect(wrapper.text()).toContain('速度 vFast')
    expect(wrapper.text()).toContain('转弯区 zEnd')
    expect(wrapper.text()).toContain('工具 tGrip')
    expect(wrapper.text()).toContain('工件 wTable')
  })

  it('zone 非 fine 时横幅显示 fly-by 提示', () => {
    const wrapper = mountPanel({ data: parsed.data, program: parsed.program, activeIndex: 0 })
    expect(wrapper.text()).toContain('fly-by：MVP 未模拟路径融合')
  })

  it('离开 robtarget Tab 时，若有 selectedTargetName，emit select-target(null)', async () => {
    const wrapper = mountPanel({ data: parsed.data })
    await wrapper.setProps({ selectedTargetName: 'pA' })
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('工具数据'))!
      .trigger('click')
    expect(wrapper.emitted('select-target')).toContainEqual([null])
  })

  it('子组件 ProgramDataTargetList 的 select-target 事件透传给宿主', async () => {
    const wrapper = mountPanel({ data: parsed.data })
    await wrapper.get('[aria-label="选择点位 pA"]').trigger('click')
    expect(wrapper.emitted('select-target')).toEqual([['pA']])
  })

  it('子组件 ProgramDataTargetList 的 edit-error 事件更新 shell 错误横幅', async () => {
    const edit = vi.fn(() => ({
      ok: false as const,
      error: { code: 'duplicate-name' as const, message: '名称已存在' },
    }))
    const wrapper = mountPanel({ data: parsed.data, applyEdit: edit })
    await wrapper.get('[aria-label="新点位名称"]').setValue('pA')
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('新建点位'))!
      .trigger('click')
    expect(wrapper.text()).toContain('名称已存在')
  })

  it('子组件 ProgramDataReadonlyList 的 view-reference 事件透传给宿主', async () => {
    const wrapper = mountPanel({ data: parsed.data })
    await wrapper
      .findAll('.program-data-kind-tab')
      .find((b) => b.text().includes('工具数据'))!
      .trigger('click')
    await wrapper.get('[aria-label="选择 tooldata tGrip"]').trigger('click')
    const refLink = wrapper.get('.program-data-reference-link')
    await refLink.trigger('click')
    const emitted = wrapper.emitted('view-reference')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toHaveProperty('start')
  })
})
