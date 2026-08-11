import { describe, expect, it } from 'vitest'
import { createMotionRunner } from '../robotics/motion-runner.ts'
import { ManualMotionClock } from '../testing/manual-motion-clock.ts'
import { AbbDhRobotModel } from '../robot-models/abb-irb1200/dh-robot-model.ts'
import { ABB_JOINT_RANGES } from '../robot-models/abb-irb1200/robot-config.ts'
import type { JointAngles } from '../robotics/types.ts'
import { executeMoveJ } from './movej-planner.ts'
import { executeMoveL } from './movel-planner.ts'
import { createProgramExecutor, type InstructionOutcome, type ProgramError, type ProgramExecutionSeam } from './program-executor.ts'
import {
  defaultTool0,
  defaultWobj0,
  defaultZoneFine,
  NO_EXTERNAL_AXIS,
  type RobTarget,
  type StructuredMoveJ,
  type StructuredMoveL,
  type StructuredMotionInstruction,
} from './rapid-types.ts'

const REACHABLE: RobTarget = {
  trans: [500, 100, 807.1],
  rot: [1, 0, 0, 0],
  robconf: [0, 0, 0, 0],
  extax: [...NO_EXTERNAL_AXIS],
}

function makeMoveJ(overrides: Partial<StructuredMoveJ> = {}): StructuredMoveJ {
  return {
    kind: 'movej',
    target: REACHABLE,
    speed: { v_tcp: 100, v_ori: 100, v_leax: 100, v_reax: 100 },
    zone: defaultZoneFine(),
    tool: defaultTool0(),
    wobj: defaultWobj0(),
    ...overrides,
  }
}

function makeMoveL(overrides: Partial<StructuredMoveL> = {}): StructuredMoveL {
  return {
    kind: 'movel',
    target: REACHABLE,
    speed: { v_tcp: 100, v_ori: 100, v_leax: 100, v_reax: 100 },
    zone: defaultZoneFine(),
    tool: defaultTool0(),
    wobj: defaultWobj0(),
    ...overrides,
  }
}

/**
 * 可控 fake seam：逐个 resolve execute 结果，pause/resume 记账，stop 把当前
 * 挂起的 execute 结算为 stopped（模拟 MotionRunner.stop 结算终止 Promise）。
 */
class FakeSeam implements ProgramExecutionSeam {
  readonly calls: StructuredMotionInstruction['kind'][] = []
  pauseCalls = 0
  resumeCalls = 0
  stopCalls = 0
  private readonly queue: Array<{ kind: string; resolve: (o: InstructionOutcome) => void }> = []

  execute(instruction: StructuredMotionInstruction): Promise<InstructionOutcome> {
    this.calls.push(instruction.kind)
    return new Promise<InstructionOutcome>((resolve) => {
      this.queue.push({ kind: instruction.kind, resolve })
    })
  }

  pendingCount(): number {
    return this.queue.length
  }

  resolveNext(result: InstructionOutcome): void {
    const next = this.queue.shift()
    if (!next) throw new Error('没有待 resolve 的 execute')
    next.resolve(result)
  }

  pause(): void {
    this.pauseCalls += 1
  }

  resume(): void {
    this.resumeCalls += 1
  }

  stop(): void {
    this.stopCalls += 1
    const next = this.queue.shift()
    if (next) next.resolve({ ok: true, result: 'stopped' })
  }
}

describe('ProgramExecutor 串行执行与指针语义', () => {
  it('空程序确定进入 completed，指针为 0，不调用 seam', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([], seam)
    expect(await executor.run()).toBe('completed')
    expect(executor.getSnapshot()).toEqual({
      state: 'completed',
      programPointer: 0,
      motionPointer: null,
      error: null,
    })
    expect(seam.calls).toEqual([])
  })

  it('MoveJ → MoveL → MoveJ 串行执行，当前未完成时不调用下一条', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL(), makeMoveJ()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej'])
    expect(executor.getSnapshot().motionPointer).toBe(0)

    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej', 'movel'])
    expect(executor.getSnapshot().programPointer).toBe(1)
    expect(executor.getSnapshot().motionPointer).toBe(1)

    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej', 'movel', 'movej'])
    expect(executor.getSnapshot().programPointer).toBe(2)

    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await runPromise).toBe('completed')
    expect(executor.getSnapshot().state).toBe('completed')
    expect(executor.getSnapshot().programPointer).toBe(3)
    expect(executor.getSnapshot().motionPointer).toBeNull()
  })

  it('运动返回 stopped 后程序不推进、后续指令不执行', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveJ(), makeMoveJ()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej', 'movej'])
    seam.resolveNext({ ok: true, result: 'stopped' })

    expect(await runPromise).toBe('stopped')
    expect(executor.getSnapshot().state).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(1)
    expect(executor.getSnapshot().motionPointer).toBeNull()
    expect(seam.calls).toEqual(['movej', 'movej'])
  })

  it('规划错误进入 error，保存准确指令索引，后续指令不执行', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveJ(), makeMoveJ()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    seam.resolveNext({ ok: false, error: { kind: 'unreachable', message: '目标不可达' } })

    expect(await runPromise).toBe('error')
    const snapshot = executor.getSnapshot()
    expect(snapshot.state).toBe('error')
    expect(snapshot.error).toEqual({ index: 0, code: 'unreachable', message: '目标不可达' })
    expect(snapshot.programPointer).toBe(0)
    expect(snapshot.motionPointer).toBeNull()
    expect(seam.calls).toEqual(['movej'])
  })

  it('重复 run 请求幂等处理，不产生第二条执行链', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveJ()], seam)

    const firstRun = executor.run()
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej'])

    expect(await executor.run()).toBe('running')
    expect(seam.calls).toEqual(['movej'])

    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await firstRun).toBe('completed')
    expect(seam.calls).toEqual(['movej', 'movej'])
  })

  it('getSnapshot 返回快照且不暴露内部可写状态', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ()], seam)
    expect(executor.getSnapshot().state).toBe('idle')
    const runPromise = executor.run()
    await Promise.resolve()
    ;(executor.getSnapshot() as unknown as { state: string }).state = 'error'
    expect(executor.getSnapshot().state).toBe('running')
    seam.resolveNext({ ok: true, result: 'completed' })
    await runPromise
  })
})

describe('ProgramExecutor 控制命令', () => {
  it('运行中 pause 委托当前 MotionRunner，指针与未完成 Promise 不变', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveJ()], seam)
    const runPromise = executor.run()
    await Promise.resolve()

    executor.pause()
    executor.pause()
    expect(executor.getSnapshot().state).toBe('paused')
    expect(seam.pauseCalls).toBe(1)
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(executor.getSnapshot().motionPointer).toBe(0)
    // 暂停/继续不新增 execute 调用、不创建第二个执行 Promise。
    expect(seam.calls).toEqual(['movej'])

    executor.resume()
    executor.resume()
    expect(executor.getSnapshot().state).toBe('running')
    expect(seam.resumeCalls).toBe(1)
    expect(seam.calls).toEqual(['movej'])

    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await runPromise).toBe('completed')
  })

  it('暂停后停止：当前运动返回 stopped，指针不增加，后续指令不执行', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveJ()], seam)
    const runPromise = executor.run()
    await Promise.resolve()

    executor.pause()
    expect(executor.getSnapshot().state).toBe('paused')
    executor.stop()
    expect(await runPromise).toBe('stopped')
    expect(executor.getSnapshot().state).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(executor.getSnapshot().motionPointer).toBeNull()
    expect(seam.calls).toEqual(['movej'])
  })

  it('重复 pause/resume/stop 幂等，最终状态稳定', async () => {
    // 空闲状态重复命令幂等、不抛异常。
    const idleExec = createProgramExecutor([makeMoveJ()], new FakeSeam())
    idleExec.pause()
    idleExec.resume()
    idleExec.stop()
    idleExec.reset()
    expect(idleExec.getSnapshot().state).toBe('idle')

    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ()], seam)
    const runPromise = executor.run()
    await Promise.resolve()

    // 重复 pause 只委托一次。
    executor.pause()
    executor.pause()
    expect(seam.pauseCalls).toBe(1)
    expect(executor.getSnapshot().state).toBe('paused')

    // 重复 resume 只委托一次。
    executor.resume()
    executor.resume()
    expect(seam.resumeCalls).toBe(1)
    expect(executor.getSnapshot().state).toBe('running')

    // 重复 stop：只结算一次，终止后状态稳定为 stopped。
    executor.stop()
    executor.stop()
    expect(await runPromise).toBe('stopped')
    expect(executor.getSnapshot().state).toBe('stopped')
  })

  it('连续调用两次 stop 时 seam.stop 只执行一次、程序指针不增加', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveJ()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej'])

    // 第一次 stop 委托 seam 并置停止请求；第二次 stop 不得再调用 seam。
    executor.stop()
    executor.stop()
    expect(seam.stopCalls).toBe(1)

    expect(await runPromise).toBe('stopped')
    // 停止不推进到下一指令，程序指针保持 0。
    expect(executor.getSnapshot().state).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(seam.calls).toEqual(['movej'])
  })

  it('reset 后可以重新运行并再次停止（不继承旧停止请求）', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveJ()], seam)

    let runPromise = executor.run()
    await Promise.resolve()
    executor.stop()
    expect(await runPromise).toBe('stopped')
    expect(seam.stopCalls).toBe(1)

    // 清空 seam 记账，复位后重新运行再停止。
    seam.stopCalls = 0
    seam.calls.length = 0
    executor.reset()
    expect(executor.getSnapshot().state).toBe('idle')

    runPromise = executor.run()
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej'])
    executor.stop()
    // 新一次运行的停止请求生效（若旧请求未清空，这里 seam.stop 不会被再次调用）。
    expect(seam.stopCalls).toBe(1)
    expect(await runPromise).toBe('stopped')
    expect(executor.getSnapshot().state).toBe('stopped')
  })

  it('completed 后 reset 回到 idle，指针归零、错误清空', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ()], seam)
    const runPromise = executor.run()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    await runPromise

    expect(executor.getSnapshot().state).toBe('completed')
    executor.reset()
    expect(executor.getSnapshot().state).toBe('idle')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(executor.getSnapshot().motionPointer).toBeNull()
    expect(executor.getSnapshot().error).toBeNull()
  })

  it('error 后 reset 回到 idle 并清空错误', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ()], seam)
    const runPromise = executor.run()
    await Promise.resolve()
    seam.resolveNext({ ok: false, error: { kind: 'unreachable', message: '不可达' } })
    await runPromise
    expect(executor.getSnapshot().state).toBe('error')

    executor.reset()
    expect(executor.getSnapshot().state).toBe('idle')
    expect(executor.getSnapshot().error).toBeNull()
  })

  it('活动状态调用 reset 不做任何修改，不产生竞态', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveJ()], seam)
    const runPromise = executor.run()
    await Promise.resolve()

    executor.reset()
    expect(executor.getSnapshot().state).toBe('running')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(seam.calls).toEqual(['movej'])

    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    await runPromise
  })
})

describe('ProgramExecutor 与真实规划器/手动 MotionClock 集成', () => {
  function makeModelAndRunner() {
    const model = new AbbDhRobotModel()
    const home: JointAngles = [0, 0, 0, 0, 0, 0]
    const clock = new ManualMotionClock()
    let joints: JointAngles = [...home]
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => { joints = [...next] },
    })
    const seam: ProgramExecutionSeam = {
      execute: (instruction) => {
        if (instruction.kind === 'movej') {
          return executeMoveJ(instruction, {
            model,
            currentJoints: () => joints,
            jointRanges: ABB_JOINT_RANGES,
            runEased: (target, durationMs) => runner.startEased(target, durationMs),
          })
        }
        return executeMoveL(instruction, {
          model,
          currentJoints: () => joints,
          jointRanges: ABB_JOINT_RANGES,
          runTrajectory: (waypoints, durationMs) => runner.startTrajectory(waypoints, durationMs),
        })
      },
      pause: () => runner.pause(),
      resume: () => runner.resume(),
      stop: () => runner.stop(),
    }
    return { model, clock, joints, runner, seam }
  }

  it('真实 MoveJ → MoveL → MoveJ 按顺序完成并推进指针', async () => {
    const { model, clock, joints, seam } = makeModelAndRunner()
    const homePose = model.forwardKinematics([0, 0, 0, 0, 0, 0])!
    const at = (dx: number, dy: number, dz: number): RobTarget => ({
      trans: [homePose.position[0] + dx, homePose.position[1] + dy, homePose.position[2] + dz],
      rot: [1, 0, 0, 0],
      robconf: [0, 0, 0, 0],
      extax: [...NO_EXTERNAL_AXIS],
    })
    const program: StructuredMotionInstruction[] = [
      makeMoveJ({ target: at(40, 0, -20) }),
      makeMoveL({ target: at(40, 60, -20) }),
      makeMoveJ({ target: at(40, 60, 30) }),
    ]
    const executor = createProgramExecutor(program, seam)

    const runPromise = executor.run()
    for (let index = 0; index < 400; index += 1) {
      clock.advanceBy(100)
      await Promise.resolve()
    }
    expect(await runPromise).toBe('completed')
    expect(executor.getSnapshot().programPointer).toBe(3)
    expect(executor.getSnapshot().motionPointer).toBeNull()
    void joints
  })

  it('真实 MoveJ 运动中暂停冻结关节、继续后完成', async () => {
    const { clock, joints, seam } = makeModelAndRunner()
    const executor = createProgramExecutor([makeMoveJ()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    // 推进一段（未完成）。
    clock.advanceBy(400)
    const frozenAt = [...joints]

    executor.pause()
    expect(executor.getSnapshot().state).toBe('paused')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(executor.getSnapshot().motionPointer).toBe(0)
    // 暂停期间时钟继续前进，但关节冻结。
    clock.advanceBy(5000)
    expect(joints).toEqual(frozenAt)

    executor.resume()
    expect(executor.getSnapshot().state).toBe('running')
    for (let index = 0; index < 300; index += 1) {
      clock.advanceBy(50)
      await Promise.resolve()
    }
    expect(await runPromise).toBe('completed')
    expect(executor.getSnapshot().programPointer).toBe(1)
  })

  it('真实 MoveL 运动中暂停冻结关节、继续后从剩余时间完成', async () => {
    const { clock, joints, seam } = makeModelAndRunner()
    const executor = createProgramExecutor([makeMoveL()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    clock.advanceBy(400)
    const frozenAt = [...joints]

    executor.pause()
    clock.advanceBy(5000)
    expect(joints).toEqual(frozenAt)

    executor.resume()
    for (let index = 0; index < 300; index += 1) {
      clock.advanceBy(50)
      await Promise.resolve()
    }
    expect(await runPromise).toBe('completed')
    expect(executor.getSnapshot().programPointer).toBe(1)
  })

  it('真实程序暂停后停止：当前运动停止、指针不推进、后续不执行', async () => {
    const { clock, joints, seam } = makeModelAndRunner()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    clock.advanceBy(300)
    executor.pause()
    executor.stop()
    const stoppedAt = [...joints]

    // 停止后不再推进剩余轨迹；旧程序不会继续推进到下一条指令。
    clock.advanceBy(5000)
    expect(joints).toEqual(stoppedAt)
    expect(await runPromise).toBe('stopped')
    expect(executor.getSnapshot().state).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(executor.getSnapshot().motionPointer).toBeNull()
  })
})

// ProgramError.code 复用规划错误可辨识联合种类，不接受任意 string。
// @ts-expect-error ProgramError.code 不接受任意 string
const _badCode: ProgramError = { index: 0, code: 'anything', message: 'x' }
void _badCode
