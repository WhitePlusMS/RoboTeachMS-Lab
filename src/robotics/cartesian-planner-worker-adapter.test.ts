import { afterEach, describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/robot-profile.ts'
import type { CartesianPathResult } from './cartesian-path-planner.ts'
import { createCartesianPlannerWorkerAdapter } from './cartesian-planner-worker-adapter.ts'
import type { JointAngles, Pose } from './types.ts'

const pose: Pose = {
  position: [1, 2, 3],
  euler: [0, 0, 0],
  rotation: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
}
const joints: JointAngles = [0, 0, 0, 0, 0, 0]
const success: CartesianPathResult = {
  ok: true,
  waypoints: [[1, 1, 1, 1, 1, 1]],
  usedWristFallback: false,
}

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<{ requestId: number; result: CartesianPathResult }>) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  requestId = 0
  initialJoints: JointAngles | null = null

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: { requestId: number; initialJoints: JointAngles }): void {
    this.requestId = message.requestId
    this.initialJoints = message.initialJoints
  }

  terminate(): void {
    this.terminated = true
  }

  complete(result: CartesianPathResult): void {
    this.onmessage?.({ data: { requestId: this.requestId, result } } as MessageEvent)
  }
}

afterEach(() => {
  FakeWorker.instances = []
  delete (globalThis as { Worker?: unknown }).Worker
})

describe('cartesian planner Worker adapter', () => {
  it('运行中的规划完成后只继续最新排队目标', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
    const adapter = createCartesianPlannerWorkerAdapter(ABB_IRB1200_PROFILE, () => [...joints])

    const first = adapter.plan(pose, joints)
    const second = adapter.plan(pose, joints)
    expect(FakeWorker.instances).toHaveLength(1)

    FakeWorker.instances[0].complete(success)
    await expect(first).resolves.toEqual(success)
    expect(FakeWorker.instances).toHaveLength(2)

    FakeWorker.instances[1].complete(success)
    await expect(second).resolves.toEqual(success)
    adapter.dispose()
  })

  it('显式取消会终止当前与排队规划', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
    const adapter = createCartesianPlannerWorkerAdapter(ABB_IRB1200_PROFILE, () => [...joints])

    const first = adapter.plan(pose, joints)
    const second = adapter.plan(pose, joints)
    const running = FakeWorker.instances[0]
    adapter.cancel()

    await expect(first).resolves.toBeNull()
    await expect(second).resolves.toBeNull()
    expect(running.terminated).toBe(true)
  })

  it('排队规划启动时读取当前关节，而不是沿用入队快照', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
    let currentJoints: JointAngles = [0, 0, 0, 0, 0, 0]
    const adapter = createCartesianPlannerWorkerAdapter(
      ABB_IRB1200_PROFILE,
      () => [...currentJoints] as JointAngles,
    )

    const first = adapter.plan(pose, currentJoints)
    currentJoints = [5, 5, 5, 5, 5, 5]
    const second = adapter.plan(pose, [1, 1, 1, 1, 1, 1])
    currentJoints = [9, 9, 9, 9, 9, 9]

    FakeWorker.instances[0].complete(success)
    await expect(first).resolves.toEqual(success)
    expect(FakeWorker.instances[1].initialJoints).toEqual(currentJoints)

    FakeWorker.instances[1].complete(success)
    await expect(second).resolves.toEqual(success)
    adapter.dispose()
  })

  it('规划期间当前关节已推进时丢弃旧结果并从当前位置重规划', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
    let currentJoints: JointAngles = [0, 0, 0, 0, 0, 0]
    const adapter = createCartesianPlannerWorkerAdapter(
      ABB_IRB1200_PROFILE,
      () => [...currentJoints] as JointAngles,
    )

    const result = adapter.plan(pose, currentJoints)
    currentJoints = [5, 5, 5, 5, 5, 5]

    FakeWorker.instances[0].complete(success)
    await Promise.resolve()

    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[1].initialJoints).toEqual(currentJoints)

    FakeWorker.instances[1].complete(success)
    await expect(result).resolves.toEqual(success)
    adapter.dispose()
  })

  it('同一目标最多漂移重算一次，不因持续运动无限占用 Worker', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
    let currentJoints: JointAngles = [0, 0, 0, 0, 0, 0]
    const adapter = createCartesianPlannerWorkerAdapter(
      ABB_IRB1200_PROFILE,
      () => [...currentJoints] as JointAngles,
    )

    const result = adapter.plan(pose, currentJoints)
    currentJoints = [5, 5, 5, 5, 5, 5]
    FakeWorker.instances[0].complete(success)
    await Promise.resolve()

    expect(FakeWorker.instances).toHaveLength(2)
    currentJoints = [10, 10, 10, 10, 10, 10]
    FakeWorker.instances[1].complete(success)
    await expect(result).resolves.toEqual(success)
    expect(FakeWorker.instances).toHaveLength(2)
    adapter.dispose()
  })

  it('连续规划中的小于一度自然漂移直接接续，不触发额外 IK', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
    let currentJoints: JointAngles = [0, 0, 0, 0, 0, 0]
    const adapter = createCartesianPlannerWorkerAdapter(
      ABB_IRB1200_PROFILE,
      () => [...currentJoints] as JointAngles,
    )

    const result = adapter.plan(pose, currentJoints)
    currentJoints = [0.6, 0.6, 0.6, 0.6, 0.6, 0.6]
    FakeWorker.instances[0].complete(success)

    await expect(result).resolves.toEqual(success)
    expect(FakeWorker.instances).toHaveLength(1)
    adapter.dispose()
  })
})
