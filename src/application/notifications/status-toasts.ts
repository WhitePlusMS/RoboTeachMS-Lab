import { watch, type Ref } from 'vue'
import type { ProgramSessionSnapshot } from '@/application/program/use-program-session.ts'
import type { ToastController } from './toast.ts'

/**
 * 把程序状态切换映射为瞬态 toast 通知（显示数秒后自动消失），作为运行日志的视觉补充：
 * 状态变化发生时弹出提示，不占用卡片/面板下方常驻空间；完整记录仍保留在 run-log 中。
 * 仅在条件由成立变为成立的一次性转换时触发，避免同一状态反复刷屏。
 */
export function useStatusToasts(
  snapshot: Ref<ProgramSessionSnapshot>,
  toasts: ToastController,
): void {
  // 以上一次快照的相关字段为触发基线；初始化为当前快照，使首次状态切换也能命中。
  let toastsSeen: Pick<ProgramSessionSnapshot, 'state' | 'needsPPtoMain' | 'offPath'> = {
    state: snapshot.value.state,
    needsPPtoMain: snapshot.value.needsPPtoMain,
    offPath: snapshot.value.offPath,
  }

  watch(
    () => snapshot.value,
    (snap) => {
      const previous = toastsSeen
      toastsSeen = {
        state: snap.state,
        needsPPtoMain: snap.needsPPtoMain,
        offPath: snap.offPath,
      }

      if (snap.state === 'running' && previous.state !== 'running') {
        toasts.push('info', '源程序锁定', '程序运行期间，源程序已锁定，不可编辑。')
      }

      if (
        snap.state === 'stopped' &&
        snap.stopReason === 'step-completed' &&
        previous.state !== 'stopped'
      ) {
        toasts.push('warn', '单步完成', '单步已完成，等待下一步；可继续单步或运行。')
      }

      if (snap.state === 'error' && previous.state !== 'error' && snap.error) {
        toasts.push('err', '程序错误', snap.error.message)
      }

      if (snap.needsPPtoMain && !previous.needsPPtoMain) {
        toasts.push(
          'warn',
          '需 PP to Main',
          '停止后源码无法稳定映射当前程序指针，请先执行 PP to Main 以从 main 重新建立执行位置。',
        )
      }

      if (snap.offPath && !previous.offPath) {
        toasts.push(
          'warn',
          '偏离原程序路径',
          '机器人已被手动 Jog，偏离原程序路径：再次运行/单步将从当前位置规划到下一目标。',
        )
      }
    },
  )
}
