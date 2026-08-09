// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JointControlPanel from './JointControlPanel.vue'
import { KUKA_JOINT_RANGES } from '../robots/kuka-like/robot-config'
import type { JointAngles, PoseDisplay } from '../core/robot/types'

const joints: JointAngles = [0, 0, 0, 0, 0, 0]
const pose: PoseDisplay = {
  positionMm: [0, 0, 0],
  orientationDeg: [0, 0, 0],
}

function mountPanel() {
  return mount(JointControlPanel, {
    props: {
      joints,
      jointRanges: KUKA_JOINT_RANGES,
      jointStep: 1,
      pose,
    },
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('JointControlPanel', () => {
  it('普通按压会发出一次关节调整命令', async () => {
    const wrapper = mountPanel()
    const button = wrapper.get('[aria-label="J1 增加角度"]')

    await button.trigger('pointerdown')
    await button.trigger('pointerup')

    expect(wrapper.emitted('adjust-joint')?.[0]).toEqual([0, 1])
  })

  it('长按会发出多次连续调整命令', async () => {
    vi.useFakeTimers()
    const wrapper = mountPanel()
    const button = wrapper.get('[aria-label="J1 增加角度"]')

    await button.trigger('pointerdown')
    await vi.advanceTimersByTimeAsync(500)
    await button.trigger('pointerup')

    expect((wrapper.emitted('adjust-joint') ?? []).length).toBeGreaterThan(1)
  })

  it('手动输入、步进切换、回零和随机按钮均发出对应事件', async () => {
    const wrapper = mountPanel()

    const input = wrapper.get('[aria-label="J1 角度输入"]')
    await input.setValue('25.5')
    await input.trigger('change')
    await wrapper.findAll('.step-choice')[2].trigger('click')
    await wrapper.get('.secondary-action').trigger('click')
    await wrapper.findAll('.secondary-action')[1].trigger('click')

    expect(wrapper.emitted('set-joint')?.[0]).toEqual([0, 25.5])
    expect(wrapper.emitted('step-change')?.[0]).toEqual([5])
    expect(wrapper.emitted('reset')).toHaveLength(1)
    expect(wrapper.emitted('random')).toHaveLength(1)
  })
})
