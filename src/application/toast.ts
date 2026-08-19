import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

export type ToastLevel = 'info' | 'ok' | 'warn' | 'err'

export interface ToastMessage {
  id: number
  level: ToastLevel
  title: string
  text: string
}

/** 瞬态通知在屏幕上停留的毫秒数，到期自动消失。 */
export const TOAST_DURATION = 3400

/**
 * 轻量 toast 通知：瞬态状态提示（如源程序锁定、需 PP to Main、偏离路径）在
 * 状态切换时弹出，数秒后自动消失，不占用卡片/面板下方常驻空间。
 * 事件也会同步写入运行日志（run-log），因此日志仍是完整审计记录。
 */
export interface ToastController {
  toasts: Ref<ToastMessage[]>
  push: (level: ToastLevel, title: string, text: string) => void
  dismiss: (id: number) => void
}

export const ToastKey: InjectionKey<ToastController> = Symbol('toast')

/** App 提供全局 toast 控制器；整棵组件树经 inject 使用。 */
export function provideToasts(controller: ToastController): void {
  provide(ToastKey, controller)
}

/** 组件/控制器 inject toast；无提供方（独立测试挂载）时返回 null。 */
export function injectToasts(): ToastController | null {
  return inject(ToastKey, null)
}

/** 创建 toast 控制器：维护列表并为每条 toast 启动自动消失计时。 */
export function useToasts(): ToastController {
  const toasts = ref<ToastMessage[]>([])
  let nextId = 1

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  function push(level: ToastLevel, title: string, text: string): void {
    const id = nextId
    nextId += 1
    toasts.value.push({ id, level, title, text })
    window.setTimeout(() => dismiss(id), TOAST_DURATION)
  }

  return { toasts, push, dismiss }
}
