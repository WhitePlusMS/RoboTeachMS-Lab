import type { RobotProfile } from './robot-profile.ts'
import type { CartesianPathResult } from './cartesian-path-planner.ts'
import type { JointAngles, Pose } from './types.ts'

interface PlannerRequest {
  requestId: number
  targetPose: Pose
  initialJoints: JointAngles
}

interface PlannerResponse {
  requestId: number
  result: CartesianPathResult
}

interface PlanningTiming {
  requestId: number
  retryCount: number
  queueMs: number
  computeMs: number
  totalMs: number
  driftDeg: number
  retry: boolean
  staleAccepted: boolean
  hasQueuedRequest: boolean
}

export interface CartesianPlannerWorkerAdapter {
  plan: (targetPose: Pose, initialJoints: JointAngles) => Promise<CartesianPathResult | null>
  cancel: () => void
  dispose: () => void
}

/** 规划计算期间允许的自然连续运动漂移（度）；明显过期时才触发一次重规划。 */
const PLANNING_DRIFT_TOLERANCE_DEG = 1

function planningNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 10) / 10
}

function hasJointDrift(
  expected: JointAngles,
  actual: JointAngles,
): boolean {
  return Math.max(...actual.map((value, index) => Math.abs(value - expected[index]))) > PLANNING_DRIFT_TOLERANCE_DEG
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

/** 浏览器 Worker adapter：一次只保留最新规划，过期 Worker 直接终止。 */
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
    requestedAt: number
    retryCount: number
    initialJoints: JointAngles
    resolve: (result: CartesianPathResult | null) => void
  } | null = null
  let queued: {
    requestId: number
    targetPose: Pose
    requestedAt: number
    retryCount: number
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
    terminateWorker()
  }

  function startWorker(request: {
    requestId: number
    targetPose: Pose
    requestedAt: number
    retryCount: number
    resolve: (result: CartesianPathResult | null) => void
  }): void {
    const startedAt = planningNow()
    const next = new Worker(new URL('./cartesian-planner-worker.ts', import.meta.url), {
      type: 'module',
    })
    next.onmessage = (event: MessageEvent<PlannerResponse>) => {
      if (!active || event.data.requestId !== active.requestId) return
      const current = active
      active = null
      const currentJoints = [...getCurrentJoints()] as JointAngles
      const finishedAt = planningNow()
      const driftDeg = maxJointDrift(current.initialJoints, currentJoints)
      const shouldRetry =
        queued === null &&
        hasJointDrift(current.initialJoints, currentJoints) &&
        current.retryCount === 0
      // 计算期间动画可能已经推进；没有更新请求时，旧 waypoint 会从历史位置开始，
      // 表现为长按笛卡尔按钮时机械臂抽动，因此最多丢弃一次结果并从当前位置重算。
      if (shouldRetry) {
        logPlanningTiming({
          requestId: current.requestId,
          retryCount: current.retryCount,
          queueMs: startedAt - current.requestedAt,
          computeMs: finishedAt - startedAt,
          totalMs: finishedAt - current.requestedAt,
          driftDeg,
          retry: true,
          staleAccepted: false,
          hasQueuedRequest: false,
        })
        terminateWorker()
        startWorker({
          requestId: current.requestId,
          targetPose: current.targetPose,
          requestedAt: planningNow(),
          retryCount: current.retryCount + 1,
          resolve: current.resolve,
        })
        return
      }
      logPlanningTiming({
        requestId: current.requestId,
        retryCount: current.retryCount,
        queueMs: startedAt - current.requestedAt,
        computeMs: finishedAt - startedAt,
        totalMs: finishedAt - current.requestedAt,
        driftDeg,
        retry: false,
        staleAccepted: hasJointDrift(current.initialJoints, currentJoints),
        hasQueuedRequest: queued !== null,
      })
      current.resolve(event.data.result)
      terminateWorker()
      if (queued) {
        const nextRequest = queued
        queued = null
        startWorker(nextRequest)
      }
    }
    next.onerror = () => {
      if (!active) return
      const current = active
      active = null
      current.resolve(null)
      terminateWorker()
      if (queued) {
        const nextRequest = queued
        queued = null
        startWorker(nextRequest)
      }
    }
    worker = next
    const initialJoints = [...getCurrentJoints()] as JointAngles
    active = {
      ...request,
      initialJoints,
    }
    const message: PlannerRequest = {
      requestId: request.requestId,
      targetPose: request.targetPose,
      // Worker 真正启动可能晚于 pointer tick；此处才读取当前运动状态，
      // 避免排队期间继续运动后仍用入队时的旧关节规划。
      initialJoints,
    }
    next.postMessage(message)
  }

  function plan(targetPose: Pose, _initialJoints: JointAngles): Promise<CartesianPathResult | null> {
    const currentRequestId = ++requestId
    const requestedAt = planningNow()
    return new Promise((resolve) => {
      const request = { requestId: currentRequestId, targetPose, requestedAt, retryCount: 0, resolve }
      if (active) {
        queued?.resolve(null)
        queued = request
      } else {
        startWorker(request)
      }
    })
  }

  return { plan, cancel: cancelPending, dispose: cancelPending }
}
