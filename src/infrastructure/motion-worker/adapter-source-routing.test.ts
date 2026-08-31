/**
 * 特征化测试：锁定"gizmo 拖拽 + 笛卡尔连续点动改同步直调"这次修复的关键行为。
 *
 * 背景：a0d0941/b338895 重构把这两条路径统一改成走 Worker 异步往返，
 * gizmo 还多了一个旧版本没有的 140ms 缓动，导致"一顿一顿"和"gizmo 早跑机械臂才追上"。
 * 本次修复：按 source 路由 transport（gizmo/manual-cartesian 走主线程同步直调
 * planMotion，其余走 Worker），复刻旧版本 5391fad 的低延迟路径；不新增第二套算法。
 */

import { describe, expect, it, vi } from 'vitest'
import { createMotionPlannerAdapter, createMotionPlannerWorkerAdapter } from './adapter.ts'
import { planMotion } from '@/robot-motion-core/index.ts'
import { createCartesianTargetRequest } from '@/application/motion/motion-requests.ts'

const request = createCartesianTargetRequest(
  { position: [10, 0, 0], euler: [0, 0, 0], rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  [0, -25, 45, 0, 20, 0],
)

describe('MotionPlannerWorkerAdapter 按 source 路由 transport', () => {
  it('gizmo 来源同步直调 planMotion，不创建 Worker', () => {
    const workerSpy = vi.fn()
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: class {
        constructor() {
          workerSpy()
        }
        postMessage(): void {}
        terminate(): void {}
      },
    })
    try {
      const adapter = createMotionPlannerWorkerAdapter()
      const result = adapter.plan(request, 'gizmo')
      // 同步直调场景下，Promise 应已经用 planMotion 的结果 resolve，不等待任何 Worker 消息。
      expect(workerSpy).not.toHaveBeenCalled()
      return expect(result).resolves.toEqual(planMotion(request))
    } finally {
      delete (globalThis as { Worker?: unknown }).Worker
    }
  })

  it('manual-cartesian 来源同步直调 planMotion，不创建 Worker', () => {
    const workerSpy = vi.fn()
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: class {
        constructor() {
          workerSpy()
        }
        postMessage(): void {}
        terminate(): void {}
      },
    })
    try {
      const adapter = createMotionPlannerWorkerAdapter()
      const result = adapter.plan(request, 'manual-cartesian')
      expect(workerSpy).not.toHaveBeenCalled()
      return expect(result).resolves.toEqual(planMotion(request))
    } finally {
      delete (globalThis as { Worker?: unknown }).Worker
    }
  })

  it('rapid 来源仍然创建 Worker（现状不变）', () => {
    const workerSpy = vi.fn()
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: class {
        onmessage: ((event: unknown) => void) | null = null
        constructor() {
          workerSpy()
        }
        postMessage(): void {}
        terminate(): void {}
      },
    })
    try {
      const adapter = createMotionPlannerWorkerAdapter()
      void adapter.plan(request, 'rapid')
      expect(workerSpy).toHaveBeenCalledTimes(1)
      adapter.dispose()
    } finally {
      delete (globalThis as { Worker?: unknown }).Worker
    }
  })

  it('manual-joint 来源仍然创建 Worker（关节 Jog 基线不变）', () => {
    const workerSpy = vi.fn()
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: class {
        onmessage: ((event: unknown) => void) | null = null
        constructor() {
          workerSpy()
        }
        postMessage(): void {}
        terminate(): void {}
      },
    })
    try {
      const adapter = createMotionPlannerWorkerAdapter()
      void adapter.plan(request, 'manual-joint')
      expect(workerSpy).toHaveBeenCalledTimes(1)
      adapter.dispose()
    } finally {
      delete (globalThis as { Worker?: unknown }).Worker
    }
  })

  it('非浏览器 fallback adapter 对所有来源都同步直调 planMotion（现状不变）', async () => {
    delete (globalThis as { Worker?: unknown }).Worker
    const adapter = createMotionPlannerAdapter()
    await expect(adapter.plan(request, 'rapid')).resolves.toEqual(planMotion(request))
  })
})
