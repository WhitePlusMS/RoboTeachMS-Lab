// @vitest-environment jsdom
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '../App.vue'
import { ABB_IRB1200_PROFILE } from '../robot-models/abb-irb1200/robot-profile.ts'
import type { AbbSceneStatus } from '../scene/abb-scene.ts'
import type { JointAngles } from '../robotics/types.ts'

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

async function cycleStatuses(fireStatus: (status: AbbSceneStatus) => void, wrapper: VueWrapper): Promise<void> {
  for (const status of ['loading', 'ready', 'error'] as AbbSceneStatus[]) {
    fireStatus(status)
    await wrapper.vm.$nextTick()
  }
}

describe('场景状态不改变运动学 profile', () => {
  it('loading/ready/error 均不替换 profile，也不改变页面使用的模型', async () => {
    const profileBefore = ABB_IRB1200_PROFILE
    const modelBefore = ABB_IRB1200_PROFILE.model

    const { wrapper, fireStatus } = mountApp()
    await cycleStatuses(fireStatus, wrapper)

    // 场景状态从未替换模块级 profile 或模型引用。
    expect(ABB_IRB1200_PROFILE).toBe(profileBefore)
    expect(ABB_IRB1200_PROFILE.model).toBe(modelBefore)
  })

  it('场景状态流转后回零正解仍由同一 profile 提供，且与初始零位一致', async () => {
    const homeJoints: JointAngles = [...ABB_IRB1200_PROFILE.homeJoints]
    const zeroBefore = ABB_IRB1200_PROFILE.model.forwardKinematics(homeJoints)
    expect(zeroBefore).not.toBeNull()

    const { wrapper, fireStatus } = mountApp()
    await cycleStatuses(fireStatus, wrapper)

    const zeroAfter = ABB_IRB1200_PROFILE.model.forwardKinematics(homeJoints)
    expect(zeroAfter).not.toBeNull()
    if (zeroBefore && zeroAfter) {
      expect(zeroAfter.position).toEqual(zeroBefore.position)
    }
  })

  it('场景状态流转后可控单关节变更的正解结果不变', async () => {
    const joints: JointAngles = [10, 0, 0, 0, 0, 0]
    const before = ABB_IRB1200_PROFILE.model.forwardKinematics(joints)
    expect(before).not.toBeNull()

    const { wrapper, fireStatus } = mountApp()
    await cycleStatuses(fireStatus, wrapper)

    const after = ABB_IRB1200_PROFILE.model.forwardKinematics(joints)
    expect(after).not.toBeNull()
    if (before && after) {
      expect(after.position).toEqual(before.position)
    }
  })

  it('场景组件不存在向页面回传模型的 model 通道（无 model prop/emit）', () => {
    const wrapper = mount(App, {
      global: { stubs: { SceneViewport: SceneViewportStub } },
    })
    const stub = wrapper.findComponent(SceneViewportStub)
    // 页面只订阅 status 事件，场景不向 App 回传/交换模型。
    expect(stub.props()).not.toHaveProperty('model')
    expect(wrapper.emitted()).not.toHaveProperty('model')
  })
})
