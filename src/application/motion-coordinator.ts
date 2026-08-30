import type {
  MotionPlanningRequest,
  MotionPlanningResult,
  MotionPlanWaypoint,
} from '@/robot-motion-core/index.ts'
import type { JointAngles } from '@/robot-geometry/model/index.ts'
import type { MotionResult } from '@/robot-geometry/motion/runner.ts'

export type MotionSource = 'manual-joint' | 'manual-cartesian' | 'gizmo' | 'rapid'
export type ContinuousMotionSource = Exclude<MotionSource, 'rapid'>
export type MotionSubmissionMode = 'immediate' | 'eased' | 'trajectory' | 'stream' | 'speed-limited'
export type MotionStopReason = 'user' | 'superseded' | 'program-start' | 'dispose'

export type MotionCommand =
  | {
      readonly kind: 'move'
      readonly source: MotionSource
      readonly request: MotionPlanningRequest
      readonly playback: Exclude<MotionSubmissionMode, 'stream'>
      readonly durationMs?: number
    }
  | {
      readonly kind: 'continuous-begin'
      readonly source: ContinuousMotionSource
    }
  | {
      readonly kind: 'continuous-update'
      readonly source: ContinuousMotionSource
      readonly request: MotionPlanningRequest
      readonly playback: 'stream' | 'speed-limited'
      readonly durationMs?: number
    }
  | {
      readonly kind: 'continuous-end'
      readonly source: ContinuousMotionSource
    }

export type MotionCommandOutcome =
  | {
      readonly ok: true
      readonly result: MotionResult
      readonly plan?: MotionPlanningResult & { readonly ok: true }
    }
  | {
      readonly ok: false
      readonly reason: 'cancelled' | 'stale' | 'planning-failure'
      readonly result?: MotionPlanningResult
    }

export interface MotionCoordinatorOptions {
  readonly plan: (
    request: MotionPlanningRequest,
  ) => MotionPlanningResult | Promise<MotionPlanningResult | null> | null
  readonly runEased: (target: JointAngles, durationMs?: number) => Promise<MotionResult>
  /** 由 Coordinator 统一承接需要同步反映到面板的已验证关节目标。 */
  readonly runImmediate: (target: JointAngles) => void
  readonly runTrajectory: (
    waypoints: readonly JointAngles[],
    durationMs?: number,
  ) => Promise<MotionResult>
  readonly appendTrajectory: (
    waypoints: readonly JointAngles[],
    durationMs?: number,
  ) => Promise<MotionResult>
  readonly runSpeedLimited: (target: JointAngles) => Promise<MotionResult>
  /** Coordinator 独占规划 transport 的取消；宿主不得直接操作 Worker。 */
  readonly cancelPlan?: () => void
  /** Coordinator 销毁时释放规划 transport。 */
  readonly disposePlan?: () => void
  readonly stopRunner: () => void
  readonly log?: (event: {
    readonly requestId: number
    readonly generation: number
    readonly source: MotionSource
    readonly phase: string
    readonly ok?: boolean
    readonly errorCode?: string
    readonly elapsedMs?: number
  }) => void
}

export interface MotionCoordinator {
  submit: (command: MotionCommand) => Promise<MotionCommandOutcome>
  stop: (reason?: MotionStopReason) => void
  dispose: () => void
}

/** Worker 是进程边界；Coordinator 在把结果交给 Runner 前做最小结构校验。 */
function validatePlan(plan: MotionPlanningResult, request: MotionPlanningRequest): MotionPlanningResult {
  if (!plan.ok) return plan
  if (plan.waypoints.length === 0) {
    return {
      ok: false,
      error: {
        code: 'invalid-request',
        category: 'invalid-request',
        details: { field: 'plan.waypoints', reason: 'non-empty-required' },
      },
    }
  }
  const first = plan.waypoints[0]
  const last = plan.waypoints.at(-1)
  if (
    !first ||
    first.timeMs !== 0 ||
    first.jointsDeg.length !== 6 ||
    first.jointsDeg.some((value, index) => !Number.isFinite(value) || value !== request.state.jointsDeg[index])
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid-request',
        category: 'invalid-request',
        details: { field: 'plan.waypoints[0]', reason: 'must-match-request-state-at-time-zero' },
      },
    }
  }
  if (
    !last ||
    plan.end.jointsDeg.length !== 6 ||
    plan.end.jointsDeg.some((value, index) => !Number.isFinite(value) || value !== last.jointsDeg[index])
  ) {
    return {
      ok: false,
      error: {
        code: 'invalid-request',
        category: 'invalid-request',
        details: { field: 'plan.end', reason: 'must-match-last-waypoint' },
      },
    }
  }
  for (let index = 1; index < plan.waypoints.length; index += 1) {
    const waypoint = plan.waypoints[index]
    if (
      !Number.isInteger(waypoint.timeMs) ||
      !Number.isFinite(waypoint.timeMs) ||
      waypoint.jointsDeg.length !== 6 ||
      waypoint.jointsDeg.some((value) => !Number.isFinite(value)) ||
      waypoint.timeMs <= plan.waypoints[index - 1].timeMs
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid-request',
          category: 'invalid-request',
          details: { field: 'plan.waypoints.timeMs', reason: 'strictly-increasing-required' },
        },
      }
    }
  }
  return plan
}

export function createMotionCoordinator(options: MotionCoordinatorOptions): MotionCoordinator {
  let version = 0
  let source: MotionSource | null = null
  let disposed = false
  let requestId = 0
  const stoppedVersions = new Set<number>()

  function invalidatedOutcome(
    currentVersion: number,
    plan?: MotionPlanningResult & { readonly ok: true },
  ): MotionCommandOutcome {
    if (stoppedVersions.delete(currentVersion)) {
      return { ok: true, result: 'stopped', ...(plan ? { plan } : {}) }
    }
    return { ok: false, reason: 'stale' }
  }

  function stop(reason: MotionStopReason = 'user'): void {
    const previousSource = source
    if (reason !== 'superseded' && (source !== null || continuousProcessing)) {
      stoppedVersions.add(version)
    }
    version += 1
    source = null
    continuousSession = null
    settlePendingContinuous('cancelled')
    options.cancelPlan?.()
    options.stopRunner()
    options.log?.({
      requestId,
      generation: version,
      source: previousSource ?? 'manual-joint',
      phase: `stop:${reason}`,
      ok: true,
    })
  }

  async function runPlan(
    planned: MotionPlanningResult & { readonly ok: true },
    command: Pick<Extract<MotionCommand, { readonly kind: 'move' | 'continuous-update' }>, 'source' | 'playback' | 'durationMs'>,
    currentVersion: number,
    currentRequestId: number,
    startedAt: number,
  ): Promise<MotionCommandOutcome> {
    if (disposed) return { ok: false, reason: 'stale' }
    if (currentVersion !== version) return invalidatedOutcome(currentVersion)
    source = command.source
    options.log?.({
      requestId: currentRequestId,
      generation: currentVersion,
      source: command.source,
      phase: 'runner-start',
    })
    const waypoints = planned.waypoints
      .slice(1)
      .map((point: MotionPlanWaypoint) => [...point.jointsDeg] as JointAngles)
    // Core 允许“当前状态即目标”的单 waypoint 计划。它不是空轨迹错误，
    // 也不应把 [] 传给 Runner；在协调层直接结算完成即可。
    if (waypoints.length === 0) {
      options.log?.({
        requestId: currentRequestId,
        generation: currentVersion,
        source: command.source,
        phase: 'runner-noop',
        ok: true,
        elapsedMs: Date.now() - startedAt,
      })
      source = null
      return { ok: true, result: 'completed', plan: planned }
    }

    const failRunner = (error: unknown): never => {
      const failure = error instanceof Error ? error : new Error(String(error))
      // Runner 失败后不再保留 source，避免 UI 继续把已失效的来源当作当前运动。
      source = null
      options.stopRunner()
      options.log?.({
        requestId: currentRequestId,
        generation: currentVersion,
        source: command.source,
        phase: 'runner-failed',
        ok: false,
        errorCode: 'runtime-error',
        elapsedMs: Date.now() - startedAt,
      })
      throw failure
    }

    let runPromise: Promise<MotionResult>
    try {
      runPromise =
        command.playback === 'immediate'
          ? (options.runImmediate(planned.end.jointsDeg as JointAngles),
            Promise.resolve('completed' as const))
          : command.playback === 'eased'
            ? options.runEased(
                waypoints.at(-1) ?? (planned.end.jointsDeg as JointAngles),
                command.durationMs,
              )
            : command.playback === 'speed-limited'
              ? options.runSpeedLimited(planned.end.jointsDeg as JointAngles)
              : command.playback === 'stream'
                ? options.appendTrajectory(waypoints, command.durationMs)
                : options.runTrajectory(waypoints, command.durationMs)
    } catch (error) {
      if (disposed) return { ok: false, reason: 'stale' }
      if (currentVersion !== version) return invalidatedOutcome(currentVersion)
      return failRunner(error)
    }

    let result: MotionResult
    try {
      result = await runPromise
    } catch (error) {
      if (disposed) return { ok: false, reason: 'stale' }
      if (currentVersion !== version) return invalidatedOutcome(currentVersion)
      return failRunner(error)
    }
    if (disposed) return { ok: false, reason: 'stale' }
    if (currentVersion !== version) return invalidatedOutcome(currentVersion, planned)
    options.log?.({
      requestId: currentRequestId,
      generation: currentVersion,
      source: command.source,
      phase: 'runner-completed',
      ok: result === 'completed',
      elapsedMs: Date.now() - startedAt,
    })
    source = null
    return { ok: true, result, plan: planned }
  }

  type ContinuousEntry = {
    readonly command: Extract<MotionCommand, { readonly kind: 'continuous-update' }>
    readonly resolve: (outcome: MotionCommandOutcome) => void
  }
  let continuousSession: ContinuousMotionSource | null = null
  let continuousProcessing = false
  let pendingContinuous: ContinuousEntry | null = null

  function settlePendingContinuous(reason: 'cancelled' | 'stale'): void {
    const pending = pendingContinuous
    pendingContinuous = null
    pending?.resolve({ ok: false, reason })
  }

  async function submitMove(
    command: Extract<MotionCommand, { readonly kind: 'move' | 'continuous-update' }>,
  ): Promise<MotionCommandOutcome> {
    if (disposed) return { ok: false, reason: 'cancelled' }
    if (command.kind === 'move' && (continuousSession !== null || pendingContinuous !== null)) {
      // 离散/RAPID 运动取得唯一执行权；旧连续会话的活动 Runner 与 pending
      // 更新必须同时失效，否则旧 tick 可能在新运动之后再次抢占 Runner。
      continuousSession = null
      settlePendingContinuous('cancelled')
      options.stopRunner()
    }
    const currentVersion = ++version
    const currentRequestId = ++requestId
    const startedAt = Date.now()
    source = command.source
    // 新请求抢占旧规划；取消由 Coordinator 统一完成，Worker adapter 不暴露给入口。
    options.cancelPlan?.()
    options.log?.({
      requestId: currentRequestId,
      generation: currentVersion,
      source: command.source,
      phase: 'planning',
    })
    let planned: MotionPlanningResult | null
    try {
      planned = await options.plan(command.request)
    } catch (error) {
      if (disposed) return { ok: false, reason: 'stale' }
      if (currentVersion !== version) return invalidatedOutcome(currentVersion)
      source = null
      options.stopRunner()
      options.log?.({
        requestId: currentRequestId,
        generation: currentVersion,
        source: command.source,
        phase: 'planning-failed',
        ok: false,
        errorCode: 'planner-exception',
        elapsedMs: Date.now() - startedAt,
      })
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        reason: 'planning-failure',
        result: {
          ok: false,
          error: {
            code: 'invalid-request',
            category: 'planning-failure',
            details: { field: 'planner', reason: message },
          },
        },
      }
    }
    if (disposed) return { ok: false, reason: 'stale' }
    if (currentVersion !== version) return invalidatedOutcome(currentVersion)
    const validated = planned === null ? null : validatePlan(planned, command.request)
    if (validated === null || !validated.ok) {
      source = null
      options.log?.({
        requestId: currentRequestId,
        generation: currentVersion,
        source: command.source,
        phase: 'planning-failed',
        ok: false,
        errorCode: validated?.error.code,
        elapsedMs: Date.now() - startedAt,
      })
      return { ok: false, reason: 'planning-failure', result: validated ?? undefined }
    }
    return runPlan(validated, command, currentVersion, currentRequestId, startedAt)
  }

  async function processContinuous(entry: ContinuousEntry): Promise<void> {
    try {
      const outcome = await submitMove(entry.command)
      entry.resolve(outcome)
      if (!outcome.ok && outcome.reason === 'planning-failure' && continuousSession === entry.command.source) {
        // 连续输入的规划或 Runner 失败后不再接受后续 tick；让上层重新 begin
        // 才能建立新的会话，避免失败状态持续驱动旧目标。
        continuousSession = null
        source = null
        settlePendingContinuous('cancelled')
        options.cancelPlan?.()
        options.stopRunner()
        version += 1
      }
    } catch {
      // 连续手动输入没有 ProgramExecutor 边界；把 Runner 异常结算为本次更新失败，
      // 避免 UI 的 fire-and-forget tick 形成未处理 Promise rejection。
      entry.resolve({ ok: false, reason: 'planning-failure' })
      if (continuousSession === entry.command.source) {
        continuousSession = null
        source = null
        settlePendingContinuous('cancelled')
        options.cancelPlan?.()
        options.stopRunner()
        version += 1
      }
    } finally {
      continuousProcessing = false
      const next = pendingContinuous
      pendingContinuous = null
      if (next && continuousSession === next.command.source && !disposed) {
        continuousProcessing = true
        void processContinuous(next)
      } else if (next) {
        next.resolve({ ok: false, reason: 'cancelled' })
      }
    }
  }

  function submitContinuousUpdate(
    command: Extract<MotionCommand, { readonly kind: 'continuous-update' }>,
  ): Promise<MotionCommandOutcome> {
    if (disposed || continuousSession !== command.source) {
      return Promise.resolve({ ok: false, reason: 'cancelled' })
    }
    return new Promise((resolve) => {
      const entry: ContinuousEntry = { command, resolve }
      if (continuousProcessing) {
        settlePendingContinuous('stale')
        pendingContinuous = entry
        return
      }
      continuousProcessing = true
      void processContinuous(entry)
    })
  }

  function beginContinuous(continuousSource: ContinuousMotionSource): MotionCommandOutcome {
    if (disposed) return { ok: false, reason: 'cancelled' }
    // 新会话必须从一个干净的 Runner/规划 transport 开始；旧会话的迟到结果只会结算 stale。
    version += 1
    continuousSession = continuousSource
    source = null
    settlePendingContinuous('cancelled')
    options.cancelPlan?.()
    options.stopRunner()
    return { ok: true, result: 'completed' }
  }

  function endContinuous(continuousSource: ContinuousMotionSource): MotionCommandOutcome {
    if (continuousSession !== continuousSource) return { ok: true, result: 'completed' }
    version += 1
    continuousSession = null
    source = null
    settlePendingContinuous('cancelled')
    options.cancelPlan?.()
    options.stopRunner()
    return { ok: true, result: 'stopped' }
  }

  function submit(command: MotionCommand): Promise<MotionCommandOutcome> {
    if (command.kind === 'continuous-begin') return Promise.resolve(beginContinuous(command.source))
    if (command.kind === 'continuous-end') return Promise.resolve(endContinuous(command.source))
    if (command.kind === 'continuous-update') return submitContinuousUpdate(command)
    return submitMove(command)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    stop('dispose')
    options.disposePlan?.()
  }

  return {
    submit,
    stop,
    dispose,
  }
}
