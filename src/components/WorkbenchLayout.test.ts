// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkbenchLayout from './WorkbenchLayout.vue'

function mountLayout() {
  return mount(WorkbenchLayout, {
    slots: {
      left: '<div data-testid="left-content">左侧控制</div>',
      center: '<div data-testid="center-content">Three.js 场景</div>',
      right: '<div data-testid="right-content">右侧编程</div>',
    },
  })
}

describe('WorkbenchLayout 三栏折叠壳层', () => {
  it('默认显示左右内容与中间场景，并提供两个收起入口', () => {
    const wrapper = mountLayout()

    expect(wrapper.get('[data-testid="left-content"]').text()).toBe('左侧控制')
    expect(wrapper.get('[data-testid="center-content"]').text()).toBe('Three.js 场景')
    expect(wrapper.get('[data-testid="right-content"]').text()).toBe('右侧编程')
    expect(wrapper.get('[aria-label="收起左侧面板"]')).toBeTruthy()
    expect(wrapper.get('[aria-label="收起右侧面板"]')).toBeTruthy()
    expect(wrapper.get('[aria-label="收起左侧面板"]').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[aria-label="收起右侧面板"]').attributes('aria-expanded')).toBe('true')
  })

  it('左右栏可以独立收起并从窄轨道重新展开', async () => {
    const wrapper = mountLayout()

    await wrapper.get('[aria-label="收起左侧面板"]').trigger('click')
    expect(
      wrapper
        .get('[data-testid="left-content"]')
        .element.parentElement?.parentElement?.getAttribute('style'),
    ).toContain('display: none')
    expect(wrapper.get('.workbench-layout').classes()).toContain('left-collapsed')
    expect(wrapper.get('[aria-label="展开左侧面板"]')).toBeTruthy()
    expect(wrapper.get('[aria-label="展开左侧面板"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.findAll('[data-testid="right-content"]')).toHaveLength(1)

    await wrapper.get('[aria-label="收起右侧面板"]').trigger('click')
    expect(
      wrapper
        .get('[data-testid="right-content"]')
        .element.parentElement?.parentElement?.getAttribute('style'),
    ).toContain('display: none')
    expect(wrapper.get('.workbench-layout').classes()).toContain('right-collapsed')
    expect(wrapper.get('[aria-label="展开右侧面板"]').attributes('aria-expanded')).toBe('false')

    await wrapper.get('[aria-label="展开左侧面板"]').trigger('click')
    await wrapper.get('[aria-label="展开右侧面板"]').trigger('click')
    expect(wrapper.findAll('[data-testid="left-content"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="right-content"]')).toHaveLength(1)
    expect(wrapper.get('.workbench-layout').classes()).not.toContain('left-collapsed')
    expect(wrapper.get('.workbench-layout').classes()).not.toContain('right-collapsed')
  })
})
