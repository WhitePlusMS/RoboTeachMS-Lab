// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import JogControlTabs from './JogControlTabs.vue'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/index.ts'
import type { JointAngles, PoseDisplay } from '@/robot-geometry/model/index.ts'

const joints: JointAngles = [0, 0, 0, 0, 0, 0]
const pose: PoseDisplay = {
  positionMm: [451, 0, 807.1],
  orientationDeg: [0, 0, 0],
}

function mountTabs() {
  return mount(JogControlTabs, {
    attachTo: document.body,
    props: {
      joints,
      jointRanges: ABB_JOINT_RANGES,
      jointStep: 1,
      pose,
      coordinateSystem: 'World',
      positionStep: 1,
      orientationStep: 1,
      status: 'solved',
      statusMessage: '目标运动已提交',
    },
  })
}

describe('JogControlTabs 左侧 Jog 工作区', () => {
  it('默认显示关节 Tab，切换到笛卡尔后保留两个面板实例', async () => {
    const wrapper = mountTabs()
    const tabs = wrapper.findAll('[role="tab"]')

    expect(tabs).toHaveLength(2)
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(
      wrapper.get('[role="tabpanel"][aria-labelledby="jog-tab-joint"]').attributes('hidden'),
    ).toBeUndefined()
    expect(
      wrapper.get('[role="tabpanel"][aria-labelledby="jog-tab-cartesian"]').attributes('hidden'),
    ).toBeDefined()

    await tabs[1].trigger('click')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('[role="tabpanel"][aria-labelledby="jog-tab-joint"]')).toHaveLength(1)
    expect(
      wrapper.get('[role="tabpanel"][aria-labelledby="jog-tab-cartesian"]').attributes('hidden'),
    ).toBeUndefined()
  })

  it('支持左右方向键切换，并转发现有关节事件', async () => {
    const wrapper = mountTabs()
    const jointTab = wrapper.get('#jog-tab-joint')

    await jointTab.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.get('#jog-tab-cartesian').attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('#jog-tab-cartesian').element)

    await wrapper.get('#jog-tab-cartesian').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.get('#jog-tab-joint').attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('#jog-tab-joint').element)

    await wrapper.get('[aria-label="J1 增加角度"]').trigger('pointerdown')
    await wrapper.get('[aria-label="J1 增加角度"]').trigger('pointerup')
    expect(wrapper.emitted('adjust-joint')?.[0]).toEqual([0, 1, false])
  })
})
