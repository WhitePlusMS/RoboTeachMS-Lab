import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useRobotController, type RobotControllerDeps } from './use-robot-controller.ts'
import { DEFAULT_ROBOT } from '@/robot-models/registry.ts'
import type { JointAngles } from '@/robot-geometry/robot-types.ts'

describe('手动控制接管入口', () => {
  function setup() {
    const events: string[] = []
    const deps: RobotControllerDeps = {
      profile: { ...DEFAULT_ROBOT, id: 'test-model', revision: 'test-revision' },
      joints: ref<JointAngles>([...DEFAULT_ROBOT.homeJoints]),
      jointRanges: DEFAULT_ROBOT.jointRanges,
      jointStep: ref(1),
      pose: ref({ positionMm: [0, 0, 0], orientationDeg: [0, 0, 0] }),
      setStep: vi.fn(),
      motionCoordinator: {
        submit: vi.fn(async () => ({ ok: true as const, result: 'completed' as const })),
        stop: vi.fn(),
        dispose: vi.fn(),
      },
      stopActiveProgram: () => {
        events.push('stop-program')
      },
      runLog: {
        entries: ref([]),
        append: vi.fn(),
        info: vi.fn(),
        ok: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      cartesian: {
        coordinateSystem: ref('World'),
        positionStep: ref(1),
        orientationStep: ref(1),
        status: ref('ready'),
        statusMessage: ref(''),
        move: () => {
          events.push('move')
        },
        beginContinuous: () => {
          events.push('begin')
        },
        endContinuous: () => {
          events.push('end')
        },
        setCoordinateSystem: vi.fn(),
        setPositionStep: vi.fn(),
        setOrientationStep: vi.fn(),
      },
    }
    return { controller: useRobotController(deps), deps, events }
  }

  it('笛卡尔单步与长按均先停止活动程序', () => {
    const { controller, events } = setup()
    controller.moveCartesian('x', 1)
    expect(events).toEqual(['stop-program', 'move'])
    events.length = 0
    controller.beginCartesianContinuous('x', 1)
    expect(events).toEqual(['end', 'stop-program', 'begin'])
  })

  it('Home 与机械零位使用当前装配机型身份', () => {
    const { controller, deps } = setup()
    controller.reset()
    controller.resetMechanicalZero()
    for (const call of vi.mocked(deps.motionCoordinator.submit).mock.calls) {
      expect(call[0]).toMatchObject({
        request: { robot: { modelId: 'test-model', modelRevision: 'test-revision' } },
      })
    }
  })
})
