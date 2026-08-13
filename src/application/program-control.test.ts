// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ref, type Ref } from 'vue'
import { ABB_IRB1200_PROFILE } from '../robot-models/abb-irb1200/robot-profile.ts'
import { createMotionRunner, type MotionResult, type MotionRunner } from '../robotics/motion-runner.ts'
import { ManualMotionClock } from '../testing/manual-motion-clock.ts'
import type { JointAngles } from '../robotics/types.ts'
import { createBuiltinRapidSource } from './builtin-program.ts'
import { useProgramController, type ProgramControllerMotion } from './program-control.ts'
import type { RobTarget } from '../rapid/rapid-types.ts'
import { isRobtargetProgramData } from '../rapid/rapid-parser.ts'

/** 构造一个用于 Program Data 示教操作的 robtarget（单位姿态、零 robconf、未使用外轴）。 */
function taughtTarget(trans: [number, number, number]): RobTarget {
  return {
    trans,
    rot: [1, 0, 0, 0],
    robconf: [0, 0, 0, 0],
    extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
  }
}


/** 可控程序运动 fake：暴露 resolvers 以在测试末尾结算程序并清理轮询；stop 结算当前活动运动。 */
function makeMotion() {
  let resolveEased: ((r: MotionResult) => void) | null = null
  const calls = { stop: 0 }
  const motion: ProgramControllerMotion = {
    startEasedAnimation: () => new Promise<MotionResult>((resolve) => { resolveEased = resolve }),
    startCartesianTrajectory: () => new Promise<MotionResult>(() => {}),
    stopAnimation: () => {
      calls.stop += 1
      // 与真实 MotionRunner 一致：停止结算当前活动运动为 stopped，让执行链推进。
      resolveEased?.('stopped')
    },
  }
  return { motion, calls, settle: (r: MotionResult) => resolveEased?.(r) }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('program-control adapter', () => {
  it('ProgramController 暴露 run/step/stop/ppToMain，且关键命令输出 [ABB-PROGRAM] 日志', async () => {
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

    // 运行请求：从 idle 启动。
    ctrl.run()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('运行请求'))

    // 停止请求：关闭首条运动并结算为 stopped。
    ctrl.stop()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('停止请求'))
    expect(calls.stop).toBe(1)
    settle('stopped')
    await flush()
    expect(ctrl.snapshot.value.state).toBe('stopped')

    // 停止后可单步：从当前 PP 执行一条并回到 stopped。
    ctrl.step()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('单步请求'))
    settle('stopped')
    await flush()
    expect(ctrl.snapshot.value.state).toBe('stopped')

    // stopped 后可 PP to Main 回到 main 入口并回到 idle。
    ctrl.ppToMain()
    expect(info).toHaveBeenCalledWith(expect.stringContaining('PP to Main'))
    expect(ctrl.snapshot.value.state).toBe('idle')
    expect(ctrl.snapshot.value.programPointer).toBe(0)

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

describe('applyEdit 单一受控编辑入口', () => {
  function setupController() {
    const { motion, calls } = makeMotion()
    const joints = ref<JointAngles>([0, 0, 0, 0, 0, 0])
    const source = ref(createBuiltinRapidSource())
    const ctrl = useProgramController({
      source,
      profile: ABB_IRB1200_PROFILE,
      joints,
      motion,
    })
    return { source, ctrl, motion, calls }
  }

  it('成功编辑只经过 applyEdit 更新源码 ref，parsed 随之反映新点位', () => {
    const { source, ctrl } = setupController()
    const before = source.value

    const result = ctrl.applyEdit({ type: 'create-target', name: 'pTaught', target: taughtTarget([500, 0, 700]) })
    expect(result.ok).toBe(true)
    expect(source.value).not.toBe(before)
    expect(ctrl.parsed.value.data.map((d) => d.name)).toContain('pTaught')
    expect(ctrl.parsed.value.canExecute).toBe(true)
  })

  it('失败编辑保持 source 与选择逐字不变、无部分修改', () => {
    const { source, ctrl } = setupController()
    const before = source.value

    // 删除有引用的目标（pApproach 被内置主程序引用）应被拒绝。
    const denied = ctrl.applyEdit({ type: 'delete-target', name: 'pApproach' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('target-referenced')
    // 非法名称应被拒绝。
    const invalid = ctrl.applyEdit({ type: 'create-target', name: '9x', target: taughtTarget([0, 0, 0]) })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('invalid-name')

    expect(source.value).toBe(before)
    // 只关心 robtarget 点位；系统预定义 tool0/wobj0/speed/zone 与其它类型条目不计入。
    expect(ctrl.parsed.value.data.filter(isRobtargetProgramData).map((d) => d.name)).toEqual(['pApproach', 'pWork', 'pRest'])
  })

  it('Modify Position 替换目标值后程序仍可执行', () => {
    const { ctrl } = setupController()
    const result = ctrl.applyEdit({ type: 'modify-position', name: 'pWork', target: taughtTarget([600, 200, 400]) })
    expect(result.ok).toBe(true)
    expect(ctrl.parsed.value.canExecute).toBe(true)
    const pWork = ctrl.parsed.value.data.filter(isRobtargetProgramData).find((d) => d.name === 'pWork')
    expect(pWork?.target.trans).toEqual([600, 200, 400])
  })

  it('插入 MoveJ 引用现有目标后可执行且新程序多一条运动', () => {
    const { ctrl } = setupController()
    const result = ctrl.applyEdit({ type: 'insert-motion', name: 'pRest', kind: 'movej', insertionIndex: 3 })
    expect(result.ok).toBe(true)
    expect(ctrl.parsed.value.canExecute).toBe(true)
    expect(ctrl.parsed.value.program).toHaveLength(4)
    expect(ctrl.parsed.value.program[3].kind).toBe('movej')
  })
})

interface ControllerHarness {
  source: Ref<string>
  ctrl: ReturnType<typeof useProgramController>
  settle: (r: MotionResult) => void
}

/** 全 MoveJ 源程序：受控编辑/PP 映射/off-path 测试用它，避免 MoveL 笛卡尔规划在 joint 未真实移动时误报不可达。 */
const MOVEJ_SOURCE = `MODULE Demo
    CONST robtarget p1 := [[500,100,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget p2 := [[451,150,680],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    CONST robtarget p3 := [[451,0,807.1],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];

    PROC main()
        MoveJ p1,v200,fine,tool0;
        MoveJ p2,v200,fine,tool0;
        MoveJ p3,v200,fine,tool0;
    ENDPROC
ENDMODULE`

function setupController(): ControllerHarness {
  const { motion, settle } = makeMotion()
  const source = ref(MOVEJ_SOURCE)
  const joints = ref<JointAngles>([0, 0, 0, 0, 0, 0])
  const ctrl = useProgramController({ source, profile: ABB_IRB1200_PROFILE, joints, motion })
  return { source, ctrl, settle }
}

describe('停止后源码编辑的 PP 映射', () => {
  it('Modify Position（受控编辑）后 PP 仍指向原来的下一条运动指令', async () => {
    const h = setupController()
    // 全 MoveJ 程序：MoveJ p1, MoveJ p2, MoveJ p3；停在第一条后 PP=1。
    h.ctrl.run()
    await flush()
    h.settle('completed')
    await flush()
    h.ctrl.stop()
    await flush()
    expect(h.ctrl.snapshot.value.state).toBe('stopped')
    expect(h.ctrl.snapshot.value.programPointer).toBe(1)

    const result = h.ctrl.applyEdit({ type: 'modify-position', name: 'p2', target: taughtTarget([500, 100, 680]) })
    expect(result.ok).toBe(true)
    await flush()
    expect(h.ctrl.snapshot.value.needsPPtoMain).toBe(false)
    expect(h.ctrl.snapshot.value.programPointer).toBe(1)
  })

  it('重命名当前 PP 指令引用的目标后 PP 映射到更新后的同一条指令', async () => {
    const h = setupController()
    h.ctrl.run()
    await flush()
    h.settle('completed')
    await flush()
    h.ctrl.stop()
    await flush()
    expect(h.ctrl.snapshot.value.programPointer).toBe(1)

    // PP=1 是 MoveJ p2；重命名 p2 后同一下标指令仍指向同一运动。
    const result = h.ctrl.applyEdit({ type: 'rename-target', name: 'p2', newName: 'pPart' })
    expect(result.ok).toBe(true)
    await flush()
    expect(h.ctrl.snapshot.value.needsPPtoMain).toBe(false)
    expect(h.ctrl.snapshot.value.programPointer).toBe(1)
    expect(h.ctrl.parsed.value.program[1].sourceText).toContain('pPart')
  })

  it('自由编辑删除 PP 指令无法唯一映射时要求 PP to Main，PP to Main 后用新源码从 main 重建', async () => {
    const h = setupController()
    h.ctrl.run()
    await flush()
    h.settle('completed')
    await flush()
    h.ctrl.stop()
    await flush()
    expect(h.ctrl.snapshot.value.programPointer).toBe(1)

    // 手工把 PP 所在指令（MoveJ p2，0 基下标 7 行）删除，无法结构化映射。
    const lines = h.source.value.split('\n')
    const removed = lines.filter((_, i) => i !== 7)
    h.source.value = removed.join('\n')
    await flush()
    expect(h.ctrl.snapshot.value.needsPPtoMain).toBe(true)

    // 需要 PP to Main 后再运行。
    const before = h.ctrl.snapshot.value.state
    h.ctrl.run()
    expect(h.ctrl.snapshot.value.state).toBe(before)
    h.ctrl.ppToMain()
    expect(h.ctrl.snapshot.value.needsPPtoMain).toBe(false)
    expect(h.ctrl.snapshot.value.state).toBe('idle')
    expect(h.ctrl.snapshot.value.programPointer).toBe(0)
  })

  it('普通 textarea 编辑不破坏 PP 时保留原 PP（保守策略不静默失效）', async () => {
    const h = setupController()
    h.ctrl.run()
    await flush()
    h.settle('completed')
    await flush()
    h.ctrl.stop()
    await flush()
    expect(h.ctrl.snapshot.value.programPointer).toBe(1)

    // 手工改一个目标值（不影响指令顺序/文本），PP 按保守策略保留。
    h.source.value = h.source.value.replace('[[451,150,680]', '[[450,150,680]')
    await flush()
    expect(h.ctrl.snapshot.value.needsPPtoMain).toBe(false)
    expect(h.ctrl.snapshot.value.programPointer).toBe(1)
  })

  it('停止后在 PP 之前插入运动时，旧的下一条指令仍保持为 PP', async () => {
    const h = setupController()
    h.ctrl.run()
    await flush()
    h.settle('completed')
    await flush()
    h.ctrl.stop()
    await flush()
    expect(h.ctrl.snapshot.value.programPointer).toBe(1)

    const result = h.ctrl.applyEdit({ type: 'insert-motion', name: 'p3', kind: 'movej', insertionIndex: 1 })
    expect(result.ok).toBe(true)
    await flush()
    expect(h.ctrl.snapshot.value.needsPPtoMain).toBe(false)
    expect(h.ctrl.snapshot.value.programPointer).toBe(2)
    expect(h.ctrl.parsed.value.program[2].operands.target).toBe('p2')
  })
})

describe('停止后 Jog 与 off-path Clear 确认', () => {
  async function stopped(h: ControllerHarness) {
    h.ctrl.run()
    await flush()
    h.settle('completed')
    await flush()
    h.ctrl.stop()
    await flush()
    expect(h.ctrl.snapshot.value.state).toBe('stopped')
    expect(h.ctrl.snapshot.value.programPointer).toBe(1)
  }

  it('初始空闲 Jog 不标记 off-path；停止上下文后再 Jog 标记 off-path', async () => {
    const h = setupController()
    expect(h.ctrl.snapshot.value.offPath).toBe(false)
    // 空闲时手动入口：不标记偏离。
    h.ctrl.stopActiveProgram()
    expect(h.ctrl.snapshot.value.offPath).toBe(false)

    await stopped(h)
    h.ctrl.stopActiveProgram()
    expect(h.ctrl.snapshot.value.offPath).toBe(true)
  })

  it('off-path 点击运行不立即运动，而是请求 Clear 确认；确认后从当前姿态规划', async () => {
    const h = setupController()
    await stopped(h)
    h.ctrl.stopActiveProgram()
    expect(h.ctrl.snapshot.value.offPath).toBe(true)

    // 点击运行：不运动，进入待确认。
    h.ctrl.run()
    await flush()
    expect(h.ctrl.snapshot.value.state).toBe('stopped')
    expect(h.ctrl.pendingClear.value).toBe('run')

    // 确认：清除 off-path，并启动运行。
    h.ctrl.confirmClearToNext()
    expect(h.ctrl.pendingClear.value).toBeNull()
    expect(h.ctrl.snapshot.value.offPath).toBe(false)
    expect(h.ctrl.snapshot.value.state).toBe('running')
  })

  it('off-path 取消后保持停止并保持 off-path 标记', async () => {
    const h = setupController()
    await stopped(h)
    h.ctrl.stopActiveProgram()
    h.ctrl.run()
    await flush()
    expect(h.ctrl.pendingClear.value).toBe('run')

    h.ctrl.cancelClearToNext()
    expect(h.ctrl.pendingClear.value).toBeNull()
    expect(h.ctrl.snapshot.value.offPath).toBe(true)
    expect(h.ctrl.snapshot.value.state).toBe('stopped')
  })
})

describe('off-path Clear 全程单一 MotionRunner 集成', () => {
  function setupReal() {
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
    }
    const ctrl = useProgramController({ source: ref(MOVEJ_SOURCE), profile: ABB_IRB1200_PROFILE, joints, motion })
    return { clock, joints, runner, ctrl }
  }

  it('stop—Jog—confirm—run 全程只有一个 MotionRunner 活动', async () => {
    const { clock, runner, ctrl } = setupReal()
    const drive = async (ms: number) => {
      // ManualMotionClock 每次 advanceBy 只推进一帧，用循环逐帧驱动并让执行链微任务结算。
      const steps = Math.ceil(ms / 16)
      for (let i = 0; i < steps && clock.pendingFrameCount() > 0; i += 1) {
        clock.advanceBy(16)
        await flush()
      }
    }

    ctrl.run()
    clock.advanceBy(300)
    await flush()
    expect(ctrl.snapshot.value.state).toBe('running')

    // Jog 抢占：先停活动程序，再启动手动运动。
    ctrl.stopActiveProgram()
    expect(ctrl.snapshot.value.offPath).toBe(true)
    expect(clock.pendingFrameCount()).toBeLessThanOrEqual(1)
    const jog = runner.startEased([30, -20, 10, 5, 5, 5], 100)
    expect(clock.pendingFrameCount()).toBeLessThanOrEqual(1)

    await drive(20000)
    expect(await jog).toBe('completed')

    // off-path 点击运行不立即运动，确认 Clear 后从当前姿态继续运行。
    ctrl.run()
    expect(ctrl.pendingClear.value).toBe('run')
    ctrl.confirmClearToNext()
    expect(ctrl.snapshot.value.offPath).toBe(false)
    expect(clock.pendingFrameCount()).toBeLessThanOrEqual(1)

    await drive(60000)
    expect(ctrl.snapshot.value.state).toBe('completed')
    expect(clock.pendingFrameCount()).toBe(0)
  })
})
