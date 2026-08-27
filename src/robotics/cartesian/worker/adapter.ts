import { planMotion, type MotionPlanningRequest, type MotionPlanningResult } from '@/robot-motion-core/index.ts'

interface PlannerRequest {
  readonly requestId: number
  readonly request: MotionPlanningRequest
}
interface PlannerResponse { readonly requestId: number; readonly result: MotionPlanningResult }

export interface MotionPlannerWorkerAdapter {
  plan: (request: MotionPlanningRequest) => Promise<MotionPlanningResult | null>
  cancel: () => void
  dispose: () => void
}

/** 浏览器外的测试/SSR fallback 仍复用同一 adapter interface；生产浏览器优先使用常驻 Worker。 */
export function createMotionPlannerAdapter(): MotionPlannerWorkerAdapter {
  if (typeof Worker !== 'undefined') return createMotionPlannerWorkerAdapter()
  return {
    plan: async (request) => planMotion(request),
    cancel: () => undefined,
    dispose: () => undefined,
  }
}

function now(): number { return typeof performance === 'undefined' ? Date.now() : performance.now() }

/** Core Worker transport；请求淘汰时由 Coordinator 触发取消并释放当前 Worker。 */
export function createMotionPlannerWorkerAdapter(): MotionPlannerWorkerAdapter {
  let worker: Worker | null = null
  let nextId = 0
  let active: {
    id: number
    startedAt: number
    resolve: (result: MotionPlanningResult | null) => void
    settled: boolean
  } | null = null

  const terminate = (): void => { worker?.terminate(); worker = null }
  const settleActive = (result: MotionPlanningResult | null): void => {
    const current = active
    if (!current) return
    active = null
    if (!current.settled) current.resolve(result)
  }
  const cancel = (): void => {
    const hadActiveRequest = active !== null
    if (active && !active.settled) {
      active.settled = true
      active.resolve(null)
    }
    // 取消由 Coordinator 的 latest-only 状态管理；transport 只终止当前 Worker，
    // 使下一次 plan 可以立即创建新请求，不在浏览器消息队列中堆积旧请求。
    active = null
    if (hadActiveRequest) terminate()
  }
  const dispose = (): void => {
    cancel()
    active = null
    terminate()
  }

  function start(request: { id: number; request: MotionPlanningRequest; resolve: (result: MotionPlanningResult | null) => void }): void {
    const current = ensureWorker()
    active = { id: request.id, startedAt: now(), resolve: request.resolve, settled: false }
    current.postMessage({
      requestId: request.id,
      request: request.request,
    } satisfies PlannerRequest)
  }
  function ensureWorker(): Worker {
    if (worker) return worker
    const created = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    created.onmessage = (event: MessageEvent<PlannerResponse>) => {
      if (!active || event.data.requestId !== active.id) return
      const current = active
      console.info('[MOTION-CORE-WORKER]', { requestId: current.id, computeMs: now() - current.startedAt, ok: event.data.result.ok })
      settleActive(event.data.result)
    }
    created.onerror = () => {
      terminate()
      settleActive(null)
    }
    worker = created
    return created
  }
  function plan(request: MotionPlanningRequest): Promise<MotionPlanningResult | null> {
    const id = ++nextId
    return new Promise((resolve) => {
      if (active) {
        resolve(null)
        return
      }
      start({ id, request, resolve })
    })
  }
  return { plan, cancel, dispose }
}
