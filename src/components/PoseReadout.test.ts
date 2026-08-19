// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PoseReadout from './PoseReadout.vue'
import type { PoseDisplay } from '@/robotics/types.ts'

const pose: PoseDisplay = {
  positionMm: [451.04, 0, 807.06],
  orientationDeg: [180, 0, -90.02],
}

describe('PoseReadout 共享位姿读数', () => {
  it('按 PX/PY/PZ/RX/RY/RZ 顺序渲染六格 toFixed(1) 数值', () => {
    const wrapper = mount(PoseReadout, { props: { pose } })

    expect(wrapper.attributes('aria-label')).toBe('正解结果')
    const values = wrapper.findAll('.pose-grid strong').map((node) => node.text())
    expect(values).toEqual(['451.0', '0.0', '807.1', '180.0', '0.0', '-90.0'])
  })

  it('默认展示欧拉角(RX/RY/RZ)，切换按钮为图标（自带悬停语义），XYZ 读数保持不变', () => {
    const wrapper = mount(PoseReadout, { props: { pose } })

    const buttons = wrapper.findAll('.orientation-toggle button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].attributes('aria-label')).toContain('欧拉角')
    expect(buttons[1].attributes('aria-label')).toContain('四元数')
    // 默认欧拉角为激活态。
    expect(buttons[0].classes()).toContain('active')
    expect(buttons[1].classes()).not.toContain('active')
    const labels = wrapper.findAll('.pose-cell span').map((node) => node.text())
    expect(labels).toEqual(['X', 'Y', 'Z', 'RX', 'RY', 'RZ'])
  })

  it('切换四元数后渲染 q1..q4，且 XYZ 不变', async () => {
    const wrapper = mount(PoseReadout, { props: { pose } })
    await wrapper.get('button:not(.active)').trigger('click')

    const cells = wrapper.findAll('.pose-cell')
    const labels = cells.map((node) => node.find('span').text())
    expect(labels).toEqual(['X', 'Y', 'Z', 'q1', 'q2', 'q3', 'q4'])
    const values = cells.map((node) => node.find('strong').text())
    // X/Y/Z 保持欧拉角路径不变；q1..q4 为 RAPID 四元数 [w,x,y,z]。
    expect(values.slice(0, 3)).toEqual(['451.0', '0.0', '807.1'])
    expect(values.slice(3)).toHaveLength(4)
  })

  it('单位姿态换算为 RAPID 四元数 [1,0,0,0]', async () => {
    const identity: PoseDisplay = { positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }
    const wrapper = mount(PoseReadout, { props: { pose: identity } })
    await wrapper.get('button:not(.active)').trigger('click')

    const quatCells = wrapper.findAll('.pose-grid.quat-grid strong').map((node) => node.text())
    expect(quatCells).toEqual(['1.0', '0.0', '0.0', '0.0'])
  })
})
