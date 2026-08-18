import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { RUN_LOG_CAP, useRunLog } from './run-log.ts'
import type { ProgramControllerSnapshot } from './program-control.ts'

function makeSnapshot(
  overrides: Partial<ProgramControllerSnapshot> = {},
): ProgramControllerSnapshot {
  return {
    state: 'idle',
    programPointer: 0,
    motionPointer: null,
    stopReason: null,
    error: null,
    variables: new Map(),
    diagnostics: [],
    needsPPtoMain: false,
    offPath: false,
    ...overrides,
  }
}

describe('useRunLog 程序日志数据流', () => {
  it('按状态迁移生成带级别的条目', async () => {
    const snapshot = ref(makeSnapshot())
    const log = useRunLog(snapshot)

    snapshot.value = makeSnapshot({ state: 'running' })
    await nextTick()
    snapshot.value = makeSnapshot({ state: 'stopped', stopReason: 'step-completed' })
    await nextTick()
    snapshot.value = makeSnapshot({ state: 'running', programPointer: 1 })
    await nextTick()
    snapshot.value = makeSnapshot({ state: 'completed', programPointer: 3 })
    await nextTick()

    expect(log.entries.value.map((entry) => [entry.level, entry.text])).toEqual([
      ['info', '运行请求'],
      ['warn', '单步已完成，等待下一步'],
      ['info', '运行请求'],
      ['ok', '运行完成'],
    ])
    expect(log.entries.value.every((entry) => /^\d{2}:\d{2}:\d{2}$/.test(entry.time))).toBe(true)
  })

  it('诊断从无到有记一条错误，清除后记一条恢复', async () => {
    const snapshot = ref(makeSnapshot())
    const log = useRunLog(snapshot)

    snapshot.value = makeSnapshot({
      diagnostics: [
        {
          code: 'undefined-symbol',
          severity: 'error',
          message: '未定义 robtarget pX',
          range: {
            start: { offset: 10, line: 4, column: 15 },
            end: { offset: 12, line: 4, column: 17 },
          },
        },
      ],
    })
    await nextTick()
    expect(log.entries.value.at(-1)?.level).toBe('err')
    expect(log.entries.value.at(-1)?.text).toContain('undefined-symbol')

    snapshot.value = makeSnapshot()
    await nextTick()
    expect(log.entries.value.at(-1)?.level).toBe('ok')
  })

  it('条目数封顶 RUN_LOG_CAP', () => {
    const snapshot = ref(makeSnapshot())
    const log = useRunLog(snapshot)
    for (let index = 0; index < RUN_LOG_CAP + 20; index += 1) {
      log.append('info', '程序', `条目 ${index}`)
    }
    expect(log.entries.value).toHaveLength(RUN_LOG_CAP)
    expect(log.entries.value.at(-1)?.text).toBe(`条目 ${RUN_LOG_CAP + 19}`)
  })
})
