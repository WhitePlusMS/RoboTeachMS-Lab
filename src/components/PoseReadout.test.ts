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
})
