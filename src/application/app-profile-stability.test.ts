// @vitest-environment jsdom
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import type { AbbSceneStatus } from '@/scene/abb-scene.ts'
import type { JointAngles } from '@/robotics/types.ts'

/**
 * 占位场景组件：不启动真实 WebGL、不加载 FBX，只转发页面可能收到的场景状态。
 * 通过 stub 实例暴露 fireStatus，驱动 App 的 loading/ready/error 流转。
 */
const SceneViewportStub = defineComponent({
  emits: ['status'],
  setup(_props, { emit }) {
    return {
      fireStatus: (status: AbbSceneStatus) => emit('status', status),
    }
  },
  render: () => h('div', { class: 'scene-stub' }),
})

function mountApp(): { wrapper: VueWrapper; fireStatus: (status: AbbSceneStatus) => void } {
  const wrapper = mount(App, {
    global: { stubs: { SceneViewport: SceneViewportStub } },
  })
  const stub = wrapper.findComponent(SceneViewportStub)
  const fireStatus = stub.vm.fireStatus as (status: AbbSceneStatus) => void
  return { wrapper, fireStatus }
}

describe('场景状态不改变运动学 profile', () => {
  it('loading/ready/error 后，关节输入仍通过唯一 profile 模型更新页面 FK', async () => {
    const cases: readonly {
      status: AbbSceneStatus
      label: string
      joints: JointAngles
    }[] = [
      { status: 'loading', label: '正在加载模型', joints: [10, 0, 0, 0, 0, 0] },
      { status: 'ready', label: '场景已就绪', joints: [20, 0, 0, 0, 0, 0] },
      { status: 'error', label: '场景几何加载失败，使用占位显示', joints: [30, 0, 0, 0, 0, 0] },
    ]
    const expectedPositions = cases.map(({ joints }) => {
      const pose = ABB_IRB1200_PROFILE.model.forwardKinematics(joints)
      if (!pose) throw new Error(`测试关节不可正解：${joints.join(',')}`)
      return pose.position.map((value) => value.toFixed(1))
    })
    const fkSpy = vi.spyOn(ABB_IRB1200_PROFILE.model, 'forwardKinematics')
    const { wrapper, fireStatus } = mountApp()

    try {
      const scene = wrapper.findComponent(SceneViewportStub)
      expect(scene.props()).not.toHaveProperty('model')

      for (const [index, testCase] of cases.entries()) {
        fireStatus(testCase.status)
        await wrapper.vm.$nextTick()
        expect(wrapper.get('.status-pill').text()).toContain(testCase.label)

        fkSpy.mockClear()
        const input = wrapper.get('input[aria-label="J1 角度输入"]')
        ;(input.element as HTMLInputElement).value = String(testCase.joints[0])
        await input.trigger('change')

        expect(fkSpy).toHaveBeenCalledWith(testCase.joints)
        const displayedPosition = wrapper
          .findAll('.pose-card[aria-label="正解结果"] .pose-grid strong')
          .slice(0, 3)
          .map((node) => node.text())
        expect(displayedPosition).toEqual(expectedPositions[index])
      }
    } finally {
      wrapper.unmount()
      fkSpy.mockRestore()
    }
  })
})
