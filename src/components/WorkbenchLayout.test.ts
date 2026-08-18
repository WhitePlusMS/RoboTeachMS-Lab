// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkbenchLayout from './WorkbenchLayout.vue'

function mountLayout() {
  return mount(WorkbenchLayout, {
    slots: {
      center: '<div data-testid="center-content">Three.js 场景</div>',
      panel: `<template #panel="{ activeFunction }"><div data-testid="panel-content">当前功能：{{ activeFunction }}</div></template>`,
      pose: '<div data-testid="pose-content">位姿读数</div>',
    },
  })
}

describe('WorkbenchLayout 边栏驱动的面板壳层', () => {
  it('默认展开 RAPID 面板，提供三个功能页签与收起入口', () => {
    const wrapper = mountLayout()

    expect(wrapper.get('[data-testid="center-content"]').text()).toBe('Three.js 场景')
    expect(wrapper.get('[data-testid="panel-content"]').text()).toBe('当前功能：rapid')
    expect(wrapper.get('[data-testid="pose-content"]').text()).toBe('位姿读数')
    expect(wrapper.get('.workbench-layout').classes()).toContain('view-rapid')
    expect(wrapper.get('.workbench-layout').classes()).not.toContain('panel-closed')

    const rapidTab = wrapper.get('[aria-label="RAPID 程序"]')
    expect(rapidTab.attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[aria-label="程序数据 Program Data"]').attributes('aria-selected')).toBe(
      'false',
    )
    expect(wrapper.get('[aria-label="手动 Jog"]')).toBeTruthy()
    expect(wrapper.get('[aria-label="收起面板"]')).toBeTruthy()
  })

  it('边栏切换功能驱动面板内容，点击当前功能或收起只留窄边栏', async () => {
    const wrapper = mountLayout()

    await wrapper.get('[aria-label="程序数据 Program Data"]').trigger('click')
    expect(wrapper.get('[data-testid="panel-content"]').text()).toBe('当前功能：data')
    expect(wrapper.get('.workbench-layout').classes()).toContain('view-data')
    expect(wrapper.get('[aria-label="程序数据 Program Data"]').attributes('aria-selected')).toBe(
      'true',
    )

    // 点击当前功能页签 → 收起面板，3D 占满（dock 隐藏）。
    await wrapper.get('[aria-label="程序数据 Program Data"]').trigger('click')
    expect(wrapper.get('.workbench-layout').classes()).toContain('panel-closed')
    expect(wrapper.get('.workbench-dock').attributes('style')).toContain('display: none')
    expect(wrapper.get('[aria-label="程序数据 Program Data"]').attributes('aria-selected')).toBe(
      'false',
    )

    // 重新点开 Jog。
    await wrapper.get('[aria-label="手动 Jog"]').trigger('click')
    expect(wrapper.get('.workbench-layout').classes()).not.toContain('panel-closed')
    expect(wrapper.get('[data-testid="panel-content"]').text()).toBe('当前功能：jog')

    // 边栏“收起”按钮同样收起面板。
    await wrapper.get('.workbench-rail [aria-label="收起面板"]').trigger('click')
    expect(wrapper.get('.workbench-layout').classes()).toContain('panel-closed')
  })

  it('面板头部的 ⤢ 切换半屏加宽，✕ 收起面板', async () => {
    const wrapper = mountLayout()

    await wrapper.get('[aria-label="展开/收起半屏宽度"]').trigger('click')
    expect(wrapper.get('.workbench-layout').classes()).toContain('panel-wide')
    await wrapper.get('[aria-label="展开/收起半屏宽度"]').trigger('click')
    expect(wrapper.get('.workbench-layout').classes()).not.toContain('panel-wide')

    await wrapper.get('.dock-head [aria-label="收起面板"]').trigger('click')
    expect(wrapper.get('.workbench-layout').classes()).toContain('panel-closed')
  })
})
