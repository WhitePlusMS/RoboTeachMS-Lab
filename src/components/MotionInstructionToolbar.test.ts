// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MotionInstructionToolbar from './MotionInstructionToolbar.vue'
import { parseRapidProgram } from '@/rapid/rapid-parser.ts'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'
import type { Pose } from '@/robotics/types.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/controlled-rapid-edit.ts'

// 行号：1 MODULE / 2 CONST p1 / 3 CONST p2 / 4 PROC main() / 5 MoveJ p1 / 6 MoveL p2 / 7 ENDPROC / 8 ENDMODULE
const SOURCE = `MODULE Demo
    CONST robtarget p1 := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget p2 := [[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p1,v100,fine,tool0;
        MoveL p2,v100,fine,tool0;
    ENDPROC
ENDMODULE`

const parsed = parseRapidProgram(SOURCE)

const pose: Pose = {
  position: [100, 200, 300],
  euler: [0, 0, 0],
  rotation: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
}

function makeSnapshot(
  overrides: Partial<ProgramControllerSnapshot> = {},
): ProgramControllerSnapshot {
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

function mountToolbar(
  overrides: {
    snapshot?: ProgramControllerSnapshot
    cursorLine?: number | null
    pose?: Pose | null
    applyEdit?: (command: RapidEditCommand) => RapidEditResult
  } = {},
) {
  const commands: RapidEditCommand[] = []
  return {
    wrapper: mount(MotionInstructionToolbar, {
      props: {
        snapshot: overrides.snapshot ?? makeSnapshot(),
        program: parsed.program,
        insertionPoints: parsed.motionInsertionPoints,
        cursorLine: overrides.cursorLine ?? null,
        pose: overrides.pose !== undefined ? overrides.pose : pose,
        applyEdit:
          overrides.applyEdit ??
          ((command) => {
            commands.push(command)
            return { ok: true, result: { source: SOURCE } }
          }),
      },
    }),
    commands,
  }
}

function isAddDisabled(wrapper: ReturnType<typeof mountToolbar>['wrapper']): boolean {
  return (wrapper.get('[aria-label="添加 MoveJ"]').element as HTMLButtonElement).disabled
}

describe('MotionInstructionToolbar FlexPendant 式添加运动指令', () => {
  it('光标未知时回退到 PP 之后第一条，提示 PP 之后', async () => {
    const { wrapper, commands } = mountToolbar({
      snapshot: makeSnapshot({ programPointer: 0 }),
    })

    expect(wrapper.text()).toContain('PP 之后')
    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')

    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ type: 'insert-motion', kind: 'movej', insertionIndex: 1 })
  })

  it('PP 之后没有更后锚点时回退到程序末尾', async () => {
    const { wrapper, commands } = mountToolbar({
      snapshot: makeSnapshot({ programPointer: 2 }),
    })

    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')
    expect(commands[0]).toMatchObject({ insertionIndex: 2 })
    expect(wrapper.text()).toContain('程序末尾')
  })

  it('光标在第一条运动行（行 5）时插到其后（index 1）', async () => {
    const { wrapper, commands } = mountToolbar({ cursorLine: 5 })

    expect(wrapper.text()).toContain('光标行之后')
    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')
    expect(commands[0]).toMatchObject({ insertionIndex: 1 })
  })

  it('光标在最后一条运动行（行 6）时追加到程序末尾（index 2）', async () => {
    const { wrapper, commands } = mountToolbar({ cursorLine: 6 })

    await wrapper.get('[aria-label="添加 MoveL"]').trigger('click')
    expect(commands[0]).toMatchObject({ kind: 'movel', insertionIndex: 2 })
    expect(wrapper.text()).toContain('程序末尾')
  })

  it('光标在非指令行（行 4 PROC main()）时取其后最近锚点（index 0）', async () => {
    const { wrapper, commands } = mountToolbar({ cursorLine: 4 })

    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')
    expect(commands[0]).toMatchObject({ insertionIndex: 0 })
  })

  it('光标在 ENDPROC 行（行 7）时追加到程序末尾而非误判禁用（回归）', async () => {
    const { wrapper, commands } = mountToolbar({ cursorLine: 7 })

    expect(isAddDisabled(wrapper)).toBe(false)
    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')
    expect(commands[0]).toMatchObject({ insertionIndex: 2 })
    expect(wrapper.text()).toContain('程序末尾')
  })

  it('光标在首个锚点行之前（如 MODULE 行 1）时插到首条之前（index 0）', async () => {
    const { wrapper, commands } = mountToolbar({ cursorLine: 1 })

    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')
    expect(commands[0]).toMatchObject({ insertionIndex: 0 })
  })

  it('程序无任何运动锚点时按钮禁用并提示（保留空程序提示）', async () => {
    const empty = mount(MotionInstructionToolbar, {
      props: {
        snapshot: makeSnapshot(),
        program: [],
        insertionPoints: [],
        cursorLine: 1,
        pose,
        applyEdit: () => ({ ok: true, result: { source: SOURCE } }),
      },
    })
    expect(isAddDisabled(empty)).toBe(true)
    expect(empty.text()).toContain('无可插入位置')
  })

  it('目标点固定为示教当前位置，target 来自 Pose', async () => {
    const { wrapper, commands } = mountToolbar({ cursorLine: 5 })

    await wrapper.get('[aria-label="添加 MoveL"]').trigger('click')

    expect(commands).toHaveLength(1)
    const command = commands[0] as Extract<RapidEditCommand, { type: 'insert-motion' }>
    expect(command.target).toMatchObject({ source: 'current' })
    expect((command.target as { target: { trans: number[] } }).target.trans).toEqual([
      100, 200, 300,
    ])
  })

  it('插入成功后上报新指令所在行，供连续示教向下追加', async () => {
    const { wrapper } = mountToolbar({ cursorLine: 5 })

    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')

    // 锚点为行 6（第二条 MoveL 之前），新指令占用行 6。
    expect(wrapper.emitted('inserted')).toEqual([[6]])
  })

  it('running、有 diagnostics、pose 为空或锚点为空时按钮禁用', () => {
    const { wrapper: running } = mountToolbar({ snapshot: makeSnapshot({ state: 'running' }) })
    expect(isAddDisabled(running)).toBe(true)

    const { wrapper: diagnostics } = mountToolbar({
      snapshot: makeSnapshot({
        diagnostics: [
          {
            code: 'undefined-symbol',
            message: 'm',
            severity: 'error',
            range: {
              start: { offset: 0, line: 1, column: 1 },
              end: { offset: 1, line: 1, column: 2 },
            },
          },
        ],
      }),
    })
    expect(isAddDisabled(diagnostics)).toBe(true)

    const { wrapper: noPose } = mountToolbar({ pose: null })
    expect(isAddDisabled(noPose)).toBe(true)

    const empty = mount(MotionInstructionToolbar, {
      props: {
        snapshot: makeSnapshot(),
        program: parsed.program,
        insertionPoints: [],
        cursorLine: null,
        pose,
        applyEdit: () => ({ ok: true, result: { source: SOURCE } }),
      },
    })
    expect(isAddDisabled(empty)).toBe(true)
    expect(empty.text()).toContain('无可插入位置')
  })

  it('applyEdit 拒绝时显示结构化错误', async () => {
    const { wrapper } = mountToolbar({
      applyEdit: () => ({
        ok: false,
        error: { code: 'invalid-insertion-position', message: '插入位置无效' },
      }),
    })

    await wrapper.get('[aria-label="添加 MoveJ"]').trigger('click')
    expect(wrapper.text()).toContain('插入位置无效')
  })
})
