import type { MotionPlanningRequest, MotionPlanningResult } from '@/robot-motion-core/index.ts'

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

function now(): number { return typeof performance === 'undefined' ? Date.now() : performance.now() }

/** 常驻 Core Worker；这里只管理异步生命周期，不改变请求、策略或结果。 */
export function createMotionPlannerWorkerAdapter(): MotionPlannerWorkerAdapter {
  let worker: Worker | null = null
  let nextId = 0
  let active: { id: number; startedAt: number; resolve: (result: MotionPlanningResult | null) => void } | null = null
  let queued: { id: number; request: MotionPlanningRequest; resolve: (result: MotionPlanningResult | null) => void } | null = null

  const terminate = (): void => { worker?.terminate(); worker = null }
  const cancel = (): void => { nextId += 1; active?.resolve(null); queued?.resolve(null); active = null; queued = null }
  const dispose = (): void => { cancel(); terminate() }

  function start(request: { id: number; request: MotionPlanningRequest; resolve: (result: MotionPlanningResult | null) => void }): void {
    const current = ensureWorker()
    active = { id: request.id, startedAt: now(), resolve: request.resolve }
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
      active = null
      console.info('[MOTION-CORE-WORKER]', { requestId: current.id, computeMs: now() - current.startedAt, ok: event.data.result.ok })
      current.resolve(event.data.result)
      if (queued) { const next = queued; queued = null; start(next) }
    }
    created.onerror = () => {
      const current = active
      active = null
      terminate()
      current?.resolve(null)
      if (queued) { const next = queued; queued = null; start(next) }
    }
    worker = created
    return created
  }
  function plan(request: MotionPlanningRequest): Promise<MotionPlanningResult | null> {
    const id = ++nextId
    return new Promise((resolve) => {
      const next = { id, request, resolve }
      if (active) {
        active.resolve(null)
        active = null
        queued?.resolve(null)
        queued = null
        start(next)
      } else start(next)
    })
  }
  return { plan, cancel, dispose }
}
