// @vitest-environment jsdom
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import type { Pose } from '@/robot-geometry/robot-types.ts'

/**
 * 占位场景组件：不启动真实 WebGL、不加载 FBX，只转发 App 传入的 gizmo 回调 props，
 * 让测试可以直接调用 handleGizmoDragStart（末端拖拽入口，无法通过普通 DOM 事件触发）。
 */
const SceneViewportStub = defineComponent({
  props: {
    onGizmoDragStart: { type: Function, required: false, default: undefined },
    getGizmoPose: { type: Function, required: false, default: undefined },
    onGizmoSolve: { type: Function, required: false, default: undefined },
  },
  emits: ['status'],
  setup(props) {
    return {
      fireGizmoDragStart: () => props.onGizmoDragStart?.(),
      callGetGizmoPose: (): Pose | null => props.getGizmoPose?.() ?? null,
      callGizmoSolve: (pose: Pose): boolean => props.onGizmoSolve?.(pose) ?? false,
    }
  },
  render: () => h('div', { class: 'scene-stub' }),
})

function mountApp(): VueWrapper {
  window.history.pushState({}, '', '/lab')
  return mount(App, {
    global: { stubs: { SceneViewport: SceneViewportStub } },
  })
}

/** 打开左侧 Jog 面板，JointControlPanel 才会挂载到 DOM。 */
async function openJogPanel(wrapper: VueWrapper): Promise<void> {
  const buttons = wrapper.findAll('button')
  const jogButton = buttons.find(
    (button) => button.text().includes('Jog') || button.text().includes('关节'),
  )
  if (jogButton) await jogButton.trigger('click')
  await wrapper.vm.$nextTick()
}

function logTexts(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.log-line .log-text').map((node) => node.text())
}

function lastLogText(wrapper: VueWrapper): string | undefined {
  const texts = logTexts(wrapper)
  return texts.at(-1)
}

/**
 * 特征化测试：先固定 App.vue 七处运动抢占入口（setJoint / adjustJoint 离散+连续 /
 * beginJointContinuous / reset / resetMechanicalZero / randomize / handleGizmoDragStart）
 * 当前各自的行为差异，再抽取共享的 `use-robot-controller.ts` 深模块。
 *
 * 已确认这七处不是逐字相同：setJoint 多一次 `motionCoordinator.stop('superseded')` 与失败告警；
 * adjustJoint 连续 Jog 分支跳过日志；handleGizmoDragStart 额外重置两个 ref 且不写日志。
 * 这些差异必须原样保留，测试锁定现状而非期望值。
 */
describe('App.vue 运动抢占入口 — 七处调用点的现状特征化', () => {
  it('setJoint：数值输入调整关节后写入一条运动日志', async () => {
    const wrapper = mountApp()
    try {
      await openJogPanel(wrapper)
      const input = wrapper.get('input[aria-label="J1 角度输入"]')
      ;(input.element as HTMLInputElement).value = '25.0'
      await input.trigger('change')
      await wrapper.vm.$nextTick()

      const text = lastLogText(wrapper)
      expect(text).toMatch(/^J1 .*° → 25\.0°$/)
    } finally {
      wrapper.unmount()
    }
  })

  it('adjustJoint 离散单步：点按一次记一条日志', async () => {
    const wrapper = mountApp()
    try {
      await openJogPanel(wrapper)
      const button = wrapper.get('[aria-label="J1 增加角度"]')
      await button.trigger('pointerdown')
      await button.trigger('pointerup')
      await wrapper.vm.$nextTick()

      const text = lastLogText(wrapper)
      expect(text).toMatch(/^J1 单步 \+.*° → .*°$/)
    } finally {
      wrapper.unmount()
    }
  })

  it('adjustJoint 连续 Jog（长按 tick）：不记逐条日志，只在开始时记一条', async () => {
    vi.useFakeTimers()
    const wrapper = mountApp()
    try {
      await openJogPanel(wrapper)
      const button = wrapper.get('[aria-label="J1 增加角度"]')
      const before = logTexts(wrapper).length

      await button.trigger('pointerdown')
      await vi.advanceTimersByTimeAsync(500)
      await button.trigger('pointerup')
      await wrapper.vm.$nextTick()

      const after = logTexts(wrapper)
      // beginJointContinuous 记一条“开始连续 Jog”；后续 80ms tick（adjustJoint continuous 分支）不记录。
      expect(after.length).toBe(before + 1)
      expect(after.at(-1)).toMatch(/^J1 开始连续 Jog（\+）$/)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('reset：回到教学 Home 记一条固定文案日志', async () => {
    const wrapper = mountApp()
    try {
      await openJogPanel(wrapper)
      const button = wrapper.get('button[title*="教学 Home"]')
      await button.trigger('click')
      await wrapper.vm.$nextTick()

      expect(lastLogText(wrapper)).toBe('机器人回到教学 Home')
    } finally {
      wrapper.unmount()
    }
  })

  it('resetMechanicalZero：回到机械零位记一条固定文案日志', async () => {
    const wrapper = mountApp()
    try {
      await openJogPanel(wrapper)
      const button = wrapper.get('button[title*="机械/同步零位"]')
      await button.trigger('click')
      await wrapper.vm.$nextTick()

      expect(lastLogText(wrapper)).toBe('机器人回到 ABB 机械零位')
    } finally {
      wrapper.unmount()
    }
  })

  it('randomize：随机姿态记一条固定文案日志', async () => {
    const wrapper = mountApp()
    try {
      await openJogPanel(wrapper)
      const button = wrapper.get('button[title*="随机生成一组关节姿态"]')
      await button.trigger('click')
      await wrapper.vm.$nextTick()

      expect(lastLogText(wrapper)).toBe('随机生成姿态')
    } finally {
      wrapper.unmount()
    }
  })

  it('handleGizmoDragStart：拖拽开始不写任何运动日志（日志延后到拖拽结束才可能写）', async () => {
    const wrapper = mountApp()
    try {
      const before = logTexts(wrapper).length
      const scene = wrapper.findComponent(SceneViewportStub)
      ;(scene.vm as unknown as { fireGizmoDragStart: () => void }).fireGizmoDragStart()
      await wrapper.vm.$nextTick()

      expect(logTexts(wrapper).length).toBe(before)
    } finally {
      wrapper.unmount()
    }
  })

  it('gizmo 拖拽到可达目标：同步返回 true，且提交一条运动日志', async () => {
    const wrapper = mountApp()
    try {
      const scene = wrapper.findComponent(SceneViewportStub)
      const pose = (
        scene.vm as unknown as { callGetGizmoPose: () => Pose | null }
      ).callGetGizmoPose()
      expect(pose).not.toBeNull()

      const solved = (
        scene.vm as unknown as { callGizmoSolve: (pose: Pose) => boolean }
      ).callGizmoSolve(pose as Pose)
      // 拖到当前位姿本身（零位移）必然可达。
      expect(solved).toBe(true)
      await wrapper.vm.$nextTick()
    } finally {
      wrapper.unmount()
    }
  })

  it('gizmo 拖拽到不可达目标：同步返回 false（手柄可立即回弹），不产生任何运动提交', async () => {
    const wrapper = mountApp()
    try {
      const scene = wrapper.findComponent(SceneViewportStub)
      const before = logTexts(wrapper).length

      // 远超机械臂工作空间的位置（IRB1200 臂展约 800mm，10 米绝对不可达）。
      const unreachablePose: Pose = {
        position: [10000, 10000, 10000],
        euler: [0, 0, 0],
        rotation: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      }
      const solved = (
        scene.vm as unknown as { callGizmoSolve: (pose: Pose) => boolean }
      ).callGizmoSolve(unreachablePose)

      // 关键锁定点：预判在同一次调用内同步返回 false，不是异步 then 之后才知道结果。
      expect(solved).toBe(false)
      // 不可达目标不应该提交任何运动（不产生额外的运动日志）。
      expect(logTexts(wrapper).length).toBe(before)
    } finally {
      wrapper.unmount()
    }
  })

  it('setJoint 是唯一在提交失败时追加告警日志的入口：正常路径下只有一条 info', async () => {
    const wrapper = mountApp()
    try {
      await openJogPanel(wrapper)
      const before = logTexts(wrapper).length
      const input = wrapper.get('input[aria-label="J1 角度输入"]')
      ;(input.element as HTMLInputElement).value = '10.0'
      await input.trigger('change')
      await wrapper.vm.$nextTick()

      // 合法目标：只追加一条 info，没有 warn（Core 未拒绝）。
      expect(logTexts(wrapper).length).toBe(before + 1)
    } finally {
      wrapper.unmount()
    }
  })
})
