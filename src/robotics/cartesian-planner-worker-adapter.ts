import type { RobotProfile } from './robot-profile.ts'
import type { CartesianPathResult } from './cartesian-path-planner.ts'
import type { CartesianTargetPlanningOptions } from './cartesian-motion-planner.ts'
import type { JointAngles, Pose } from './types.ts'

interface PlannerRequest {
  requestId: number
  targetPose: Pose
  initialJoints: JointAngles
  options?: CartesianTargetPlanningOptions
}

interface PlannerResponse {
  requestId: number
  result: CartesianPathResult
}

interface PlanningTiming {
  requestId: number
  queueMs: number
  computeMs: number
  totalMs: number
  driftDeg: number
  hasQueuedRequest: boolean
}

export interface CartesianPlannerWorkerAdapter {
  plan: (
    targetPose: Pose,
    initialJoints: JointAngles,
    options?: CartesianTargetPlanningOptions,
  ) => Promise<CartesianPathResult | null>
  cancel: () => void
  dispose: () => void
}

function planningNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 10) / 10
}

function maxJointDrift(expected: JointAngles, actual: JointAngles): number {
  return Math.max(...actual.map((value, index) => Math.abs(value - expected[index])))
}

function logPlanningTiming(timing: PlanningTiming): void {
  console.info('[CARTESIAN-PLANNING]', {
    ...timing,
    queueMs: roundMilliseconds(timing.queueMs),
    computeMs: roundMilliseconds(timing.computeMs),
    totalMs: roundMilliseconds(timing.totalMs),
    driftDeg: roundMilliseconds(timing.driftDeg),
  })
}

/**
 * 一个点动会话只创建一个 Worker；活动请求完成后复用实例，队列只保留最新目标。
 * 规划期间的关节漂移只记录，不把旧结果重算成 retry，也不接受过期结果覆盖执行尾部。
 */
export function createCartesianPlannerWorkerAdapter(
  profile: RobotProfile,
  getCurrentJoints: () => JointAngles,
): CartesianPlannerWorkerAdapter {
  if (profile.id !== 'abb-irb1200-5-0.9') {
    throw new Error(`Worker 暂不支持机器人型号 ${profile.id}`)
  }

  let worker: Worker | null = null
  let requestId = 0
  let active: {
    requestId: number
    targetPose: Pose
    initialJoints: JointAngles
    options?: CartesianTargetPlanningOptions
    requestedAt: number
    startedAt: number
    resolve: (result: CartesianPathResult | null) => void
  } | null = null
  let queued: {
    requestId: number
    targetPose: Pose
    initialJoints: JointAngles
    options?: CartesianTargetPlanningOptions
    requestedAt: number
    resolve: (result: CartesianPathResult | null) => void
  } | null = null

  function terminateWorker(): void {
    worker?.terminate()
    worker = null
  }

  function cancelPending(): void {
    requestId += 1
    active?.resolve(null)
    queued?.resolve(null)
    active = null
    queued = null
  }

  function dispose(): void {
    cancelPending()
    terminateWorker()
  }

  function ensureWorker(): Worker {
    if (worker) return worker
    const created = new Worker(new URL('./cartesian-planner-worker.ts', import.meta.url), {
      type: 'module',
    })
    created.onmessage = (event: MessageEvent<PlannerResponse>) => {
      if (!active || event.data.requestId !== active.requestId) return
      const current = active
      active = null
      const finishedAt = planningNow()
      logPlanningTiming({
        requestId: current.requestId,
        queueMs: current.startedAt - current.requestedAt,
        computeMs: finishedAt - current.startedAt,
        totalMs: finishedAt - current.requestedAt,
        driftDeg: maxJointDrift(current.initialJoints, [...getCurrentJoints()] as JointAngles),
        hasQueuedRequest: queued !== null,
      })
      current.resolve(event.data.result)
      if (queued) {
        const nextRequest = queued
        queued = null
        startWorker(nextRequest)
      }
    }
    created.onerror = () => {
      const current = active
      active = null
      terminateWorker()
      current?.resolve(null)
      if (queued) {
        const nextRequest = queued
        queued = null
        startWorker(nextRequest)
      }
    }
    worker = created
    return created
  }

  function startWorker(request: {
    requestId: number
    targetPose: Pose
    initialJoints: JointAngles
    options?: CartesianTargetPlanningOptions
    requestedAt: number
    resolve: (result: CartesianPathResult | null) => void
  }): void {
    const currentWorker = ensureWorker()
    active = {
      ...request,
      startedAt: planningNow(),
    }
    const message: PlannerRequest = {
      requestId: request.requestId,
      targetPose: request.targetPose,
      options: request.options,
      // 规划锚点由会话显式提交；实时关节只用于完成后的漂移观测。
      initialJoints: request.initialJoints,
    }
    currentWorker.postMessage(message)
  }

  function plan(
    targetPose: Pose,
    initialJoints: JointAngles,
    options?: CartesianTargetPlanningOptions,
  ): Promise<CartesianPathResult | null> {
    const currentRequestId = ++requestId
    const requestedAt = planningNow()
    return new Promise((resolve) => {
      const request = {
        requestId: currentRequestId,
        targetPose,
        initialJoints: [...initialJoints] as JointAngles,
        options,
        requestedAt,
        resolve,
      }
      if (active) {
        queued?.resolve(null)
        queued = request
      } else {
        startWorker(request)
      }
    })
  }

  return { plan, cancel: cancelPending, dispose }
}
