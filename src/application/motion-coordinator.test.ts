import { describe, expect, it, vi } from 'vitest'
import { createMotionCoordinator } from './motion-coordinator.ts'
import type { MotionPlanningRequest, MotionPlanningResult } from '@/robot-motion-core/index.ts'

const request = {
  schemaVersion: 1,
  robot: { modelId: 'abb-irb1200-5-0.9', modelRevision: 'dh-standard-v1' },
  state: { jointsDeg: [0, 0, 0, 0, 30, 0] },
  intent: { kind: 'joint-target', targetJointsDeg: [1, 0, 0, 0, 30, 0] },
} as MotionPlanningRequest
const plan = {
  ok: true as const,
  waypoints: [
    { timeMs: 0, jointsDeg: [0, 0, 0, 0, 30, 0] as const },
    { timeMs: 1, jointsDeg: [1, 0, 0, 0, 30, 0] as const },
  ],
  end: { jointsDeg: [1, 0, 0, 0, 30, 0] as const },
  validation: {},
}

describe('MotionCoordinator', () => {
  it('通过 immediate 模式同步提交已验证关节目标', async () => {
    const runImmediate = vi.fn()
    const coordinator = createMotionCoordinator({
      plan: () => plan,
      runImmediate,
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner: vi.fn(),
    })
    const outcome = await coordinator.submit({ kind: 'move', source: 'manual-joint', request, playback: 'immediate' })
    expect(outcome.ok).toBe(true)
    expect(runImmediate).toHaveBeenCalledWith([1, 0, 0, 0, 30, 0])
  })

  it('only submits a current successful plan to Runner', async () => {
    const runEased = vi.fn(async () => 'completed' as const)
    const coordinator = createMotionCoordinator({
      plan: () => plan,
      runImmediate: vi.fn(),
      runEased,
      runTrajectory: runEased,
      appendTrajectory: runEased,
      runSpeedLimited: runEased,
      stopRunner: vi.fn(),
    })
    const outcome = await coordinator.submit({ kind: 'move', source: 'manual-joint', request, playback: 'eased' })
    expect(outcome.ok).toBe(true)
    expect(runEased).toHaveBeenCalledWith([1, 0, 0, 0, 30, 0], undefined)
  })

  it('rejects an older async plan after a newer command takes ownership', async () => {
    let resolveFirst: (value: typeof plan) => void = () => {}
    const coordinator = createMotionCoordinator({
      plan: () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner: vi.fn(),
    })
    const first = coordinator.submit({ kind: 'move', source: 'gizmo', request, playback: 'eased' })
    coordinator.stop('superseded')
    resolveFirst(plan)
    await expect(first).resolves.toEqual({ ok: false, reason: 'stale' })
  })

  it('rejects host-created plans that do not use Core time semantics', async () => {
    const runEased = vi.fn(async () => 'completed' as const)
    const invalidPlan = { ...plan, waypoints: [{ ...plan.waypoints[0], timeMs: 1 }, plan.waypoints[1]] }
    const invalidCoordinator = createMotionCoordinator({
      plan: () => invalidPlan,
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: runEased,
      appendTrajectory: runEased,
      runSpeedLimited: runEased,
      stopRunner: vi.fn(),
    })
    const outcome = await invalidCoordinator.submit({ kind: 'move', source: 'gizmo', request, playback: 'trajectory' })
    expect(outcome).toEqual({
      ok: false,
      reason: 'planning-failure',
      result: { ok: false, error: expect.objectContaining({ code: 'invalid-request' }) },
    })
    expect(runEased).not.toHaveBeenCalled()
  })

  it('为规划、Runner 开始和完成日志复用同一 requestId', async () => {
    const events: Array<{ requestId: number; phase: string }> = []
    const coordinator = createMotionCoordinator({
      plan: () => plan,
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner: vi.fn(),
      log: (event) => events.push({ requestId: event.requestId, phase: event.phase }),
    })

    const outcome = await coordinator.submit({ kind: 'move', source: 'gizmo', request, playback: 'trajectory' })
    expect(outcome.ok).toBe(true)
    expect(events.map((event) => event.phase)).toEqual([
      'planning',
      'runner-start',
      'runner-completed',
    ])
    expect(new Set(events.map((event) => event.requestId)).size).toBe(1)
  })

  it('静态单 waypoint 计划视为已完成，不把空轨迹交给 Runner', async () => {
    const runTrajectory = vi.fn(async () => 'completed' as const)
    const stationaryPlan = {
      ...plan,
      waypoints: [{ timeMs: 0, jointsDeg: plan.waypoints[0].jointsDeg }],
      end: { jointsDeg: plan.waypoints[0].jointsDeg },
    }
    const coordinator = createMotionCoordinator({
      plan: () => stationaryPlan,
      runImmediate: vi.fn(),
      runEased: vi.fn(async () => 'completed' as const),
      runTrajectory,
      appendTrajectory: vi.fn(async () => 'completed' as const),
      runSpeedLimited: vi.fn(async () => 'completed' as const),
      stopRunner: vi.fn(),
    })

    await expect(
      coordinator.submit({ kind: 'move', source: 'rapid', request, playback: 'trajectory' }),
    ).resolves.toMatchObject({
      ok: true,
      result: 'completed',
    })
    expect(runTrajectory).not.toHaveBeenCalled()
  })

  it('Runner 异常会释放当前来源并向程序边界传播', async () => {
    const stopRunner = vi.fn()
    const coordinator = createMotionCoordinator({
      plan: () => plan,
      runImmediate: vi.fn(),
      runEased: vi.fn(async () => 'completed' as const),
      runTrajectory: () => {
        throw new Error('Runner 启动失败')
      },
      appendTrajectory: vi.fn(async () => 'completed' as const),
      runSpeedLimited: vi.fn(async () => 'completed' as const),
      stopRunner,
    })

    await expect(coordinator.submit({ kind: 'move', source: 'rapid', request, playback: 'trajectory' })).rejects.toThrow(
      'Runner 启动失败',
    )
    expect(stopRunner).toHaveBeenCalledTimes(1)
  })

  it('显式 stop 将活动运动结算为 stopped，而不是 stale/error', async () => {
    let release: () => void = () => {}
    const coordinator = createMotionCoordinator({
      plan: () => plan,
      runImmediate: vi.fn(),
      runEased: () => new Promise<'stopped'>((resolve) => { release = () => resolve('stopped') }),
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner: vi.fn(),
    })
    const pending = coordinator.submit({ kind: 'move', source: 'rapid', request, playback: 'eased' })
    await Promise.resolve()
    coordinator.stop('user')
    release()
    await expect(pending).resolves.toMatchObject({ ok: true, result: 'stopped' })
  })

  it('拒绝 end 与最后 waypoint 不一致的伪造计划', async () => {
    const runTrajectory = vi.fn(async () => 'completed' as const)
    const invalidCoordinator = createMotionCoordinator({
      plan: () => ({ ...plan, end: { jointsDeg: [9, 9, 9, 9, 9, 9] } }),
      runImmediate: vi.fn(),
      runEased: vi.fn(async () => 'completed' as const),
      runTrajectory,
      appendTrajectory: vi.fn(async () => 'completed' as const),
      runSpeedLimited: vi.fn(async () => 'completed' as const),
      stopRunner: vi.fn(),
    })
    const outcome = await invalidCoordinator.submit({ kind: 'move', source: 'rapid', request, playback: 'trajectory' })
    expect(outcome.ok).toBe(false)
    expect(runTrajectory).not.toHaveBeenCalled()
  })

  it('规划器异常也会结算为失败并释放 Runner', async () => {
    const stopRunner = vi.fn()
    const coordinator = createMotionCoordinator({
      plan: async () => {
        throw new Error('Worker 崩溃')
      },
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner,
    })

    const outcome = await coordinator.submit({ kind: 'move', source: 'rapid', request, playback: 'trajectory' })
    expect(outcome).toMatchObject({ ok: false, reason: 'planning-failure' })
    expect(stopRunner).toHaveBeenCalledTimes(1)
  })

  it('Coordinator 统一取消并释放规划 transport', () => {
    const cancelPlan = vi.fn()
    const disposePlan = vi.fn()
    const coordinator = createMotionCoordinator({
      plan: () => plan,
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner: vi.fn(),
      cancelPlan,
      disposePlan,
    })

    coordinator.stop('superseded')
    coordinator.dispose()
    coordinator.dispose()

    expect(cancelPlan).toHaveBeenCalledTimes(2)
    expect(disposePlan).toHaveBeenCalledTimes(1)
  })

  it('旧规划器异常不会清理新请求的 Runner', async () => {
    let calls = 0
    let rejectFirst: (error: Error) => void = () => {}
    const stopRunner = vi.fn()
    const coordinator = createMotionCoordinator({
      plan: () => {
        calls += 1
        if (calls === 1) {
          return new Promise<MotionPlanningResult>((_, reject) => {
            rejectFirst = reject
          })
        }
        return plan
      },
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner,
    })
    const first = coordinator.submit({ kind: 'move', source: 'gizmo', request, playback: 'trajectory' })
    const second = coordinator.submit({ kind: 'move', source: 'rapid', request, playback: 'trajectory' })
    rejectFirst(new Error('旧 Worker 异常'))

    await expect(first).resolves.toEqual({ ok: false, reason: 'stale' })
    await expect(second).resolves.toMatchObject({ ok: true })
    expect(stopRunner).not.toHaveBeenCalled()
  })

  it('旧 Runner 异常不会停止新请求的 Runner', async () => {
    let releaseFirst: () => void = () => {}
    let calls = 0
    const stopRunner = vi.fn()
    const coordinator = createMotionCoordinator({
      plan: () => plan,
      runImmediate: vi.fn(),
      runEased: () => {
        calls += 1
        if (calls === 1) {
          return new Promise<'completed'>((resolve) => {
            releaseFirst = () => resolve('completed')
          }).then(() => {
            throw new Error('旧 Runner 异常')
          })
        }
        return Promise.resolve('completed' as const)
      },
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner,
    })
    const first = coordinator.submit({ kind: 'move', source: 'gizmo', request, playback: 'eased' })
    await Promise.resolve()
    const second = coordinator.submit({ kind: 'move', source: 'rapid', request, playback: 'eased' })
    await expect(second).resolves.toMatchObject({ ok: true })
    releaseFirst()

    await expect(first).resolves.toEqual({ ok: false, reason: 'stale' })
    expect(stopRunner).not.toHaveBeenCalled()
  })

  it('连续会话显式 begin/update/end，Coordinator 只保留一个最新 pending', async () => {
    let resolvePlan: (value: typeof plan) => void = () => {}
    let planCalls = 0
    const runStream = vi.fn(async () => 'completed' as const)
    const coordinator = createMotionCoordinator({
      plan: () => {
        planCalls += 1
        return new Promise<typeof plan>((resolve) => { resolvePlan = resolve })
      },
      runImmediate: vi.fn(),
      runEased: runStream,
      runTrajectory: runStream,
      appendTrajectory: runStream,
      runSpeedLimited: runStream,
      stopRunner: vi.fn(),
    })

    await expect(coordinator.submit({ kind: 'continuous-begin', source: 'manual-cartesian' }))
      .resolves.toMatchObject({ ok: true, result: 'completed' })
    const first = coordinator.submit({
      kind: 'continuous-update',
      source: 'manual-cartesian',
      request,
      playback: 'stream',
      durationMs: 140,
    })
    const second = coordinator.submit({
      kind: 'continuous-update',
      source: 'manual-cartesian',
      request,
      playback: 'stream',
      durationMs: 140,
    })
    expect(planCalls).toBe(1)
    resolvePlan(plan)
    await expect(first).resolves.toMatchObject({ ok: true, result: 'completed' })
    expect(planCalls).toBe(2)
    resolvePlan(plan)
    await expect(second).resolves.toMatchObject({ ok: true, result: 'completed' })
    await expect(coordinator.submit({ kind: 'continuous-end', source: 'manual-cartesian' }))
      .resolves.toMatchObject({ ok: true, result: 'stopped' })
  })

  it('活动 stream 未完成时仍把最新连续目标追加到同一 Runner', async () => {
    let finishRunner: (result: 'completed') => void = () => {}
    const runnerResult = new Promise<'completed'>((resolve) => {
      finishRunner = resolve
    })
    const appendTrajectory = vi.fn(() => runnerResult)
    const coordinator = createMotionCoordinator({
      plan: () => plan,
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory,
      runSpeedLimited: async () => 'completed',
      stopRunner: vi.fn(),
    })

    await coordinator.submit({ kind: 'continuous-begin', source: 'manual-cartesian' })
    const first = coordinator.submit({
      kind: 'continuous-update',
      source: 'manual-cartesian',
      request,
      playback: 'stream',
      durationMs: 140,
    })
    await vi.waitFor(() => expect(appendTrajectory).toHaveBeenCalledTimes(1))

    const second = coordinator.submit({
      kind: 'continuous-update',
      source: 'manual-cartesian',
      request,
      playback: 'stream',
      durationMs: 140,
    })

    // Runner 的 stream 模式本身支持活动中 retarget；Coordinator 不能等待首段完成后才追加。
    await vi.waitFor(() => expect(appendTrajectory).toHaveBeenCalledTimes(2))
    finishRunner('completed')

    await expect(first).resolves.toMatchObject({ ok: true, result: 'completed' })
    await expect(second).resolves.toMatchObject({ ok: true, result: 'completed' })
  })

  it('连续会话 source 不匹配或 end 后不会再次规划', async () => {
    const planSpy = vi.fn(() => plan)
    const stopRunner = vi.fn()
    const coordinator = createMotionCoordinator({
      plan: planSpy,
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner,
    })
    await coordinator.submit({ kind: 'continuous-begin', source: 'manual-joint' })
    await expect(coordinator.submit({
      kind: 'continuous-update',
      source: 'manual-cartesian',
      request,
      playback: 'stream',
    })).resolves.toEqual({ ok: false, reason: 'cancelled' })
    await coordinator.submit({ kind: 'continuous-end', source: 'manual-joint' })
    expect(planSpy).not.toHaveBeenCalled()
    expect(stopRunner).toHaveBeenCalledTimes(2)
  })

  it('离散运动提交后会关闭连续会话并取消旧 pending', async () => {
    let releaseStream: () => void = () => {}
    const runStream = vi.fn(
      () => new Promise<'completed'>((resolve) => { releaseStream = () => resolve('completed') }),
    )
    const runImmediate = vi.fn()
    const stopRunner = vi.fn(() => releaseStream())
    const coordinator = createMotionCoordinator({
      plan: () => plan,
      runImmediate,
      runEased: runStream,
      runTrajectory: runStream,
      appendTrajectory: runStream,
      runSpeedLimited: runStream,
      stopRunner,
    })

    await coordinator.submit({ kind: 'continuous-begin', source: 'manual-cartesian' })
    const first = coordinator.submit({
      kind: 'continuous-update',
      source: 'manual-cartesian',
      request,
      playback: 'stream',
    })
    await Promise.resolve()
    const pending = coordinator.submit({
      kind: 'continuous-update',
      source: 'manual-cartesian',
      request,
      playback: 'stream',
    })
    const discrete = coordinator.submit({ kind: 'move', source: 'rapid', request, playback: 'immediate' })

    await expect(pending).resolves.toEqual({ ok: false, reason: 'stale' })
    await expect(discrete).resolves.toMatchObject({ ok: true, result: 'completed' })
    await expect(first).resolves.toEqual({ ok: false, reason: 'stale' })
    expect(runImmediate).toHaveBeenCalledWith([1, 0, 0, 0, 30, 0])
    expect(stopRunner).toHaveBeenCalled()
    await expect(coordinator.submit({ kind: 'continuous-end', source: 'manual-cartesian' }))
      .resolves.toMatchObject({ ok: true, result: 'completed' })
  })

  it('连续规划失败会关闭会话并取消后续 tick', async () => {
    const planSpy = vi.fn(() => ({
      ok: false as const,
      error: { code: 'invalid-request' as const, category: 'invalid-request' as const, details: {} },
    }))
    const coordinator = createMotionCoordinator({
      plan: planSpy,
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner: vi.fn(),
    })

    await coordinator.submit({ kind: 'continuous-begin', source: 'manual-joint' })
    await expect(coordinator.submit({
      kind: 'continuous-update',
      source: 'manual-joint',
      request,
      playback: 'speed-limited',
    })).resolves.toMatchObject({ ok: false, reason: 'planning-failure' })
    await expect(coordinator.submit({
      kind: 'continuous-update',
      source: 'manual-joint',
      request,
      playback: 'speed-limited',
    })).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(planSpy).toHaveBeenCalledTimes(1)
  })

  it('目标暂时不可达（unreachable/joint-limit 等）不会关闭连续会话——拖出再拖回可恢复', async () => {
    let unreachable = true
    const planSpy = vi.fn(() =>
      unreachable
        ? {
            ok: false as const,
            error: { code: 'unreachable' as const, category: 'planning-failure' as const, details: {} },
          }
        : plan,
    )
    const coordinator = createMotionCoordinator({
      plan: planSpy,
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner: vi.fn(),
    })

    await coordinator.submit({ kind: 'continuous-begin', source: 'gizmo' })
    // 第一个 tick：目标在工作空间外，规划失败，但会话不应关闭。
    await expect(coordinator.submit({
      kind: 'continuous-update',
      source: 'gizmo',
      request,
      playback: 'stream',
    })).resolves.toMatchObject({ ok: false, reason: 'planning-failure' })

    unreachable = false
    // 第二个 tick：拖回工作空间内，同一会话应能继续规划并成功，不需要重新 continuous-begin。
    await expect(coordinator.submit({
      kind: 'continuous-update',
      source: 'gizmo',
      request,
      playback: 'stream',
    })).resolves.toMatchObject({ ok: true, result: 'completed' })
    expect(planSpy).toHaveBeenCalledTimes(2)
  })

  it('硬错误（invalid-request/unsupported-model 等）仍会关闭连续会话', async () => {
    const planSpy = vi.fn(() => ({
      ok: false as const,
      error: { code: 'unsupported-model' as const, category: 'unsupported-model' as const, details: {} },
    }))
    const coordinator = createMotionCoordinator({
      plan: planSpy,
      runImmediate: vi.fn(),
      runEased: async () => 'completed',
      runTrajectory: async () => 'completed',
      appendTrajectory: async () => 'completed',
      runSpeedLimited: async () => 'completed',
      stopRunner: vi.fn(),
    })

    await coordinator.submit({ kind: 'continuous-begin', source: 'gizmo' })
    await expect(coordinator.submit({
      kind: 'continuous-update',
      source: 'gizmo',
      request,
      playback: 'stream',
    })).resolves.toMatchObject({ ok: false, reason: 'planning-failure' })
    await expect(coordinator.submit({
      kind: 'continuous-update',
      source: 'gizmo',
      request,
      playback: 'stream',
    })).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(planSpy).toHaveBeenCalledTimes(1)
  })
})
