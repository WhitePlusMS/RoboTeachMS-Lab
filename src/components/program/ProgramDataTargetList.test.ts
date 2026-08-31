// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ProgramDataTargetList from './ProgramDataTargetList.vue'
import {
  parseRapidProgram,
  type RapidProgramData,
} from '@/rapid/language/index.ts'
import type { Pose } from '@/robot-geometry/model/index.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/editing/index.ts'

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
    canExecute?: boolean
    applyEdit?: (command: RapidEditCommand) => RapidEditResult
    selectedTargetName?: string | null
    activeTargetName?: string
  } = {},
) {
  return {
    data: overrides.data ?? [],
    canExecute: overrides.canExecute ?? true,
    pose: DEFAULT_POSE,
    applyEdit: overrides.applyEdit ?? okEdit,
    selectedTargetName: overrides.selectedTargetName,
    activeTargetName: overrides.activeTargetName ?? '',
  }
}

function mountList(
  overrides: {
    data?: readonly RapidProgramData[]
    canExecute?: boolean
    applyEdit?: (command: RapidEditCommand) => RapidEditResult
    selectedTargetName?: string | null
    activeTargetName?: string
  } = {},
) {
  return mount(ProgramDataTargetList, { props: baseProps(overrides) })
}

async function selectTarget(wrapper: ReturnType<typeof mountList>, name: string): Promise<void> {
  await wrapper.get(`[aria-label="选择点位 ${name}"]`).trigger('click')
  await wrapper.setProps({ selectedTargetName: name })
}

describe('ProgramDataTargetList — ABB 式 robtarget 列表', () => {
  it('零点位时展示占位提示', () => {
    const wrapper = mountList({ data: [] })
    expect(wrapper.text()).toContain('源码中尚未声明 robtarget')
  })

  it('渲染点位列表（名称/存储/位置/引用）', () => {
    const wrapper = mountList({ data: DEFAULT_PARSED.data })
    const list = wrapper.get('[aria-label="robtarget 点位列表"]')
    expect(list.text()).toContain('pApproach')
    expect(list.text()).toContain('p_work')
    expect(list.text()).toContain('const')
    expect(list.text()).toContain('pers')
    expect(list.text()).toContain('551.0, 613.0, 60.0')
    expect(list.text()).toContain('551.0, 613.0, 25.0')
    expect(list.text()).toContain('1 处引用')
  })

  it('点击行触发 select-target 事件', async () => {
    const wrapper = mountList({ data: DEFAULT_PARSED.data })
    await wrapper.get('[aria-label="选择点位 pApproach"]').trigger('click')
    expect(wrapper.emitted('select-target')).toEqual([['pApproach']])
  })

  it('筛选框过滤点位列表', async () => {
    const wrapper = mountList({ data: DEFAULT_PARSED.data })
    expect(wrapper.text()).toContain('pApproach')
    expect(wrapper.text()).toContain('p_work')
    await wrapper.get('[aria-label="按名称筛选点位"]').setValue('work')
    expect(wrapper.text()).not.toContain('pApproach')
    expect(wrapper.text()).toContain('p_work')
  })

  it('canExecute=false 时隐藏示教区与所有写操作', () => {
    const wrapper = mountList({ data: DEFAULT_PARSED.data, canExecute: false })
    expect(wrapper.text()).not.toContain('新建点位')
    expect(wrapper.find('[aria-label="新点位名称"]').exists()).toBe(false)
  })

  it('新建点位：输入名称+点击按钮触发 create-target 编辑', async () => {
    const edit = vi.fn(() => ({ ok: true as const, result: { source: 'x' } }))
    const wrapper = mountList({ data: DEFAULT_PARSED.data, applyEdit: edit })
    await wrapper.get('[aria-label="新点位名称"]').setValue('pNew')
    await wrapper.findAll('button').find((b) => b.text().includes('新建点位'))!.trigger('click')
    expect(edit).toHaveBeenCalledWith({ type: 'create-target', name: 'pNew', target: expect.any(Object) })
  })

  it('activeTargetName 高亮当前指令使用的目标', () => {
    const wrapper = mountList({ data: DEFAULT_PARSED.data, activeTargetName: 'pApproach' })
    const approach = wrapper.findAll('.program-data-item').find((li) => li.text().includes('pApproach'))
    expect(approach?.classes()).toContain('active')
  })
})

describe('ProgramDataTargetList — 点位详情与受控编辑', () => {
  it('选中点位：展开详情区（位置/姿态/robconf/外轴/引用）', async () => {
    const wrapper = mountList({ data: DEFAULT_PARSED.data })
    await selectTarget(wrapper, 'pApproach')
    const detail = wrapper.get('[aria-label="选中点位详情"]')
    expect(detail.text()).toContain('551.0, 613.0, 60.0')
    expect(detail.text()).toContain('1.000, 0.000, 0.000, 0.000')
    expect(detail.text()).toContain('robconf')
    expect(detail.text()).toContain('外轴')
    expect(detail.text()).toContain('1 处引用')
  })

  it('选中点位：展示写操作（Modify Position/编辑位置/重命名/删除）', async () => {
    const wrapper = mountList({ data: DEFAULT_PARSED.data })
    await selectTarget(wrapper, 'pApproach')
    expect(wrapper.text()).toContain('Modify Position')
    expect(wrapper.text()).toContain('编辑位置')
    expect(wrapper.text()).toContain('重命名')
    expect(wrapper.text()).toContain('删除')
  })

  it('Modify Position：触发 modify-position 编辑（用 taughtRobTarget）', async () => {
    const edit = vi.fn(() => ({ ok: true as const, result: { source: 'x' } }))
    const wrapper = mountList({ data: DEFAULT_PARSED.data, applyEdit: edit })
    await selectTarget(wrapper, 'pApproach')
    await wrapper.findAll('button').find((b) => b.text().includes('Modify Position'))!.trigger('click')
    expect(edit).toHaveBeenCalledWith({
      type: 'modify-position',
      name: 'pApproach',
      target: expect.objectContaining({ trans: expect.any(Array) }),
    })
  })

  it('编辑位置：展开 XYZ 输入框，确认后触发 modify-position', async () => {
    const edit = vi.fn(() => ({ ok: true as const, result: { source: 'x' } }))
    const wrapper = mountList({ data: DEFAULT_PARSED.data, applyEdit: edit })
    await selectTarget(wrapper, 'pApproach')
    await wrapper.findAll('button').find((b) => b.text().includes('编辑位置'))!.trigger('click')
    const inputs = wrapper.get('.program-data-edit-position').findAll('input')
    await inputs[0].setValue('100')
    await inputs[1].setValue('200')
    await inputs[2].setValue('300')
    await wrapper.findAll('button').find((b) => b.text().includes('确认'))!.trigger('click')
    expect(edit).toHaveBeenCalledWith({
      type: 'modify-position',
      name: 'pApproach',
      target: expect.objectContaining({ trans: [100, 200, 300] }),
    })
  })

  it('重命名：展开输入框，确认后触发 rename-target 并 emit select-target(newName)', async () => {
    const edit = vi.fn(() => ({ ok: true as const, result: { source: 'x' } }))
    const wrapper = mountList({ data: DEFAULT_PARSED.data, applyEdit: edit })
    await selectTarget(wrapper, 'pApproach')
    await wrapper.findAll('button').find((b) => b.text().includes('重命名'))!.trigger('click')
    await wrapper.get('[aria-label="重命名点位"]').setValue('pApproach2')
    await wrapper.findAll('button').find((b) => b.text().includes('确认重命名'))!.trigger('click')
    expect(edit).toHaveBeenCalledWith({ type: 'rename-target', name: 'pApproach', newName: 'pApproach2' })
    expect(wrapper.emitted('select-target')).toContainEqual(['pApproach2'])
  })

  it('删除：二次确认（armed → 确认删除？）', async () => {
    const edit = vi.fn(() => ({ ok: true as const, result: { source: 'x' } }))
    const wrapper = mountList({ data: DEFAULT_PARSED.data, applyEdit: edit })
    await selectTarget(wrapper, 'pApproach')
    const deleteBtn = wrapper.findAll('button').find((b) => b.text().includes('删除'))!
    await deleteBtn.trigger('click')
    expect(deleteBtn.text()).toContain('确认删除？')
    await deleteBtn.trigger('click')
    expect(edit).toHaveBeenCalledWith({ type: 'delete-target', name: 'pApproach' })
  })

  it('编辑失败：emit edit-error 携带错误消息', async () => {
    const edit = vi.fn(() => ({ ok: false as const, error: { code: 'duplicate-name' as const, message: '名称已存在' } }))
    const wrapper = mountList({ data: DEFAULT_PARSED.data, applyEdit: edit })
    await wrapper.get('[aria-label="新点位名称"]').setValue('pApproach')
    await wrapper.findAll('button').find((b) => b.text().includes('新建点位'))!.trigger('click')
    expect(wrapper.emitted('edit-error')).toEqual([[null], ['名称已存在']])
  })

  it('多引用点位：展示「共享目标」警告', async () => {
    const source = `
MODULE Demo
    PERS robtarget pShared := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ pShared,v100,fine,tool0;
        MoveL pShared,v50,fine,tool0;
        MoveJ pShared,v100,fine,tool0;
    ENDPROC
ENDMODULE
`
    const parsed = parseRapidProgram(source)
    const wrapper = mountList({ data: parsed.data })
    await selectTarget(wrapper, 'pShared')
    expect(wrapper.text()).toContain('共享目标：示教将影响 3 处引用')
  })

  it('查看引用：点击引用链接 emit view-reference', async () => {
    const wrapper = mountList({ data: DEFAULT_PARSED.data })
    await selectTarget(wrapper, 'pApproach')
    const refLink = wrapper.get('.program-data-reference-link')
    await refLink.trigger('click')
    const emitted = wrapper.emitted('view-reference')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toHaveProperty('start')
  })
})
