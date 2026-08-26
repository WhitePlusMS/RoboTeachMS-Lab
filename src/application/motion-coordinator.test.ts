import { describe, expect, it, vi } from 'vitest'
import { createMotionCoordinator } from './motion-coordinator.ts'
import type { MotionPlanningRequest } from '@/robot-motion-core/index.ts'

const request = { schemaVersion: 1, robot: { modelId: 'abb-irb1200-5-0.9', modelRevision: 'dh-standard-v1' }, state: { jointsDeg: [0, 0, 0, 0, 30, 0] }, intent: { kind: 'joint-target', targetJointsDeg: [1, 0, 0, 0, 30, 0] } } as MotionPlanningRequest
const plan = { ok: true as const, waypoints: [{ timeMs: 0, jointsDeg: [0, 0, 0, 0, 30, 0] as const }, { timeMs: 1, jointsDeg: [1, 0, 0, 0, 30, 0] as const }], end: { jointsDeg: [1, 0, 0, 0, 30, 0] as const }, validation: {} }

describe('MotionCoordinator', () => {
  it('通过 immediate 模式同步提交已验证关节目标', async () => {
    const runImmediate = vi.fn()
    const coordinator = createMotionCoordinator({ plan: () => plan, runImmediate, runEased: async () => 'completed', runTrajectory: async () => 'completed', appendTrajectory: async () => 'completed', runSpeedLimited: async () => 'completed', stopRunner: vi.fn(), pauseRunner: vi.fn(), resumeRunner: vi.fn(), getRunnerStatus: () => 'idle' })
    const outcome = await coordinator.commitPlan(plan, 'manual-joint', 'immediate')
    expect(outcome.ok).toBe(true)
    expect(runImmediate).toHaveBeenCalledWith([1, 0, 0, 0, 30, 0])
  })

  it('only submits a current successful plan to Runner', async () => {
    const runEased = vi.fn(async () => 'completed' as const)
    const coordinator = createMotionCoordinator({ plan: () => plan, runImmediate: vi.fn(), runEased, runTrajectory: runEased, appendTrajectory: runEased, runSpeedLimited: runEased, stopRunner: vi.fn(), pauseRunner: vi.fn(), resumeRunner: vi.fn(), getRunnerStatus: () => 'idle' })
    const outcome = await coordinator.submit({ source: 'manual-joint', request, mode: 'eased' })
    expect(outcome.ok).toBe(true)
    expect(runEased).toHaveBeenCalledWith([1, 0, 0, 0, 30, 0], undefined)
  })

  it('rejects an older async plan after a newer command takes ownership', async () => {
    let resolveFirst: (value: typeof plan) => void = () => {}
    const coordinator = createMotionCoordinator({ plan: () => new Promise((resolve) => { resolveFirst = resolve }), runImmediate: vi.fn(), runEased: async () => 'completed', runTrajectory: async () => 'completed', appendTrajectory: async () => 'completed', runSpeedLimited: async () => 'completed', stopRunner: vi.fn(), pauseRunner: vi.fn(), resumeRunner: vi.fn(), getRunnerStatus: () => 'idle' })
    const first = coordinator.submit({ source: 'gizmo', request, mode: 'eased' })
    coordinator.stop('superseded')
    resolveFirst(plan)
    await expect(first).resolves.toEqual({ ok: false, reason: 'stale' })
  })

  it('rejects host-created plans that do not use Core time semantics', async () => {
    const runEased = vi.fn(async () => 'completed' as const)
    const coordinator = createMotionCoordinator({ plan: () => plan, runImmediate: vi.fn(), runEased, runTrajectory: runEased, appendTrajectory: runEased, runSpeedLimited: runEased, stopRunner: vi.fn(), pauseRunner: vi.fn(), resumeRunner: vi.fn(), getRunnerStatus: () => 'idle' })
    const outcome = await coordinator.commitPlan({ ...plan, waypoints: [{ ...plan.waypoints[0], timeMs: 1 }, plan.waypoints[1]] }, 'gizmo', 'trajectory')
    expect(outcome).toEqual({ ok: false, reason: 'planning-failure', result: { ok: false, error: { code: 'invalid-request', category: 'invalid-request', details: { field: 'plan', reason: 'core-plan-required' } } } })
    expect(runEased).not.toHaveBeenCalled()
  })
})
