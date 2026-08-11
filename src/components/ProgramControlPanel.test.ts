// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProgramControlPanel from './ProgramControlPanel.vue'
import type { ProgramControllerSnapshot } from '../application/program-control.ts'

const SOURCE = 'MODULE Demo ENDMODULE'

function snapshot(overrides: Partial<ProgramControllerSnapshot> = {}): ProgramControllerSnapshot {
  return {
    state: 'idle',
    programPointer: 0,
    motionPointer: null,
    error: null,
    diagnostics: [],
    ...overrides,
  }
}

function mountPanel(value: ProgramControllerSnapshot) {
  return mount(ProgramControlPanel, { props: { snapshot: value, source: SOURCE } })
}

describe('ProgramControlPanel 按钮可用性与命令映射', () => {
  it('idle 时只有运行可用，且发出 run 命令', async () => {
    const wrapper = mountPanel(snapshot())
    const run = wrapper.get('button')
    const pause = wrapper.findAll('button')[1]
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
    expect(pause.attributes('disabled')).toBeDefined()

    await run.trigger('click')
    expect(wrapper.emitted('run')).toHaveLength(1)
  })

  it('running 时暂停/停止可用，运行/继续/复位不可用', () => {
    const wrapper = mountPanel(snapshot({ state: 'running', motionPointer: 0 }))
    const [run, pause, resume, stop, reset] = wrapper.findAll('button')
    expect(run.attributes('disabled')).toBeDefined()
    expect(pause.attributes('disabled')).toBeUndefined()
    expect(resume.attributes('disabled')).toBeDefined()
    expect(stop.attributes('disabled')).toBeUndefined()
    expect(reset.attributes('disabled')).toBeDefined()
  })

  it('paused 时继续/停止可用', async () => {
    const wrapper = mountPanel(snapshot({ state: 'paused', motionPointer: 1 }))
    const [, , resume, stop] = wrapper.findAll('button')
    expect(resume.attributes('disabled')).toBeUndefined()
    expect(stop.attributes('disabled')).toBeUndefined()

    await resume.trigger('click')
    expect(wrapper.emitted('resume')).toHaveLength(1)
  })

  it('终止状态下复位可用并发出 reset；运行不可用发出 stop/暂停命令', async () => {
    const wrapper = mountPanel(snapshot({ state: 'completed', programPointer: 3 }))
    const [run, , , , reset] = wrapper.findAll('button')
    expect(run.attributes('disabled')).toBeDefined()
    expect(reset.attributes('disabled')).toBeUndefined()

    await reset.trigger('click')
    expect(wrapper.emitted('reset')).toHaveLength(1)

    await wrapper.findAll('button')[3].trigger('click') // stop（禁用，不应发出）
    expect(wrapper.emitted('stop')).toBeUndefined()
  })
})

describe('ProgramControlPanel 状态与指针显示', () => {
  it('显示状态、程序指针与运动指针', () => {
    const wrapper = mountPanel(snapshot({ state: 'running', programPointer: 2, motionPointer: 2 }))
    expect(wrapper.text()).toContain('运行中')
    expect(wrapper.get('[aria-label="程序快照"]').text()).toContain('程序指针')
    expect(wrapper.get('[aria-label="程序快照"]').text()).toContain('运动指针')
  })

  it('无活动指令时运动指针显示占位', () => {
    const wrapper = mountPanel(snapshot({ state: 'idle' }))
    expect(wrapper.text()).toContain('空闲')
    expect(wrapper.get('[aria-label="程序快照"]').text()).toContain('—')
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

  it('编辑 RAPID 源程序并在活动程序期间锁定编辑器', async () => {
    const idle = mountPanel(snapshot())
    await idle.get('textarea').setValue('MODULE Changed ENDMODULE')
    expect(idle.emitted('source-change')?.[0]).toEqual(['MODULE Changed ENDMODULE'])

    const running = mountPanel(snapshot({ state: 'running', motionPointer: 0 }))
    expect(running.get('textarea').attributes('disabled')).toBeDefined()
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
})
