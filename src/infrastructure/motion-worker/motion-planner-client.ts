import {
  planMotion,
  type MotionPlanningRequest,
  type MotionPlanningResult,
} from '@/robot-motion-core/index.ts'
import type { MotionSource } from '@/application/motion/motion-coordinator.ts'

interface PlannerRequest {
  readonly requestId: number
  readonly request: MotionPlanningRequest
}
interface PlannerResponse {
  readonly requestId: number
  readonly result: MotionPlanningResult
}

/** gizmo 拖拽和笛卡尔连续点动走主线程同步直调 planMotion（复刻旧版本 5391fad 的低延迟
 *  路径，零 Worker 往返）；其余来源（RAPID、关节 Jog、离散笛卡尔目标）继续走常驻 Worker，
 *  行为不变。两条路径调用同一个 planMotion，不存在第二套规划实现——这里只是 transport 选择。 */
function isSyncTransportSource(source: MotionSource): boolean {
  return source === 'gizmo' || source === 'manual-cartesian'
}

export interface MotionPlannerClient {
  /** 同步拖拽预判；下一次相同请求消费此结果，其他请求立即淘汰。 */
  preview: (request: MotionPlanningRequest) => MotionPlanningResult
  plan: (
    request: MotionPlanningRequest,
    source: MotionSource,
  ) => Promise<MotionPlanningResult | null>
  cancel: () => void
  dispose: () => void
}

/** 浏览器外的测试/SSR fallback 仍复用同一 adapter interface；生产浏览器优先使用常驻 Worker。 */
export function createMotionPlannerClient(): MotionPlannerClient {
  if (typeof Worker !== 'undefined') return createWorkerMotionPlannerClient()
  return withPreview({
    plan: async (request) => planMotion(request),
    cancel: () => undefined,
    dispose: () => undefined,
  })
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/** Core Worker transport；请求淘汰时由 Coordinator 触发取消并释放当前 Worker。 */
export function createWorkerMotionPlannerClient(): MotionPlannerClient {
  let worker: Worker | null = null
  let nextId = 0
  let active: {
    id: number
    startedAt: number
    resolve: (result: MotionPlanningResult | null) => void
    settled: boolean
  } | null = null

  const terminate = (): void => {
    worker?.terminate()
    worker = null
  }
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

  function start(request: {
    id: number
    request: MotionPlanningRequest
    resolve: (result: MotionPlanningResult | null) => void
  }): void {
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
      console.info('[MOTION-CORE-WORKER]', {
        requestId: current.id,
        computeMs: now() - current.startedAt,
        ok: event.data.result.ok,
      })
      settleActive(event.data.result)
    }
    created.onerror = () => {
      terminate()
      settleActive(null)
    }
    worker = created
    return created
  }
  function plan(
    request: MotionPlanningRequest,
    source: MotionSource,
  ): Promise<MotionPlanningResult | null> {
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
  return withPreview({ plan, cancel, dispose })
}

/** 一次性预判结果在 transport 内持有，业务层只能提交请求，不能提交自制计划。 */
function withPreview(adapter: Omit<MotionPlannerClient, 'preview'>): MotionPlannerClient {
  let cached: { key: string; result: MotionPlanningResult } | null = null
  return {
    preview(request) {
      const result = planMotion(request)
      cached = result.ok ? { key: JSON.stringify(request), result } : null
      return result
    },
    plan(request, source) {
      const previous = cached
      cached = null
      return previous?.key === JSON.stringify(request)
        ? Promise.resolve(previous.result)
        : adapter.plan(request, source)
    },
    cancel: adapter.cancel,
    dispose() {
      cached = null
      adapter.dispose()
    },
  }
}
