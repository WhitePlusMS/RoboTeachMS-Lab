// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import RapidPresetSelector from './RapidPresetSelector.vue'
import { RAPID_PRESET_PROGRAMS } from '@/application/preset-programs.ts'

const BUILTIN = `MODULE TeachingDemo
    CONST robtarget pApproach := [[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ pApproach,v200,fine,tool0;
    ENDPROC
ENDMODULE`

function mountSelector(
  source: string,
  options: { running?: boolean; initialSource?: string } = {},
) {
  return mount(RapidPresetSelector, {
    attachTo: document.body,
    props: {
      source,
      running: options.running ?? false,
      initialSource: options.initialSource ?? BUILTIN,
    },
  })
}

/** Teleport 到 body 的全屏预设库（省去 confirm step 之前的列表项）。 */
function libraryRoot(): HTMLElement | null {
  return document.body.querySelector('.lib-panel')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('RapidPresetSelector 预设程序入口', () => {
  it('面板内只渲染一个「预设程序」入口按钮，未打开时无预设库弹窗', () => {
    const wrapper = mountSelector(BUILTIN)
    const button = wrapper.get('button')
    expect(button.text()).toContain('预设程序')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(libraryRoot()).toBeNull()
  })

  it('点击入口打开全屏预设库，列出全部 6 个预设', async () => {
    const wrapper = mountSelector(BUILTIN)
    await wrapper.get('button').trigger('click')
    const root = libraryRoot()
    expect(root).not.toBeNull()
    expect(root?.querySelectorAll('.lib-item')).toHaveLength(RAPID_PRESET_PROGRAMS.length)
  })

  it('运行中禁止打开预设库', async () => {
    const wrapper = mountSelector(BUILTIN, { running: true })
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    await wrapper.get('button').trigger('click')
    expect(libraryRoot()).toBeNull()
    expect(wrapper.emitted('load')).toBeUndefined()
  })
})
