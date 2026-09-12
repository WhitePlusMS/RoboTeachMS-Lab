// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SceneViewport from './SceneViewport.vue'
import type { JointAngles } from '@/robot-geometry/robot-types.ts'

vi.mock('../scene/abb-scene.ts', () => ({
  createAbbScene: () => {
    throw new Error('THREE.WebGLRenderer: Error creating WebGL context.')
  },
}))

const joints: JointAngles = [0, 0, 0, 0, 0, 0]

describe('SceneViewport WebGL 降级', () => {
  it('WebGL context 创建失败时不冒泡崩溃，并显示场景不可用提示', async () => {
    const wrapper = mount(SceneViewport, {
      props: {
        joints,
        showGrid: true,
        showCoordinateSystems: true,
        showDhDebug: true,
        showTrajectory: false,
        trajectoryCount: 0,
      },
    })

    await nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('WebGL')
    expect(wrapper.emitted('status')?.at(-1)).toEqual(['error'])
  })
})
