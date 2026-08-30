import { planMotion, type MotionPlanningRequest, type MotionPlanningResult } from '@/robot-motion-core/index.ts'
import type { MotionSource } from '@/application/motion-coordinator.ts'

interface PlannerRequest {
  readonly requestId: number
  readonly request: MotionPlanningRequest
}
interface PlannerResponse { readonly requestId: number; readonly result: MotionPlanningResult }

/** gizmo 拖拽和笛卡尔连续点动走主线程同步直调 planMotion（复刻旧版本 5391fad 的低延迟
 *  路径，零 Worker 往返）；其余来源（RAPID、关节 Jog、离散笛卡尔目标）继续走常驻 Worker，
 *  行为不变。两条路径调用同一个 planMotion，不存在第二套规划实现——这里只是 transport 选择。 */
function isSyncTransportSource(source: MotionSource): boolean {
  return source === 'gizmo' || source === 'manual-cartesian'
}

/**
 * 同步预判笛卡尔目标可达性；供 gizmo 拖拽等下游 UI 需要在同一调用栈内判断"能不能到达"
 * 的场景使用（如 TransformControls 的 objectChange 回调，同步返回 false 才能立即回弹，
 * 不能等一次异步往返）。调用的是与 gizmo/笛卡尔点动 transport 完全相同的 planMotion，
 * 不是第二套规划实现，只是把已经同步可用的规划结果提前暴露给需要同步判断的调用方。
 */
export function planCartesianTargetSync(request: MotionPlanningRequest): MotionPlanningResult {
  return planMotion(request)
}

export interface MotionPlannerWorkerAdapter {
  plan: (request: MotionPlanningRequest, source: MotionSource) => Promise<MotionPlanningResult | null>
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
  function plan(request: MotionPlanningRequest, source: MotionSource): Promise<MotionPlanningResult | null> {
    if (isSyncTransportSource(source)) return Promise.resolve(planMotion(request))
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
