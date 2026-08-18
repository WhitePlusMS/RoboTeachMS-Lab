import { ref, watch, type Ref } from 'vue'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'

export type RunLogLevel = 'info' | 'ok' | 'warn' | 'err'

export interface RunLogEntry {
  id: number
  /** HH:MM:SS 本地时间戳。 */
  time: string
  level: RunLogLevel
  /** 来源标签（程序 / 运动 / 错误…），面板渲染为 [tag]。 */
  tag: string
  text: string
}

/** 日志条数上限，超出后丢弃最旧条目。 */
export const RUN_LOG_CAP = 200

export interface RunLogController {
  entries: Ref<RunLogEntry[]>
  append: (level: RunLogLevel, tag: string, text: string) => void
}

function timestamp(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

/**
 * 底部日志栏数据流：观察程序快照的 state 迁移 / 运行时错误 / 静态诊断，
 * 生成带级别的时间戳条目；不持有程序状态，只做派生记录。
 */
export function useRunLog(snapshot: Ref<ProgramControllerSnapshot>): RunLogController {
  const entries = ref<RunLogEntry[]>([])
  let nextId = 1

  function append(level: RunLogLevel, tag: string, text: string): void {
    entries.value.push({ id: nextId, time: timestamp(), level, tag, text })
    nextId += 1
    if (entries.value.length > RUN_LOG_CAP) {
      entries.value.splice(0, entries.value.length - RUN_LOG_CAP)
    }
  }

  watch(
    () => snapshot.value.state,
    (state, previous) => {
      if (state === previous) return
      switch (state) {
        case 'running':
          append('info', '程序', '运行请求')
          break
        case 'stopped':
          if (snapshot.value.stopReason === 'step-completed') {
            append('warn', '程序', '单步已完成，等待下一步')
          } else {
            append('warn', '程序', '已停止')
          }
          break
        case 'completed':
          append('ok', '程序', '运行完成')
          break
        case 'error':
          append('err', '错误', snapshot.value.error?.message ?? '程序进入错误状态')
          break
        case 'idle':
          append('info', '程序', 'PP 已回到 main，等待运行')
          break
      }
    },
  )

  // 静态诊断：从无到有时记录一条；全部消除时记录恢复。
  watch(
    () => snapshot.value.diagnostics.length,
    (count, previous) => {
      if (count > 0 && previous === 0) {
        const first = snapshot.value.diagnostics[0]
        append(
          'err',
          '错误',
          `RAPID 诊断 ${count} 项 · 行 ${first.range.start.line} ${first.code} — ${first.message}`,
        )
      } else if (count === 0 && previous > 0) {
        append('ok', '程序', 'RAPID 诊断已清除')
      }
    },
  )

  return { entries, append }
}
