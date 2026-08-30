import { afterEach, describe, expect, it } from 'vitest'
import { planMotion, type MotionPlanningRequest, type MotionPlanningResult } from '@/robot-motion-core/index.ts'
import { createCartesianTargetRequest } from '@/application/motion-requests.ts'
import { createMotionPlannerWorkerAdapter } from './adapter.ts'

const request = createCartesianTargetRequest(
  { position: [1, 2, 3], euler: [0, 0, 0], rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  [0, 0, 0, 0, 30, 0],
)

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<{ requestId: number; result: MotionPlanningResult }>) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  requestId = 0
  request: MotionPlanningRequest | null = null
  constructor() { FakeWorker.instances.push(this) }
  postMessage(message: { requestId: number; request: MotionPlanningRequest }): void { this.requestId = message.requestId; this.request = message.request }
  terminate(): void { this.terminated = true }
  complete(result: MotionPlanningResult): void { this.onmessage?.({ data: { requestId: this.requestId, result } } as MessageEvent) }
  fail(): void { this.onerror?.() }
}

afterEach(() => { FakeWorker.instances = []; delete (globalThis as { Worker?: unknown }).Worker })

describe('Core Worker adapter', () => {
  it('对同一请求保持 Core 直调与 Worker 结果一致', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
    const adapter = createMotionPlannerWorkerAdapter()
    const pending = adapter.plan(request, 'rapid')
    FakeWorker.instances[0].complete(planMotion(request))
    await expect(pending).resolves.toEqual(planMotion(JSON.parse(JSON.stringify(request))))
    adapter.dispose()
  })

  it('取消活动规划会终止旧 Worker，下一请求只进入新 transport', async () => {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker })
    const adapter = createMotionPlannerWorkerAdapter()
    const first = adapter.plan(request, 'rapid')
    adapter.cancel()
    const secondRequest = { ...request, state: { jointsDeg: [1, 1, 1, 1, 30, 1] as MotionPlanningRequest['state']['jointsDeg'] } }
    const second = adapter.plan(secondRequest, 'rapid')
    await expect(first).resolves.toBeNull()
    expect(FakeWorker.instances[0].terminated).toBe(true)
    expect(FakeWorker.instances[0].request).toEqual(request)
    expect(FakeWorker.instances[1].request).toEqual(secondRequest)
    adapter.cancel()
    await expect(second).resolves.toBeNull()
    expect(FakeWorker.instances[1].terminated).toBe(true)
    adapter.dispose()
  })
})
