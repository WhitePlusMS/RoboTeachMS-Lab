// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PoseReadout from './PoseReadout.vue'
import type { JointAngles, PoseDisplay } from '@/robotics/model/index.ts'

const pose: PoseDisplay = {
  positionMm: [451.04, 0, 807.06],
  orientationDeg: [180, 0, -90.02],
}
const joints: JointAngles = [1.25, -2.5, 3.75, -4.1, 5.2, -6.3]

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
    expect(buttons).toHaveLength(3)
    expect(buttons[0].attributes('aria-label')).toContain('欧拉角')
    expect(buttons[1].attributes('aria-label')).toContain('四元数')
    expect(buttons[2].attributes('aria-label')).toContain('六轴')
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

  it('切换六轴后按 J1..J6 顺序显示关节角，且每个读数允许文本选取', async () => {
    const wrapper = mount(PoseReadout, { props: { pose, joints } })
    await wrapper.get('button[aria-label="六轴关节 J1..J6"]').trigger('click')

    const labels = wrapper.findAll('.pose-cell span').map((node) => node.text())
    expect(labels).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6'])
    const values = wrapper.findAll('.pose-cell strong').map((node) => node.text())
    expect(values).toEqual(['1.3', '-2.5', '3.8', '-4.1', '5.2', '-6.3'])
    expect(wrapper.findAll('.pose-cell')).toHaveLength(6)
  })

  it('复制按钮复制当前选中的视图，而不是固定复制欧拉角', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const wrapper = mount(PoseReadout, { props: { pose, joints } })
    await wrapper.get('button[aria-label="六轴关节 J1..J6"]').trigger('click')
    await wrapper.get('.copy-readout').trigger('click')

    expect(writeText).toHaveBeenCalledWith(
      'J1: 1.3\tJ2: -2.5\tJ3: 3.8\tJ4: -4.1\tJ5: 5.2\tJ6: -6.3',
    )
    expect(wrapper.get('.copy-readout').attributes('aria-label')).toBe('已复制当前读数')
  })
})
