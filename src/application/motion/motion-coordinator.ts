import type {
  MotionPlanningRequest,
  MotionPlanningResult,
  MotionPlanWaypoint,
} from '@/robot-motion-core/index.ts'
import type { JointAngles } from '@/robot-geometry/robot-types.ts'
import type { MotionResult } from '@/robot-motion-core/playback/runner.ts'

export type MotionSource = 'manual-joint' | 'manual-cartesian' | 'gizmo' | 'rapid'
export type ContinuousMotionSource = Exclude<MotionSource, 'rapid'>
/**
 * 连续会话内，规划失败后是否终止整次会话（拖到再拖回需要松开重按）。
 * 只有请求构造本身有问题或规划器基础设施故障（无 result，如 Worker 异常）才终止；
 * "目标暂时不可达"（unreachable/joint-limit/wrist-singularity/path-discontinuity/
 * configuration-unreachable）是交互式拖拽/点动中随姿态变化自然出现、自然消失的边界状态，
 * 只应跳过当前 tick，不终止会话——否则拖出工作空间再拖回来，机械臂会永久停摆。
 */
function isFatalContinuousFailure(outcome: MotionCommandOutcome): boolean {
  if (outcome.ok) return false
  if (outcome.reason !== 'planning-failure') return false
  if (!outcome.result || outcome.result.ok) return true
  return (
    outcome.result.error.code === 'invalid-request' ||
    outcome.result.error.code === 'unsupported-capability' ||
    outcome.result.error.code === 'unsupported-model'
  )
}
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
      readonly playback: 'immediate' | 'stream' | 'speed-limited'
      readonly durationMs?: number
      /** 规划通过校验且 Runner 已接受目标时触发；不代表运动已经完成。 */
      readonly onPlanAccepted?: (plan: MotionPlanningResult & { readonly ok: true }) => void
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
  /**
   * source 透传给调用方，便于按来源选择规划 transport：
   * gizmo/manual-cartesian 走主线程同步直调（复刻旧版本 5391fad 的低延迟路径），
   * 其余来源（RAPID、关节 Jog）继续走 Worker，行为不变。Coordinator 自身始终 `await`
   * 返回值，不区分同步/异步，保持排队状态机的微任务时序不变。
   */
  readonly plan: (
    request: MotionPlanningRequest,
    source: MotionSource,
  ) => MotionPlanningResult | Promise<MotionPlanningResult | null> | null
  readonly runEased: (target: JointAngles, durationMs?: number) => Promise<MotionResult>
  /** 由 Coordinator 统一承接需要同步反映到面板的已验证关节目标。 */
  readonly runImmediate: (target: JointAngles) => void
  readonly runTrajectory: (waypoints: readonly MotionPlanWaypoint[]) => Promise<MotionResult>
  readonly appendTrajectory: (waypoints: readonly MotionPlanWaypoint[]) => Promise<MotionResult>
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
function validatePlan(
  plan: MotionPlanningResult,
  request: MotionPlanningRequest,
): MotionPlanningResult {
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
    first.jointsDeg.some(
      (value, index) => !Number.isFinite(value) || value !== request.state.jointsDeg[index],
    )
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
    plan.end.jointsDeg.some(
      (value, index) => !Number.isFinite(value) || value !== last.jointsDeg[index],
    )
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
    command: Extract<MotionCommand, { readonly kind: 'move' | 'continuous-update' }>,
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
                ? options.appendTrajectory(planned.waypoints)
                : options.runTrajectory(planned.waypoints)
    } catch (error) {
      if (disposed) return { ok: false, reason: 'stale' }
      if (currentVersion !== version) return invalidatedOutcome(currentVersion)
      return failRunner(error)
    }
    // 连续输入需要在当前 stream 仍运行时继续规划并 retarget。这里只通知“目标已被接受”，
    // 真实 completed/stopped 仍由 Runner Promise 结算，不能混淆运动结果语义。
    if (command.kind === 'continuous-update') command.onPlanAccepted?.(planned)

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
    if (command.kind === 'move') {
      // 离散/RAPID 运动取得唯一执行权；旧连续会话的活动 Runner 与 pending
      // 更新必须同时失效，否则旧 tick 可能在新运动之后再次抢占 Runner。
      continuousSession = null
      settlePendingContinuous('cancelled')
      options.stopRunner()
    }
    // 同一连续会话内的每次 retarget 属于同一个运动执行，共享 generation；
    // 离散命令仍通过递增版本取得唯一执行权。
    const currentVersion = command.kind === 'continuous-update' ? version : ++version
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
      planned = await options.plan(command.request, command.source)
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
    // 同来源也可能已松手重按；迟到结果只能清理所属 generation。
    const sessionVersion = version
    let planningReleased = false
    const releasePlanning = (): void => {
      if (planningReleased) return
      planningReleased = true
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
    const originalOnPlanAccepted = entry.command.onPlanAccepted
    const command: typeof entry.command = {
      ...entry.command,
      onPlanAccepted: (plan) => {
        originalOnPlanAccepted?.(plan)
        // 只串行化 Worker 规划，不等待活动 Runner 完成；Runner 自身保证单帧循环和最新目标替换。
        releasePlanning()
      },
    }
    try {
      const outcome = await submitMove(command)
      entry.resolve(outcome)
      if (
        sessionVersion === version &&
        isFatalContinuousFailure(outcome) &&
        continuousSession === entry.command.source
      ) {
        // 只有硬错误（请求本身有问题、模型不匹配、规划器基础设施故障）才终止会话；
        // "目标暂时不可达"类失败保留会话，让下一个 tick 用新目标继续尝试——否则
        // 拖出工作空间再拖回来，机械臂会因为会话已关闭而永久停摆，需要松开重按才能恢复。
        continuousSession = null
        source = null
        settlePendingContinuous('cancelled')
        options.cancelPlan?.()
        options.stopRunner()
        version += 1
      }
    } catch {
      // 连续手动输入没有 ProgramExecutor 边界；把 Runner 异常结算为本次更新失败，
      // 避免 UI 的 fire-and-forget tick 形成未处理 Promise rejection。规划器/Runner
      // 直接抛异常属于基础设施故障（无 result），恒为硬错误，必须终止会话。
      entry.resolve({ ok: false, reason: 'planning-failure' })
      if (sessionVersion === version && continuousSession === entry.command.source) {
        continuousSession = null
        source = null
        settlePendingContinuous('cancelled')
        options.cancelPlan?.()
        options.stopRunner()
        version += 1
      }
    } finally {
      // 规划/Runner 同步失败时不会触发 onPlanAccepted，仍需在这里释放 pending。
      releasePlanning()
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
