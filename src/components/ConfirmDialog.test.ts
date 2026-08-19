// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ConfirmDialog from './ConfirmDialog.vue'

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ConfirmDialog, {
    attachTo: document.body,
    props: {
      open: true,
      title: '测试标题',
      ...props,
    },
  })
}

function dialogRoot(): HTMLElement | null {
  return document.body.querySelector('[aria-label="测试标题"]')
}

function buttons(): NodeListOf<HTMLButtonElement> {
  const root = dialogRoot()
  return (
    root?.querySelectorAll('.confirm-foot button') ??
    ([] as unknown as NodeListOf<HTMLButtonElement>)
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ConfirmDialog 通用确认弹窗', () => {
  it('关闭时不渲染；打开时通过 Teleport 渲染到 body，展示标题与按钮', () => {
    mountDialog({ open: false })
    expect(dialogRoot()).toBeNull()

    mountDialog({ message: '正文内容' })
    const root = dialogRoot()
    expect(root).not.toBeNull()
    expect(root?.querySelector('.confirm-title')?.textContent).toBe('测试标题')
    expect(root?.querySelector('.confirm-body p')?.textContent).toBe('正文内容')
    const btn = buttons()
    expect(btn[0]?.textContent).toBe('取消')
    expect(btn[1]?.textContent).toBe('确认')
  })

  it('点确认 emit confirm 且不改变 open（由父级决定关闭）', async () => {
    const wrapper = mountDialog()
    await buttons()[1]!.click()
    expect(wrapper.emitted('confirm')).toBeTruthy()
    expect(wrapper.emitted('update:open')).toBeFalsy()
    expect(dialogRoot()).not.toBeNull()
  })

  it('点取消 emit cancel 并向 update:open 写 false', async () => {
    const wrapper = mountDialog()
    await buttons()[0]!.click()
    expect(wrapper.emitted('cancel')).toBeTruthy()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('点标题栏关闭按钮发出 update:open false', async () => {
    const wrapper = mountDialog()
    await dialogRoot()?.querySelector<HTMLButtonElement>('.confirm-close')!.click()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('危险模式确认按钮使用危险样式类', () => {
    mountDialog({ danger: true })
    expect(document.body.querySelector('.preset-btn-primary')).toBeNull()
    expect(document.body.querySelector('.preset-btn-danger')).not.toBeNull()
  })

  it('Esc 关闭发出 update:open false，关闭后移除监听', async () => {
    const wrapper = mountDialog()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
