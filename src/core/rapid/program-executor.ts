import type { MotionPlanError } from './plan-shared'
import type { StructuredMotionInstruction } from './rapid-types'

/**
 * 程序状态；只有 ProgramExecutor 内部维护这些值，调用方通过 getSnapshot 读取。
 * paused 是程序控制状态，不属于运动终止结果。
 */
export type ProgramState = 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'error'

/** 规划错误快照：指令索引 + 稳定错误码（与规划错误 kind 一致）+ 可读消息。 */
export interface ProgramError {
  index: number
  code: string
  message: string
}

/** 调用方主动查询的稳定程序快照；字段不可被调用方直接改写内部状态。 */
export interface ProgramSnapshot {
  state: ProgramState
  /** 下一条允许执行的指令索引；只有当前运动返回 completed 后才加一。 */
  programPointer: number
  /** 当前正在规划或运动的指令索引；没有活动指令时为 null。 */
  motionPointer: number | null
  error: ProgramError | null
}

/** 单条结构化指令的执行结果：completed/stopped 或规划错误。 */
export type InstructionOutcome =
  | { ok: true; result: 'completed' | 'stopped' }
  | { ok: false; error: MotionPlanError }

/**
 * 程序运动执行 seam：ProgramExecutor 只按顺序 await execute，并委托 pause/resume/stop
 * 给当前底层运动（在 UI/集成 seam 中即 MotionRunner）。ProgramExecutor 本身不含
 * FK/IK/路径采样/关节插值/RAF/通用队列/UI 文案。
 */
export interface ProgramExecutionSeam {
  execute: (instruction: StructuredMotionInstruction) => Promise<InstructionOutcome>
  pause: () => void
  resume: () => void
  stop: () => void
}

export interface ProgramExecutor {
  /**
   * 从 idle 启动程序执行链。仅当当前处于 idle 时才开始；否则幂等返回当前状态，
   * 不产生第二条执行链。resolve 值为程序最终到达的终止状态。
   */
  run: () => Promise<ProgramState>
  /** 仅在 running 时暂停并委托当前运动；其余状态幂等，指针与未完成 Promise 不变。 */
  pause: () => void
  /** 仅在 paused 时恢复同一次运动与同一条执行链；其余状态幂等。 */
  resume: () => void
  /** 在 running/paused 时终止当前运动；终止结果由执行链恢复后结算为 stopped。 */
  stop: () => void
  /** 仅在无活动运动的 idle/completed/stopped/error 清理状态；active 时不做任何修改。 */
  reset: () => void
  getSnapshot: () => ProgramSnapshot
}

/**
 * 串行执行只含结构化 MoveJ/MoveL 的内存程序，并支持暂停/继续/停止/复位。
 *
 * 指针语义：只有当前运动返回 completed 才推进 programPointer；stopped 不推进、
 * 后续指令不执行；规划错误进入 error 且保存准确指令索引。暂停/继续保持同一次运动，
 * 不重复规划、不重复提交轨迹、不创建第二个执行 Promise。
 */
export function createProgramExecutor(
  instructions: readonly StructuredMotionInstruction[],
  seam: ProgramExecutionSeam,
): ProgramExecutor {
  let state: ProgramState = 'idle'
  let programPointer = 0
  let motionPointer: number | null = null
  let error: ProgramError | null = null

  function currentSnapshot(): ProgramSnapshot {
    return {
      state,
      programPointer,
      motionPointer,
      error: error ? { ...error } : null,
    }
  }

  async function executeLoop(): Promise<ProgramState> {
    state = 'running'
    while (programPointer < instructions.length) {
      const index = programPointer
      motionPointer = index
      const outcome = await seam.execute(instructions[index])

      if (!outcome.ok) {
        error = { index, code: outcome.error.kind, message: outcome.error.message }
        motionPointer = null
        state = 'error'
        return 'error'
      }
      if (outcome.result === 'stopped') {
        // 停止不算完成：programPointer 不增加，motionPointer 清空，程序进入 stopped。
        motionPointer = null
        state = 'stopped'
        return 'stopped'
      }
      programPointer += 1
      motionPointer = null
    }
    // 最后一条指令完成：programPointer 等于程序长度。
    state = 'completed'
    return 'completed'
  }

  function run(): Promise<ProgramState> {
    // 幂等处理重复运行：只从 idle 启动；运行中/已终止时返回当前状态，不启动第二条链。
    if (state !== 'idle') return Promise.resolve(state)
    return executeLoop()
  }

  function pause(): void {
    if (state !== 'running') return
    state = 'paused'
    // 指针与未完成的运动 Promise 保持不变；只委托当前运动冻结。
    seam.pause()
  }

  function resume(): void {
    if (state !== 'paused') return
    state = 'running'
    // 恢复同一次运动与同一条执行链：不重新规划、不重复提交、不创建第二个 Promise。
    seam.resume()
  }

  function stop(): void {
    if (state !== 'running' && state !== 'paused') return
    // 只委托当前运动停止；不在这里直接改状态，避免“旧 async 链在 stop/reset 后再次写状态”的竞态。
    // 终止结果由 executeLoop 在恢复后统一结算为 stopped（指针不推进）。
    seam.stop()
  }

  function reset(): void {
    // 仅在无活动运动（空闲/已终止）时清理；active 时不修改，调用方必须先 stop。
    if (state === 'idle' || state === 'completed' || state === 'stopped' || state === 'error') {
      programPointer = 0
      motionPointer = null
      error = null
      state = 'idle'
      // 不移动机器人、不回零、不清空场景轨迹、不重新规划程序。
    }
  }

  return { run, pause, resume, stop, reset, getSnapshot: currentSnapshot }
}
