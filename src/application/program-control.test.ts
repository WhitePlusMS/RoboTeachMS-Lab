// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ABB_IRB1200_PROFILE } from '../robot-models/abb-irb1200/robot-profile.ts'
import { createMotionRunner, type MotionResult, type MotionRunner } from '../robotics/motion-runner.ts'
import { ManualMotionClock } from '../testing/manual-motion-clock.ts'
import type { JointAngles } from '../robotics/types.ts'
import { createBuiltinRapidSource } from './builtin-program.ts'
import { useProgramController, type ProgramControllerMotion } from './program-control.ts'

/** 可控程序运动 fake：暴露 resolvers 以在测试末尾结算程序并清理轮询。 */
function makeMotion() {
  let resolveEased: ((r: MotionResult) => void) | null = null
  const calls = { pause: 0, resume: 0, stop: 0 }
  const motion: ProgramControllerMotion = {
    startEasedAnimation: () => new Promise<MotionResult>((resolve) => { resolveEased = resolve }),
    startCartesianTrajectory: () => new Promise<MotionResult>(() => {}),
    stopAnimation: () => { calls.stop += 1 },
    pauseMotion: () => { calls.pause += 1 },
    resumeMotion: () => { calls.resume += 1 },
  }
  return { motion, calls, settle: (r: MotionResult) => resolveEased?.(r) }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('program-control adapter', () => {
  it('ProgramControllerMotion 不再要求 getMotionStatus，且关键命令输出 [ABB-PROGRAM] 日志', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { motion, calls, settle } = makeMotion()

    const joints = ref<JointAngles>([0, 0, 0, 0, 0, 0])
    const ctrl = useProgramController({
      source: ref(createBuiltinRapidSource()),
      profile: ABB_IRB1200_PROFILE,
      joints,
      motion,
    })

    ctrl.run()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('程序开始'))

    ctrl.pause()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('暂停'))
    expect(calls.pause).toBe(1)

    ctrl.resume()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('继续'))
    expect(calls.resume).toBe(1)

    ctrl.stop()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('停止请求'))
    expect(calls.stop).toBe(1)

    // 结算程序为 stopped，触发终止日志并停止轮询。
    settle('stopped')
    await flush()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('程序停止'))
    expect(ctrl.snapshot.value.state).toBe('stopped')

    info.mockRestore()
    error.mockRestore()
  })
})

/**
 * 手动抢占测试：App 的关节单步/随机/回零/笛卡尔等手动命令入口都先调用
 * `stopActiveProgram()`，再启动手动运动。这里用真实共享 MotionRunner 验证该机制：
 * 活动程序先停止、旧程序不再推进、手动运动正常开始、始终只有一个活动运动。
 */
describe('手动命令与程序竞争 MotionRunner 的抢占', () => {
  function setup() {
    const clock = new ManualMotionClock()
    const joints = ref<JointAngles>([0, 0, 0, 0, 0, 0])
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => [...joints.value],
      setJoints: (next) => { joints.value = [...next] },
    })
    const motion: ProgramControllerMotion = {
      startEasedAnimation: (target, duration) => runner.startEased(target, duration),
      startCartesianTrajectory: (waypoints, duration) => runner.startTrajectory(waypoints, duration),
      stopAnimation: () => runner.stop(),
      pauseMotion: () => runner.pause(),
      resumeMotion: () => runner.resume(),
    }
    const ctrl = useProgramController({
      source: ref(createBuiltinRapidSource()),
      profile: ABB_IRB1200_PROFILE,
      joints,
      motion,
    })
    return { clock, joints, runner, ctrl }
  }

  // 四类手动控制入口在 App 里都先调 stopActiveProgram() 再启动手动运动；
  // 关节单步/随机姿态/回零走 eased，笛卡尔命令走 trajectory。逐一验证抢占。
  const MANUAL_COMMANDS: Array<{ name: string; start: (runner: MotionRunner) => Promise<MotionResult> }> = [
    { name: '关节单步', start: (runner) => runner.startEased([5, 0, 0, 0, 0, 0], 100) },
    { name: '随机姿态', start: (runner) => runner.startEased([30, -20, 10, 5, 5, 5], 100) },
    { name: '机器人回零', start: (runner) => runner.startEased([0, 0, 0, 0, 0, 0], 100) },
    {
      name: '笛卡尔命令',
      start: (runner) =>
        runner.startTrajectory(
          [
            [10, 0, 0, 0, 0, 0],
            [20, 0, 0, 0, 0, 0],
          ],
          100,
        ),
    },
  ]

  for (const command of MANUAL_COMMANDS) {
    it(`程序运行时${command.name}抢占：程序先停止、单运动、手动运动完成`, async () => {
      const { clock, runner, ctrl } = setup()
      ctrl.run()
      // 推进第一条 MoveJ 一部分，程序仍在运行。
      clock.advanceBy(200)
      await flush()
      expect(ctrl.snapshot.value.state).toBe('running')

      // 手动命令：先停活动程序，再启动手动运动。
      ctrl.stopActiveProgram()
      const manual = command.start(runner)
      // 程序已停止，手动运动进行中 —— 始终只有一个活动运动。
      expect(clock.pendingFrameCount()).toBeLessThanOrEqual(1)

      clock.advanceBy(500)
      await flush()
      expect(await manual).toBe('completed')
      // 旧程序最终为 stopped，不推进到下一条指令。
      expect(ctrl.snapshot.value.state).toBe('stopped')
      expect(ctrl.snapshot.value.programPointer).toBe(0)
      expect(clock.pendingFrameCount()).toBe(0)
    })
  }

  it('程序暂停时手动命令抢占：先停止活动程序、手动运动正常开始', async () => {
    const { clock, runner, ctrl } = setup()
    ctrl.run()
    clock.advanceBy(200)
    await flush()
    ctrl.pause()
    expect(ctrl.snapshot.value.state).toBe('paused')

    ctrl.stopActiveProgram()
    const manual = runner.startEased([20, 10, 5, 0, 0, 0], 100)
    expect(clock.pendingFrameCount()).toBeLessThanOrEqual(1)

    clock.advanceBy(100)
    await flush()
    expect(await manual).toBe('completed')
    expect(ctrl.snapshot.value.state).toBe('stopped')
    expect(ctrl.snapshot.value.programPointer).toBe(0)
  })

  it('程序 idle 时 stopActiveProgram 是无操作，不影响后续手动运动', async () => {
    const { clock, runner, ctrl } = setup()
    ctrl.stopActiveProgram()
    expect(ctrl.snapshot.value.state).toBe('idle')
    const manual = runner.startEased([20, 10, 5, 0, 0, 0], 100)
    clock.advanceBy(100)
    await flush()
    expect(await manual).toBe('completed')
    expect(ctrl.snapshot.value.state).toBe('idle')
  })
})
