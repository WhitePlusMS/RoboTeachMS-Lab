// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useStatusToasts } from './status-toasts.ts'
import { useToasts } from './toast.ts'
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

/** 触发快照切换并让 watcher 刷新。 */
async function apply(snapshot: { value: ProgramControllerSnapshot }, patch: object): Promise<void> {
  snapshot.value = makeSnapshot(patch)
  await nextTick()
}

describe('useStatusToasts 瞬态状态提示', () => {
  it('进入 running 时提示源程序锁定', async () => {
    const snapshot = ref(makeSnapshot())
    const toasts = useToasts()
    useStatusToasts(snapshot, toasts)

    await apply(snapshot, { state: 'running' })
    expect(toasts.toasts.value.at(-1)).toMatchObject({
      level: 'info',
      title: '源程序锁定',
    })
  })

  it('单步完成进入 stopped 时提示等待下一步', async () => {
    const snapshot = ref(makeSnapshot())
    const toasts = useToasts()
    useStatusToasts(snapshot, toasts)

    await apply(snapshot, { state: 'running' })
    await apply(snapshot, { state: 'stopped', stopReason: 'step-completed' })
    expect(toasts.toasts.value.at(-1)).toMatchObject({
      level: 'warn',
      title: '单步完成',
    })
  })

  it('进入 error 时提示程序错误', async () => {
    const snapshot = ref(makeSnapshot())
    const toasts = useToasts()
    useStatusToasts(snapshot, toasts)

    await apply(snapshot, {
      state: 'error',
      error: { index: 0, code: 'runtime-error', message: '目标不可达' },
    })
    expect(toasts.toasts.value.at(-1)).toMatchObject({
      level: 'err',
      title: '程序错误',
      text: '目标不可达',
    })
  })

  it('needsPPtoMain 由假变真时提示一次', async () => {
    const snapshot = ref(makeSnapshot())
    const toasts = useToasts()
    useStatusToasts(snapshot, toasts)

    await apply(snapshot, { state: 'stopped', needsPPtoMain: true })
    expect(toasts.toasts.value).toHaveLength(1)
    expect(toasts.toasts.value.at(-1)?.title).toBe('需 PP to Main')

    // 保持为真不再重复提示
    await apply(snapshot, { state: 'stopped', needsPPtoMain: true })
    expect(toasts.toasts.value).toHaveLength(1)
  })

  it('offPath 由假变真时提示偏离路径', async () => {
    const snapshot = ref(makeSnapshot())
    const toasts = useToasts()
    useStatusToasts(snapshot, toasts)

    await apply(snapshot, { state: 'stopped', offPath: true })
    expect(toasts.toasts.value.at(-1)).toMatchObject({
      level: 'warn',
      title: '偏离原程序路径',
    })
  })
})
