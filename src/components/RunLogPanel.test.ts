// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import RunLogPanel from './RunLogPanel.vue'
import type { RunLogEntry } from '@/application/run-log.ts'

function makeEntry(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
  return {
    id: 1,
    time: '08:00:00',
    level: 'info',
    tag: '程序',
    text: '默认条目',
    ...overrides,
  }
}

const ENTRIES: RunLogEntry[] = [
  makeEntry({ id: 1, level: 'info', tag: '程序', text: '运行请求' }),
  makeEntry({ id: 2, level: 'warn', tag: '程序', text: '单步已完成' }),
  makeEntry({ id: 3, level: 'err', tag: '错误', text: '诊断失败' }),
]

describe('RunLogPanel', () => {
  it('渲染全部日志条目', () => {
    const wrapper = mount(RunLogPanel, { props: { entries: ENTRIES } })
    const lines = wrapper.findAll('.log-line')
    expect(lines).toHaveLength(3)
    expect(wrapper.text()).toContain('运行请求')
    expect(wrapper.text()).toContain('[程序]')
    expect(wrapper.text()).toContain('[错误]')
  })

  it('空日志显示占位文案', () => {
    const wrapper = mount(RunLogPanel, { props: { entries: [] } })
    expect(wrapper.text()).toContain('暂无日志')
  })

  it('级别过滤：警告档只看警告及以上', async () => {
    const wrapper = mount(RunLogPanel, { props: { entries: ENTRIES } })
    const buttons = wrapper.findAll('.log-filter')
    const warnButton = buttons.find((b) => b.text() === '警告')!
    await warnButton.trigger('click')
    const visible = wrapper.findAll('.log-line').map((l) => l.text())
    expect(visible.map((t) => (t.includes('单步已完成') ? 'warn' : 'err'))).toEqual(['warn', 'err'])
    expect(visible.join('')).not.toContain('运行请求')
  })

  it('收起/展开切换日志体', async () => {
    const wrapper = mount(RunLogPanel, { props: { entries: ENTRIES } })
    const toggle = wrapper.find('.log-toggle')
    expect((toggle.element as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect((toggle.element as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false')
    expect(wrapper.find('.log-body').isVisible()).toBe(false)
  })

  it('默认日志体高度为 96px，可拖拽调整并钳制在范围内', async () => {
    const wrapper = mount(RunLogPanel, { props: { entries: ENTRIES } })
    const body = wrapper.find('.log-body')
    expect(body.attributes('style')).toContain('height: 96px')

    // jsdom 的 trigger 无法写只读事件属性，改为派发原始 DOM 事件。
    const dispatch = (handle: Element, type: string, clientY: number) =>
      handle.dispatchEvent(new MouseEvent(type, { clientY, bubbles: true }))
    const handle = wrapper.find('.log-resize').element

    // 起始高度 96，向上拖 40px → 136px。
    dispatch(handle, 'pointerdown', 200)
    dispatch(handle, 'pointermove', 160)
    await wrapper.vm.$nextTick()
    expect(body.attributes('style')).toContain('height: 136px')

    // 拖拽钳制：继续大幅向上拖动超出最大高度 → 封在 MAX_HEIGHT(420)。
    dispatch(handle, 'pointerdown', 200)
    dispatch(handle, 'pointermove', -500)
    await wrapper.vm.$nextTick()
    const style = body.attributes('style') ?? ''
    const height = Number(/height:\s*(\d+)px/.exec(style)?.[1])
    expect(height).toBe(420)
  })

  it('响应式驱动：注入 entries 变化后渲染更新', async () => {
    const entries = ref<RunLogEntry[]>(ENTRIES)
    const wrapper = mount(RunLogPanel, { props: { entries: entries.value } })
    expect(wrapper.findAll('.log-line')).toHaveLength(3)
    entries.value = [...ENTRIES, makeEntry({ id: 4, level: 'ok', tag: '程序', text: '运行完成' })]
    await wrapper.setProps({ entries: entries.value })
    expect(wrapper.text()).toContain('运行完成')
  })
})
