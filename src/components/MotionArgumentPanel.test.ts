// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProgramWorkspace from './ProgramWorkspace.vue'
import { parseRapidProgram } from '@/rapid/rapid-parser.ts'
import type { EditorView } from '@codemirror/view'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'
import type { Pose } from '@/robotics/types.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/controlled-rapid-edit.ts'

const SOURCE = `MODULE Demo
    CONST robtarget p1 := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,v100,fine,tool0;
    ENDPROC
ENDMODULE`
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

interface MountOpts {
  source?: string
  applyEdit?: (command: RapidEditCommand) => RapidEditResult
}

function mountWorkspace(opts: MountOpts = {}) {
  const src = opts.source ?? SOURCE
  const p = parseRapidProgram(src)
  const commands: RapidEditCommand[] = []
  return {
    commands,
    wrapper: mount(ProgramWorkspace, {
      attachTo: document.body,
      props: {
        view: 'rapid',
        snapshot,
        source: src,
        program: p.program,
        instructions: p.instructions,
        pendingClear: null,
        data: p.data,
        activeIndex: null,
        canExecute: p.canExecute,
        insertionPoints: p.motionInsertionPoints,
        pose,
        applyEdit:
          opts.applyEdit ??
          ((command: RapidEditCommand): RapidEditResult => {
            commands.push(command)
            return { ok: true, result: { source: src } }
          }),
        selectedTargetName: null,
      },
    }),
  }
}

/** 取模具内 RapidSourceEditor 暴露的 EditorView（script-setup 的 exposed 在 $.exposed 下）。 */
function getEditorView(wrapper: ReturnType<typeof mount>): EditorView {
  const vm = wrapper.findComponent({ name: 'RapidSourceEditor' }).vm as unknown as {
    $: { exposed: { getView: () => EditorView | null } }
  }
  const view = vm.$.exposed.getView()
  if (!view) throw new Error('CodeMirror view 尚未初始化')
  return view
}

/** 等一个宏任务，让 CodeMirror 事务处理与 DOM/标记落定。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 把源码编辑器光标（selection）放到第 line 行（1 起始），触发光标行更新。 */
async function focusLine(wrapper: ReturnType<typeof mount>, line: number) {
  const view = getEditorView(wrapper)
  const pos = view.state.doc.line(line).from
  view.dispatch({ selection: { anchor: pos, head: pos } })
  await settle()
}

/** 双击第 line 行：在对应 .cm-line 元素上派发 dblclick（FlexPendant 双击 = Change Selected）。 */
async function dblclickLine(wrapper: ReturnType<typeof mount>, line: number) {
  const host = wrapper.get('.rapid-codemirror').element
  const lineEl = Array.from(host.querySelectorAll<HTMLElement>('.cm-line'))[line - 1]
  if (!lineEl) throw new Error('missing cm-line for line ' + line)
  lineEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
  await settle()
}

describe('ProgramEditorToolbar FlexPendant 式操作', () => {
  it('添加指令菜单只出 MoveJ/MoveL，点击后插入 `*,v1000,z50,tool0` 占位', async () => {
    const { commands, wrapper } = mountWorkspace()

    await wrapper.get('[aria-label="添加指令"]').trigger('click')
    const list = wrapper.get('[aria-label="Common 指令列表"]')
    const items = list.findAll('button').map((b) => b.text().trim())
    expect(items).toEqual(['MoveJ', 'MoveL'])

    await list.findAll('button').find((b) => b.text().trim() === 'MoveL')!.trigger('click')
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ type: 'insert-motion', kind: 'movel' })
    // 调用方不携带 target；命令层负责生成 `*,v1000,z50,tool0`（见 controlled-rapid-edit 测试）。
    expect(commands[0]).not.toHaveProperty('target')
  })

  it('光标在赋值（非运动）行时编辑菜单可用但 Change to 不出现，参数面板隐藏', async () => {
    const src = `MODULE Demo
    VAR num n := 1;
    PROC main()
        n := n + 1;
        MoveJ p1,v100,fine,tool0;
    ENDPROC
ENDMODULE`
    const { wrapper } = mountWorkspace({ source: src })
    await focusLine(wrapper, 4) // 赋值行

    // 赋值也是合法指令（可注释/取消注释），仅 更改选定内容 与 Change to 是运动专属。
    await wrapper.get('[aria-label="编辑"]').trigger('click')
    const list = wrapper.get('[aria-label="编辑操作列表"]')
    const buttons = list.findAll('button')
    const byText = (t: string) => buttons.find((b) => b.text().trim() === t)
    expect(byText('注释')!.attributes('disabled')).toBeUndefined()
    expect(byText('更改选定内容')!.attributes('disabled')).toBeDefined()
    expect(buttons.some((b) => b.text().includes('Change to'))).toBe(false)

    // 参数面板不因光标点选出现（双击/更改选定内容才打开）。
    expect(wrapper.find('[aria-label="指令参数"]').exists()).toBe(false)
  })
})

describe('MotionArgumentPanel FlexPendant 参数编辑', () => {
  it('光标点选运动指令只高亮不弹面板；双击（Change Selected）才打开', async () => {
    const src = `MODULE Demo
    PROC main()
        MoveL *,v1000,z50,tool0;
    ENDPROC
ENDMODULE`
    const { wrapper } = mountWorkspace({ source: src })
    await focusLine(wrapper, 3) // MoveL 行：真机点选=高亮，不弹参数页
    expect(wrapper.find('[aria-label="指令参数"]').exists()).toBe(false)

    await dblclickLine(wrapper, 3)
    const panel = wrapper.get('[aria-label="指令参数"]')
    expect(panel.text()).toContain('MoveL')
    expect(panel.text()).toContain('未示教 *')
    expect(panel.text()).toContain('v1000')
    expect(panel.text()).toContain('z50')
    expect(panel.text()).toContain('目标未示教')

    // `*` 未命名目标：工具栏常驻 Modify Position 禁用。
    expect(wrapper.get('[aria-label="修改位置"]').attributes('disabled')).toBeDefined()

    // 关闭按钮收起面板。
    await panel.get('[aria-label="关闭参数面板"]').trigger('click')
    expect(wrapper.find('[aria-label="指令参数"]').exists()).toBe(false)
  })

  it('「编辑 → 更改选定内容」是参数面板的菜单入口', async () => {
    const { wrapper } = mountWorkspace()
    await focusLine(wrapper, 4) // MoveJ p1 行
    expect(wrapper.find('[aria-label="指令参数"]').exists()).toBe(false)

    await wrapper.get('[aria-label="编辑"]').trigger('click')
    const change = wrapper
      .get('[aria-label="编辑操作列表"]')
      .findAll('button')
      .find((b) => b.text().trim() === '更改选定内容')!
    await change.trigger('click')
    expect(wrapper.get('[aria-label="指令参数"]').text()).toContain('MoveJ')
  })

  it('目标选择器列出已有点位与新建项；选择已有发 edit-motion-operand existing', async () => {
    const { commands, wrapper } = mountWorkspace()
    await dblclickLine(wrapper, 4) // 双击 MoveJ 行打开参数面板

    // 打开目标选择器：点击目标操作数。
    wrapper
      .get('[aria-label="指令参数"]')
      .findAll('[role="button"]')
      .find((b) => b.attributes('aria-label')?.includes('目标点参数'))!
      .trigger('click')
    await wrapper.vm.$nextTick()

    const selector = wrapper.get('[aria-label="指令参数"]')
    const names = selector.findAll('.motion-argument-option-name').map((n) => n.text())
    expect(names).toContain('p1')
    expect(names).toContain('新建点位（记录当前位置）')

    const p1Option = selector
      .findAll('.motion-argument-option')
      .find((o) => o.text().includes('p1'))!
    await p1Option.trigger('click')
    expect(commands[commands.length - 1]).toMatchObject({
      type: 'edit-motion-operand',
      operand: 'target',
      value: { source: 'existing', name: 'p1' },
    })
  })

  it('新建点位以当前 TCP 记录，发 edit-motion-operand new', async () => {
    const src = `MODULE Demo
    PROC main()
        MoveL *,v1000,z50,tool0;
    ENDPROC
ENDMODULE`
    const { commands, wrapper } = mountWorkspace({ source: src })
    await dblclickLine(wrapper, 3)

    const panel = wrapper.get('[aria-label="指令参数"]')
    panel
      .findAll('[role="button"]')
      .find((b) => b.attributes('aria-label')?.includes('目标点参数'))!
      .trigger('click')
    await wrapper.vm.$nextTick()

    const newOption = panel
      .findAll('.motion-argument-option')
      .find((o) => o.text().includes('新建点位'))!
    await newOption.trigger('click')

    const command = commands[commands.length - 1] as Extract<
      RapidEditCommand,
      { type: 'edit-motion-operand' }
    >
    expect(command.type).toBe('edit-motion-operand')
    expect(command.operand).toBe('target')
    expect(command.value).toMatchObject({ source: 'new' })
    const recorded = (command.value as { target: { trans: number[] } }).target
    expect(recorded.trans).toEqual([451, 0, 807.1])
  })

  it('速度/zone 选择器列出系统数据并标注；选择后发 edit-motion-operand', async () => {
    const { commands, wrapper } = mountWorkspace()
    await dblclickLine(wrapper, 4)

    const panel = wrapper.get('[aria-label="指令参数"]')
    // 打开速度选择器。
    panel
      .findAll('[role="button"]')
      .find((b) => b.attributes('aria-label')?.includes('速度参数'))!
      .trigger('click')
    await wrapper.vm.$nextTick()
    const speedSelector = wrapper.get('[aria-label="指令参数"]')
    const hasSystem = speedSelector.findAll('.motion-argument-option-badge').length > 0
    expect(hasSystem).toBe(true)
    const v100 = speedSelector
      .findAll('.motion-argument-option')
      .find((o) => o.text().includes('v100'))!
    await v100.trigger('click')
    expect(commands[commands.length - 1]).toMatchObject({
      type: 'edit-motion-operand',
      operand: 'speed',
      value: { name: 'v100' },
    })

    // 打开 zone 选择器。
    wrapper
      .get('[aria-label="指令参数"]')
      .findAll('[role="button"]')
      .find((b) => b.attributes('aria-label')?.includes('转弯区参数'))!
      .trigger('click')
    await wrapper.vm.$nextTick()
    const zoneSelector = wrapper.get('[aria-label="指令参数"]')
    const fine = zoneSelector
      .findAll('.motion-argument-option')
      .find((o) => o.text().includes('fine'))!
    await fine.trigger('click')
    expect(commands[commands.length - 1]).toMatchObject({
      type: 'edit-motion-operand',
      operand: 'zone',
      value: { name: 'fine' },
    })
  })

  it('Modify Position 常驻工具栏：光标指令目标为已命名 robtarget 时发 modify-position', async () => {
    const { commands, wrapper } = mountWorkspace()
    await focusLine(wrapper, 4) // MoveJ p1 行；无需打开参数面板

    // 常驻软按钮（FlexPendant 底部 Modify Position 语义），不属于参数面板。
    const modify = wrapper.get('[aria-label="修改位置"]')
    expect(modify.attributes('disabled')).toBeUndefined()

    await modify.trigger('click')
    expect(commands[commands.length - 1]).toMatchObject({
      type: 'modify-position',
      name: 'p1',
    })
  })
})
