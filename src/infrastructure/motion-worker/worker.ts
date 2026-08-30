import { planMotion, type MotionPlanningRequest, type MotionPlanningResult } from '@/robot-motion-core/index.ts'

interface PlannerRequest { readonly requestId: number; readonly request: MotionPlanningRequest }
interface PlannerResponse { readonly requestId: number; readonly result: MotionPlanningResult }
interface PlannerWorkerScope {
  onmessage: ((event: MessageEvent<PlannerRequest>) => void) | null
  postMessage: (message: PlannerResponse) => void
}

const workerScope = globalThis as unknown as PlannerWorkerScope
workerScope.onmessage = (event) => {
  const { requestId, request } = event.data
  workerScope.postMessage({ requestId, result: planMotion(request) })
}

export {}
