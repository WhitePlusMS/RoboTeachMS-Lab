import { describe, expect, it } from 'vitest'
import { createMotionRunner } from '@/robotics/motion/runner.ts'
import { ManualMotionClock } from '@/testing/manual-motion-clock.ts'
import { AbbRobotModelAdapter } from '@/robot-models/abb-irb1200/kinematics/abb-robot-model-adapter.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/parameters.ts'
import { rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'
import type { JointAngles } from '@/robotics/model/types.ts'
import { executeMoveJ } from './movej-planner.ts'
import { executeMoveL } from './movel-planner.ts'
import { internalQuatToRapid } from './plan-shared.ts'
import {
  createProgramExecutor,
  type InstructionOutcome,
  type ProgramError,
  type ProgramExecutionContext,
  type ProgramExecutionSeam,
  type ProgramInstruction,
} from './program-executor.ts'
import type { RapidScalarValue, RapidScalarVariable } from './rapid-types.ts'
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

const TARGET_MODEL = new AbbRobotModelAdapter()
const TARGET_POSE = TARGET_MODEL.forwardKinematics([0, -10, 5, 0, 30, 180])
if (!TARGET_POSE) throw new Error('program executor target FK unavailable')
const REACHABLE: RobTarget = {
  trans: [...TARGET_POSE.position],
  rot: internalQuatToRapid(rotationMatrixToQuaternion(TARGET_POSE.rotation)),
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
 * 可控 fake seam：逐个 resolve execute 结果，stop 把当前挂起的 execute 结算为 stopped。
 * 用于验证执行器在指令粒度上的指针与状态语义，不依赖真实 IK/关节插值。
 */
class FakeSeam implements ProgramExecutionSeam {
  readonly calls: StructuredMotionInstruction['kind'][] = []
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

  stop(): void {
    this.stopCalls += 1
    const next = this.queue.shift()
    if (next) next.resolve({ ok: true, result: 'stopped' })
  }
}

describe('ProgramExecutor 运行与指针语义', () => {
  it('空程序确定进入 completed，指针为 0，不调用 seam', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([], seam)
    expect(await executor.run()).toBe('completed')
    expect(executor.getSnapshot()).toEqual({
      state: 'completed',
      programPointer: 0,
      motionPointer: null,
      stopReason: null,
      error: null,
      variables: new Map(),
    })
    expect(seam.calls).toEqual([])
  })

  it('运行 MoveJ → MoveL → MoveJ，按顺序推进 PP/MP 并最终 completed', async () => {
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

  it('运动中返回 stopped：指针不推进、MP 清空、后续指令不执行', async () => {
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

  it('规划错误进入 error，保留准确指令索引，错误指令不推进', async () => {
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

  it('规划错误保留 waypoint 与关节级诊断，供控制器日志定位', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ()], seam)
    const runPromise = executor.run()
    await Promise.resolve()
    seam.resolveNext({
      ok: false,
      error: {
        kind: 'unreachable',
        message: '逆解未收敛，目标未执行。',
        diagnostic: {
          waypointIndex: 17,
          axisIndex: 3,
          previousAngleDeg: 12.5,
          attemptedAngleDeg: 168.2,
          deltaDeg: 155.7,
          limitRangeDeg: [-270, 270],
        },
      },
    })

    expect(await runPromise).toBe('error')
    expect(executor.getSnapshot().error).toEqual({
      index: 0,
      code: 'unreachable',
      message: '逆解未收敛，目标未执行。',
      diagnostic: {
        waypointIndex: 17,
        axisIndex: 3,
        previousAngleDeg: 12.5,
        attemptedAngleDeg: 168.2,
        deltaDeg: 155.7,
        limitRangeDeg: [-270, 270],
      },
    })
  })

  it('重复 run 请求幂等，不产生第二条执行链', async () => {
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

describe('ProgramExecutor 单步', () => {
  it('单步执行一条指令后 PP 推进、MP 清空、进入 stopped 等待下一步', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)

    const stepPromise = executor.step()
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej'])
    expect(executor.getSnapshot().motionPointer).toBe(0)

    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await stepPromise).toBe('stopped')
    expect(executor.getSnapshot().state).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(1)
    expect(executor.getSnapshot().motionPointer).toBeNull()
    expect(seam.calls).toEqual(['movej'])
  })

  it('末条单步完成后进入 completed，不产生多余等待状态', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ()], seam)

    const stepPromise = executor.step()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await stepPromise).toBe('completed')
    expect(executor.getSnapshot().state).toBe('completed')
    expect(executor.getSnapshot().programPointer).toBe(1)
  })

  it('连续单步逐条走完整个程序，最后一条显示已完成', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL(), makeMoveJ()], seam)

    let stepPromise = executor.step()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await stepPromise).toBe('stopped')

    stepPromise = executor.step()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await stepPromise).toBe('stopped')

    stepPromise = executor.step()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await stepPromise).toBe('completed')
    expect(executor.getSnapshot().programPointer).toBe(3)
    expect(executor.getSnapshot().state).toBe('completed')
  })

  it('运行中重复 step 幂等，不产生第二条链', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)
    const run = executor.run()
    await Promise.resolve()
    expect(await executor.step()).toBe('running')
    expect(seam.calls).toEqual(['movej'])
    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    await run
  })
})

describe('ProgramExecutor 停止与续跑', () => {
  it('运行中停止只委托一次 seam.stop，未完成指令不计为完成、后续不执行', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej'])

    executor.stop()
    executor.stop()
    expect(seam.stopCalls).toBe(1)

    expect(await runPromise).toBe('stopped')
    expect(executor.getSnapshot().state).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(seam.calls).toEqual(['movej'])
  })

  it('停在中途后再次运行从当前执行位置继续（未完成运动重新规划）', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL(), makeMoveL()], seam)

    // 走到第 2 条时停止。
    let runPromise = executor.run()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    executor.stop()
    expect(await runPromise).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(1)

    // 续跑：从 PP=1 继续执行剩余两条。
    runPromise = executor.run()
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej', 'movel', 'movel'])
    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await runPromise).toBe('completed')
    expect(executor.getSnapshot().programPointer).toBe(3)
  })

  it('停在中途后单步从当前执行位置执行一条', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)

    let runPromise = executor.run()
    await Promise.resolve()
    executor.stop()
    await runPromise
    expect(executor.getSnapshot().programPointer).toBe(0)

    const stepPromise = executor.step()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await stepPromise).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(1)
  })
})

describe('ProgramExecutor PP to Main', () => {
  it('completed 后 PP to Main 把指针移到 main 并回到 idle，不清空运动', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)
    const runPromise = executor.run()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    await runPromise
    expect(executor.getSnapshot().state).toBe('completed')
    expect(executor.getSnapshot().programPointer).toBe(2)

    executor.ppToMain()
    expect(executor.getSnapshot().state).toBe('idle')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(executor.getSnapshot().motionPointer).toBeNull()
  })

  it('stopped 后 PP to Main 重置执行位置，随后可从 main 运行', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)
    const runPromise = executor.run()
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    executor.stop()
    await runPromise
    expect(executor.getSnapshot().programPointer).toBe(1)

    executor.ppToMain()
    expect(executor.getSnapshot().state).toBe('idle')
    expect(executor.getSnapshot().programPointer).toBe(0)

    const run2 = executor.run()
    await Promise.resolve()
    expect(seam.calls).toEqual(['movej', 'movel', 'movej'])
    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    expect(await run2).toBe('completed')
  })

  it('运行中 PP to Main 不做任何修改', async () => {
    const seam = new FakeSeam()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)
    const runPromise = executor.run()
    await Promise.resolve()

    executor.ppToMain()
    expect(executor.getSnapshot().state).toBe('running')
    expect(executor.getSnapshot().programPointer).toBe(0)

    seam.resolveNext({ ok: true, result: 'completed' })
    await Promise.resolve()
    seam.resolveNext({ ok: true, result: 'completed' })
    await runPromise
  })
})

interface AssignmentInstruction extends ProgramInstruction {
  kind: 'assign'
  name: string
  value: RapidScalarValue
  nextPointer?: number
}

/** 只验证 executor 变量 seam 的 fake，不引入 parser 或页面控制器。 */
class VariableSeam implements ProgramExecutionSeam<AssignmentInstruction> {
  execute(
    instruction: AssignmentInstruction,
    context: ProgramExecutionContext,
  ): Promise<InstructionOutcome> {
    if (!context.readVariable(instruction.name)) {
      return Promise.resolve({ ok: false, error: { kind: 'runtime-error', message: '变量不存在' } })
    }
    if (!context.writeVariable(instruction.name, instruction.value)) {
      return Promise.resolve({
        ok: false,
        error: { kind: 'runtime-error', message: '变量类型不匹配' },
      })
    }
    return Promise.resolve({
      ok: true,
      result: 'completed',
      ...(instruction.nextPointer === undefined ? {} : { nextPointer: instruction.nextPointer }),
    })
  }

  stop(): void {}
}

describe('ProgramExecutor 标量变量 seam', () => {
  it('赋值按普通程序指令推进 PP，MP 保持为空，并在 PP to Main 后保留运行值', async () => {
    const seam = new VariableSeam()
    const initial = new Map<string, RapidScalarVariable>([
      ['count', { kind: 'num', value: 1 }],
      ['ready', { kind: 'bool', value: false }],
    ])
    const instructions: AssignmentInstruction[] = [
      { kind: 'assign', name: 'count', value: 3 },
      { kind: 'assign', name: 'ready', value: true },
    ]
    const executor = createProgramExecutor(instructions, seam, 0, initial)

    const first = executor.step()
    expect(executor.getSnapshot().motionPointer).toBeNull()
    expect(await first).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(1)
    expect(executor.getSnapshot().variables.get('count')).toEqual({ kind: 'num', value: 3 })

    expect(await executor.run()).toBe('completed')
    expect(executor.getSnapshot().programPointer).toBe(2)
    expect(executor.getSnapshot().variables.get('ready')).toEqual({ kind: 'bool', value: true })

    const snapshot = executor.getSnapshot()
    const leaked = snapshot.variables as Map<string, RapidScalarVariable>
    leaked.set('count', { kind: 'num', value: 99 })
    expect(executor.getSnapshot().variables.get('count')).toEqual({ kind: 'num', value: 3 })

    executor.ppToMain()
    expect(executor.getSnapshot().state).toBe('idle')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(executor.getSnapshot().variables.get('count')).toEqual({ kind: 'num', value: 3 })
    expect(executor.getSnapshot().variables.get('ready')).toEqual({ kind: 'bool', value: true })
  })

  it('变量写入遵守声明类型，类型不匹配进入 runtime-error 且 PP 停在错误赋值', async () => {
    const seam = new VariableSeam()
    const executor = createProgramExecutor<AssignmentInstruction>(
      [{ kind: 'assign', name: 'ready', value: 1 }],
      seam,
      0,
      new Map([['ready', { kind: 'bool', value: false }]]),
    )

    expect(await executor.run()).toBe('error')
    expect(executor.getSnapshot()).toMatchObject({
      state: 'error',
      programPointer: 0,
      motionPointer: null,
      error: { index: 0, code: 'runtime-error' },
    })
    expect(executor.getSnapshot().variables.get('ready')).toEqual({ kind: 'bool', value: false })
  })

  it('完成结果携带内部跳转时，单步直接停在目标语句，不把跳转本身算作一步', async () => {
    const seam = new VariableSeam()
    const executor = createProgramExecutor<AssignmentInstruction>(
      [
        { kind: 'assign', name: 'count', value: 1, nextPointer: 2 },
        { kind: 'assign', name: 'count', value: 99 },
        { kind: 'assign', name: 'count', value: 3 },
      ],
      seam,
      0,
      new Map([['count', { kind: 'num', value: 0 }]]),
    )

    expect(await executor.step()).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(2)
    expect(executor.getSnapshot().variables.get('count')).toEqual({ kind: 'num', value: 1 })
    expect(await executor.run()).toBe('completed')
    expect(executor.getSnapshot().variables.get('count')).toEqual({ kind: 'num', value: 3 })
  })
})

describe('ProgramExecutor 与真实规划器/手动 MotionClock 集成', () => {
  function makeModelAndRunner() {
    const model = new AbbRobotModelAdapter()
    const home: JointAngles = [0, 0, 0, 0, 30, 180]
    const clock = new ManualMotionClock()
    let joints: JointAngles = [...home]
    const runner = createMotionRunner({
      clock,
      getCurrentJoints: () => joints,
      setJoints: (next) => {
        joints = [...next]
      },
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
        if (instruction.kind !== 'movel') throw new Error('此 seam 只支持 movej/movel')
        return executeMoveL(instruction, {
          model,
          currentJoints: () => joints,
          jointRanges: ABB_JOINT_RANGES,
          runTrajectory: (waypoints, durationMs) => runner.startTrajectory(waypoints, durationMs),
        })
      },
      stop: () => runner.stop(),
    }
    return { model, clock, joints, runner, seam }
  }

  it('真实 MoveJ → MoveL → MoveJ 按顺序完成并推进指针', async () => {
    const { model, clock, joints, seam } = makeModelAndRunner()
    const start: JointAngles = [0, 0, 0, 0, 30, 180]
    const homePose = model.forwardKinematics(start)!
    const homeRotation = internalQuatToRapid(rotationMatrixToQuaternion(homePose.rotation))
    const at = (dx: number, dy: number, dz: number): RobTarget => ({
      trans: [homePose.position[0] + dx, homePose.position[1] + dy, homePose.position[2] + dz],
      rot: homeRotation,
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

  it('真实 MoveJ 运动中停止：关节停在当前位置、指针不推进、后续不执行', async () => {
    const { clock, joints, seam } = makeModelAndRunner()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    clock.advanceBy(400)
    const stoppedAt = [...joints]
    executor.stop()

    // 停止后不再推进剩余轨迹；旧程序不会继续推进到下一条指令。
    clock.advanceBy(5000)
    expect(joints).toEqual(stoppedAt)
    expect(await runPromise).toBe('stopped')
    expect(executor.getSnapshot().state).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(0)
    expect(executor.getSnapshot().motionPointer).toBeNull()
  })

  it('真实停止后单步从当前位置完成一条运动并停在等待下一步', async () => {
    const { clock, joints, seam } = makeModelAndRunner()
    const executor = createProgramExecutor([makeMoveJ(), makeMoveL()], seam)

    const runPromise = executor.run()
    await Promise.resolve()
    clock.advanceBy(300)
    executor.stop()
    await runPromise
    expect(executor.getSnapshot().state).toBe('stopped')

    const stepPromise = executor.step()
    for (let index = 0; index < 400; index += 1) {
      clock.advanceBy(100)
      await Promise.resolve()
    }
    expect(await stepPromise).toBe('stopped')
    expect(executor.getSnapshot().programPointer).toBe(1)
    void joints
  })
})

// ProgramError.code 复用规划错误可辨识联合种类，不接受任意 string。
// @ts-expect-error ProgramError.code 不接受任意 string
const _badCode: ProgramError = { index: 0, code: 'anything', message: 'x' }
void _badCode
