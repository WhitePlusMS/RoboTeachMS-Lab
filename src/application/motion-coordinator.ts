import type { MotionPlanningRequest, MotionPlanningResult, MotionPlanWaypoint } from '@/robot-motion-core/index.ts'
import type { JointAngles } from '@/robotics/model/index.ts'
import type { MotionResult, MotionStatus } from '@/robotics/motion/runner.ts'

export type MotionSource = 'manual-joint' | 'manual-cartesian' | 'gizmo' | 'rapid'
export type MotionSubmissionMode = 'immediate' | 'eased' | 'trajectory' | 'stream' | 'speed-limited'
export type MotionStopReason = 'user' | 'superseded' | 'program-start' | 'dispose'

export interface MotionCommand {
  readonly source: MotionSource
  readonly request: MotionPlanningRequest
  readonly mode: MotionSubmissionMode
  readonly generation?: number
  readonly durationMs?: number
}

export type MotionCommandOutcome =
  | { readonly ok: true; readonly result: MotionResult; readonly plan: MotionPlanningResult & { readonly ok: true } }
  | { readonly ok: false; readonly reason: 'cancelled' | 'stale' | 'planning-failure'; readonly result?: MotionPlanningResult }

export interface MotionCoordinatorOptions {
  readonly plan: (request: MotionPlanningRequest) => MotionPlanningResult | Promise<MotionPlanningResult | null> | null
  readonly runEased: (target: JointAngles, durationMs?: number) => Promise<MotionResult>
  /** 由 Coordinator 统一承接需要同步反映到面板的已验证关节目标。 */
  readonly runImmediate: (target: JointAngles) => void
  readonly runTrajectory: (waypoints: readonly JointAngles[], durationMs?: number) => Promise<MotionResult>
  readonly appendTrajectory: (waypoints: readonly JointAngles[], durationMs?: number, generation?: number) => Promise<MotionResult>
  readonly runSpeedLimited: (target: JointAngles) => Promise<MotionResult>
  readonly stopRunner: () => void
  readonly pauseRunner: () => void
  readonly resumeRunner: () => void
  readonly getRunnerStatus: () => MotionStatus
  readonly log?: (event: { readonly requestId: number; readonly generation: number; readonly source: MotionSource; readonly phase: string; readonly ok?: boolean; readonly errorCode?: string; readonly elapsedMs?: number }) => void
}

export interface MotionCoordinator {
  submit: (command: MotionCommand) => Promise<MotionCommandOutcome>
  commitPlan: (plan: MotionPlanningResult & { readonly ok: true }, source: MotionSource, mode: MotionSubmissionMode, durationMs?: number, generation?: number) => Promise<MotionCommandOutcome>
  stop: (reason?: MotionStopReason) => void
  pause: () => void
  resume: () => void
  getSource: () => MotionSource | null
  getGeneration: () => number
  dispose: () => void
}

export function createMotionCoordinator(options: MotionCoordinatorOptions): MotionCoordinator {
  let version = 0
  let source: MotionSource | null = null
  let generation = 0
  let disposed = false
  let requestId = 0

  function acceptsCorePlan(plan: MotionPlanningResult & { readonly ok: true }): boolean {
    if (plan.waypoints.length === 0 || plan.waypoints[0].timeMs !== 0) return false
    return plan.waypoints.every((point, index, points) =>
      point.jointsDeg.length === 6 &&
      point.jointsDeg.every((value) => Number.isFinite(value)) &&
      (index === 0 || point.timeMs > points[index - 1].timeMs),
    )
  }

  function stop(reason: MotionStopReason = 'user'): void {
    const previousSource = source
    version += 1
    source = null
    options.stopRunner()
    options.log?.({ requestId, generation, source: previousSource ?? 'manual-joint', phase: `stop:${reason}`, ok: true })
  }

  async function runPlan(
    planned: MotionPlanningResult & { readonly ok: true },
    command: Pick<MotionCommand, 'source' | 'mode' | 'durationMs' | 'generation'>,
    currentVersion: number,
  ): Promise<MotionCommandOutcome> {
    if (disposed || currentVersion !== version) return { ok: false, reason: 'stale' }
    source = command.source
    if (command.generation !== undefined) generation = command.generation
    const waypoints = planned.waypoints.slice(1).map((point: MotionPlanWaypoint) => [...point.jointsDeg] as JointAngles)
    const runPromise = command.mode === 'immediate'
      ? (options.runImmediate(planned.end.jointsDeg as JointAngles), Promise.resolve('completed' as const))
      : command.mode === 'eased'
        ? options.runEased(waypoints.at(-1) ?? (planned.end.jointsDeg as JointAngles), command.durationMs)
      : command.mode === 'speed-limited'
        ? options.runSpeedLimited(planned.end.jointsDeg as JointAngles)
      : command.mode === 'stream'
        ? options.appendTrajectory(waypoints, command.durationMs, command.generation)
        : options.runTrajectory(waypoints, command.durationMs)
    const result = await runPromise
    if (disposed || currentVersion !== version) return { ok: false, reason: 'stale' }
    options.log?.({ requestId, generation, source: command.source, phase: 'completed', ok: result === 'completed' })
    return { ok: true, result, plan: planned }
  }

  async function submit(command: MotionCommand): Promise<MotionCommandOutcome> {
    if (disposed) return { ok: false, reason: 'cancelled' }
    const currentVersion = ++version
    const currentRequestId = ++requestId
    const startedAt = Date.now()
    source = command.source
    if (command.generation !== undefined) generation = command.generation
    options.log?.({ requestId: currentRequestId, generation, source: command.source, phase: 'planning' })
    const planned = await options.plan(command.request)
    if (disposed || currentVersion !== version) return { ok: false, reason: 'stale' }
    if (planned === null || !planned.ok) {
      options.log?.({ requestId: currentRequestId, generation, source: command.source, phase: 'planning-failed', ok: false, errorCode: planned?.error.code, elapsedMs: Date.now() - startedAt })
      return { ok: false, reason: 'planning-failure', result: planned ?? undefined }
    }
    return runPlan(planned, command, currentVersion)
  }

  async function commitPlan(
    plan: MotionPlanningResult & { readonly ok: true },
    commandSource: MotionSource,
    mode: MotionSubmissionMode,
    durationMs?: number,
    commandGeneration?: number,
  ): Promise<MotionCommandOutcome> {
    const currentVersion = ++version
    if (!acceptsCorePlan(plan)) {
      options.log?.({ requestId: ++requestId, generation, source: commandSource, phase: 'plan-rejected', ok: false, errorCode: 'invalid-request' })
      return { ok: false, reason: 'planning-failure', result: { ok: false, error: { code: 'invalid-request', category: 'invalid-request', details: { field: 'plan', reason: 'core-plan-required' } } } }
    }
    return runPlan(plan, { source: commandSource, mode, durationMs, generation: commandGeneration }, currentVersion)
  }

  function dispose(): void { disposed = true; stop('dispose') }

  return {
    submit,
    commitPlan,
    stop,
    pause: options.pauseRunner,
    resume: options.resumeRunner,
    getSource: () => source,
    getGeneration: () => generation,
    dispose,
  }
}
