// @vitest-environment jsdom
import { defineComponent, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import PresetLibraryDialog from './PresetLibraryDialog.vue'
import { RAPID_PRESET_PROGRAMS } from '@/application/program/preset-programs.ts'

/**
 * 宿主：复现 RapidPresetSelector 对 PresetLibraryDialog 的真实绑定——
 * 响应 update:open（关闭库）并转发 load 事件。
 */
const Host = defineComponent({
  components: { PresetLibraryDialog },
  props: {
    sourceEdited: { type: Boolean, default: false },
  },
  emits: ['load'],
  setup: () => {
    const open = ref(true)
    return { open }
  },
  template: `<PresetLibraryDialog :open="open" :source-edited="sourceEdited" @update:open="open = $event" @load="$emit('load', $event)" />`,
})

function mountLibrary(options: { sourceEdited?: boolean } = {}) {
  return mount(Host, {
    attachTo: document.body,
    props: { sourceEdited: options.sourceEdited ?? false },
  })
}

function libraryRoot(): HTMLElement | null {
  return document.body.querySelector('.lib-panel')
}

function libItems(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('.lib-item'))
}

function confirmDialog(): HTMLElement | null {
  return document.body.querySelector('[aria-label="加载预设程序"]')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PresetLibraryDialog 全屏预设库', () => {
  it('打开时列出全部预设', () => {
    const wrapper = mountLibrary()
    expect(libraryRoot()).not.toBeNull()
    expect(libItems()).toHaveLength(RAPID_PRESET_PROGRAMS.length)
    expect((wrapper.vm as { open: boolean }).open).toBe(true)
  })

  it('点某预设打开确认弹窗；确认后 emit load 该预设并关闭库', async () => {
    const wrapper: VueWrapper = mountLibrary()
    const preset = RAPID_PRESET_PROGRAMS[2]
    const targetItem = libItems().find((item) => item.textContent?.includes(preset.name))
    expect(targetItem).toBeDefined()
    await targetItem!.querySelector<HTMLButtonElement>('button')!.click()

    // ConfirmDialog teleport 到 body，确认前不 emit load。
    expect(confirmDialog()).not.toBeNull()
    expect(wrapper.emitted('load')).toBeUndefined()

    const confirmButton = document.body.querySelector('.preset-btn-primary')
    expect(confirmButton).not.toBeNull()
    await (confirmButton as HTMLButtonElement).click()

    expect(wrapper.emitted('load')).toEqual([[preset]])
    expect(libraryRoot()).toBeNull()
  })

  it('取消确认不触发 load，库保持打开，确认框关闭', async () => {
    const wrapper = mountLibrary()
    await libItems()[0]!.querySelector<HTMLButtonElement>('button')!.click()
    expect(confirmDialog()).not.toBeNull()

    const cancelButton = document.body.querySelector<HTMLButtonElement>(
      '.confirm-foot button:not(.preset-btn-primary)',
    )
    expect(cancelButton).not.toBeNull()
    await cancelButton!.click()

    expect(wrapper.emitted('load')).toBeUndefined()
    expect(confirmDialog()).toBeNull()
    expect(libraryRoot()).not.toBeNull()
  })

  it('sourceEdited 为真时确认文案提示覆盖已修改内容', async () => {
    mountLibrary({ sourceEdited: true })
    await libItems()[0]!.querySelector<HTMLButtonElement>('button')!.click()
    const message = document.body.querySelector('.confirm-body p')
    expect(message?.textContent).toContain('已修改')
    expect(message?.textContent).toContain('覆盖')
  })
})
