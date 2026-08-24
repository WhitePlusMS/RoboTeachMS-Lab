import type { MotionPlanDiagnostic, MotionPlanError, MotionPlanErrorKind } from './plan-shared.ts'
import type {
  RapidScalarValue,
  RapidScalarVariable,
  StructuredMotionInstruction,
} from './rapid-types.ts'

/** ProgramExecutor 只要求计划项具备 kind；具体 RAPID 语句由上层 execution seam 解释。 */
export interface ProgramInstruction {
  kind: string
}

/** 运行时执行上下文：变量存储仍由 ProgramExecutor 持有，seam 只读写当前语句需要的值。 */
export interface ProgramExecutionContext {
  readVariable: (name: string) => RapidScalarVariable | null
  writeVariable: (name: string, value: RapidScalarValue) => boolean
}

/**
 * 程序状态；只有 ProgramExecutor 内部维护这些值，调用方通过 getSnapshot 读取。
 * 对齐 ABB 操作：运行/单步/停止/PP to Main；不提供程序级暂停/继续。
 */
export type ProgramState = 'idle' | 'running' | 'stopped' | 'completed' | 'error'

/** 规划错误快照：指令索引 + 稳定错误码（复用规划错误 kind，不接受任意 string）+ 可读消息。 */
export interface ProgramError {
  index: number
  code: MotionPlanErrorKind | 'runtime-error'
  message: string
  diagnostic?: MotionPlanDiagnostic
}

/** 调用方主动查询的稳定程序快照；字段不可被调用方直接改写内部状态。 */
export interface ProgramSnapshot {
  state: ProgramState
  /** 下一条允许执行的指令索引（PP）；只有当前运动返回 completed 后才加一。 */
  programPointer: number
  /** 当前正在规划或运动的指令索引（MP）；没有活动指令时为 null。 */
  motionPointer: number | null
  /** stopped 的来源；用于区分用户停止与单步完成后的等待状态。 */
  stopReason: 'user-stop' | 'step-completed' | null
  error: ProgramError | null
  /** 当前标量变量值；key 按 RAPID 大小写不敏感规则归一化。 */
  variables: ReadonlyMap<string, RapidScalarVariable>
}

/** 单条结构化指令的执行结果：completed/stopped 或规划错误。 */
export type InstructionOutcome =
  | { ok: true; result: 'completed' | 'stopped'; nextPointer?: number }
  | { ok: false; error: MotionPlanError | { kind: 'runtime-error'; message: string } }

/**
 * 程序执行 seam：ProgramExecutor 只按顺序 await execute，并委托 stop
 * 给当前底层运动（在 UI/集成 seam 中即 MotionRunner）。ProgramExecutor 本身不含
 * FK/IK/路径采样/关节插值/RAF/通用队列/UI 文案。MotionRunner 可保留内部暂停能力，
 * 但程序产品界面不提供独立“暂停/继续”。
 */
export interface ProgramExecutionSeam<
  TInstruction extends ProgramInstruction = StructuredMotionInstruction,
> {
  execute: (
    instruction: TInstruction,
    context: ProgramExecutionContext,
  ) => Promise<InstructionOutcome>
  stop: () => void
}

export interface ProgramExecutor {
  /**
   * 从 idle 或 stopped 连续运行剩余程序（始于当前 PP 直到末尾）。仅当未运行时才开始；
   * 否则幂等返回当前状态，不产生第二条执行链。resolve 值为最终终止状态。
   */
  run: () => Promise<ProgramState>
  /**
   * 单步只执行 PP 对应的一条完整可见语句。成功后 MP 清空、PP 推进，若还有指令则
   * 保持 stopped（等待下一步），否则 completed。仅当未运行时才开始，否则幂等。
   */
  step: () => Promise<ProgramState>
  /** 在 running 时终止当前运动；终止结果由执行链恢复后结算为 stopped。 */
  stop: () => void
  /** PP to Main：在非运行状态把 PP 移到 main 入口，不让机器人回零、不清空轨迹。 */
  ppToMain: () => void
  getSnapshot: () => ProgramSnapshot
}

/**
 * 串行执行结构化运动/赋值语句的内存程序，提供 ABB 风格的运行、单步、停止与 PP to Main。
 *
 * 指针语义：当前语句返回 completed 才推进 PP；stopped 不推进、后续指令不执行，
 * 停止后再次运行/单步从当前执行位置继续。规划错误进入 error 且保存准确指令索引。
 * initialPointer 允许在源码编辑后按原 PP 重建执行器。
 */
export function createProgramExecutor(
  instructions: readonly StructuredMotionInstruction[],
  seam: ProgramExecutionSeam<StructuredMotionInstruction>,
  initialPointer?: number,
  initialVariables?: ReadonlyMap<string, RapidScalarVariable>,
): ProgramExecutor

export function createProgramExecutor<TInstruction extends ProgramInstruction>(
  instructions: readonly TInstruction[],
  seam: ProgramExecutionSeam<TInstruction>,
  initialPointer?: number,
  initialVariables?: ReadonlyMap<string, RapidScalarVariable>,
): ProgramExecutor

export function createProgramExecutor<TInstruction extends ProgramInstruction>(
  instructions: readonly TInstruction[],
  seam: ProgramExecutionSeam<TInstruction>,
  initialPointer = 0,
  initialVariables: ReadonlyMap<string, RapidScalarVariable> = new Map(),
): ProgramExecutor {
  let state: ProgramState = 'idle'
  let programPointer = initialPointer
  let motionPointer: number | null = null
  let stopReason: ProgramSnapshot['stopReason'] = null
  let error: ProgramError | null = null
  const variables = new Map<string, RapidScalarVariable>()
  for (const [name, variable] of initialVariables) {
    variables.set(normalizeVariableName(name), { ...variable })
  }
  // 最小停止请求状态：保证一次运动中连续多次 stop 只委托一次 seam.stop()。
  let stopRequested = false

  function currentSnapshot(): ProgramSnapshot {
    return {
      state,
      programPointer,
      motionPointer,
      stopReason,
      error: error ? { ...error } : null,
      variables: new Map([...variables].map(([name, variable]) => [name, { ...variable }])),
    }
  }

  const context: ProgramExecutionContext = {
    readVariable: (name) => {
      const variable = variables.get(normalizeVariableName(name))
      return variable ? { ...variable } : null
    },
    writeVariable: (name, value) => {
      const key = normalizeVariableName(name)
      const variable = variables.get(key)
      if (!variable) return false
      if (variable.kind === 'num') {
        if (typeof value !== 'number') return false
        variables.set(key, { kind: 'num', value })
      } else {
        if (typeof value !== 'boolean') return false
        variables.set(key, { kind: 'bool', value })
      }
      return true
    },
  }

  function isMotionInstruction(instruction: TInstruction): boolean {
    return (
      instruction.kind === 'movej' ||
      instruction.kind === 'movel' ||
      instruction.kind === 'movec'
    )
  }

  /** 只有未运行时才可启动新的执行（idle/stopped）；运行中返回 false 防止第二条链。 */
  function canStart(): boolean {
    return state !== 'running'
  }

  /** 指令执行后的统一结算：completed 推进 PP 并继续，stopped/error 终止并记录。 */
  function settleOutcome(
    index: number,
    outcome: InstructionOutcome,
  ): 'continue' | 'stopped' | 'error' {
    if (!outcome.ok) {
      const diagnostic = 'diagnostic' in outcome.error ? outcome.error.diagnostic : undefined
      error = {
        index,
        code: outcome.error.kind,
        message: outcome.error.message,
        ...(diagnostic ? { diagnostic } : {}),
      }
      motionPointer = null
      stopRequested = false
      stopReason = null
      state = 'error'
      return 'error'
    }
    if (outcome.result === 'stopped') {
      // 停止不算完成：PP 不增加，MP 清空，程序进入 stopped。
      motionPointer = null
      stopRequested = false
      stopReason = 'user-stop'
      state = 'stopped'
      return 'stopped'
    }
    // completed 默认推进下一条；条件指令/分支末条语句可提供内部跳转目标。
    const nextPointer = outcome.nextPointer ?? index + 1
    if (!Number.isInteger(nextPointer) || nextPointer < 0 || nextPointer > instructions.length) {
      error = { index, code: 'runtime-error', message: `无效的程序跳转目标 ${String(nextPointer)}` }
      motionPointer = null
      stopRequested = false
      stopReason = null
      state = 'error'
      return 'error'
    }
    programPointer = nextPointer
    motionPointer = null
    return 'continue'
  }

  async function executeLoop(): Promise<ProgramState> {
    state = 'running'
    stopReason = null
    // 新一次执行不继承上一次停止请求。
    stopRequested = false
    while (programPointer < instructions.length) {
      const index = programPointer
      motionPointer = isMotionInstruction(instructions[index]) ? index : null
      const outcome = await seam.execute(instructions[index], context)
      const decision = settleOutcome(index, outcome)
      if (decision === 'continue') {
        if (programPointer >= instructions.length) break
        continue
      }
      return state
    }
    state = 'completed'
    return 'completed'
  }

  function run(): Promise<ProgramState> {
    if (!canStart()) return Promise.resolve(state)
    return executeLoop()
  }

  function step(): Promise<ProgramState> {
    if (!canStart()) return Promise.resolve(state)
    if (programPointer >= instructions.length) {
      state = 'completed'
      return Promise.resolve('completed')
    }
    state = 'running'
    stopRequested = false
    stopReason = null
    const index = programPointer
    motionPointer = isMotionInstruction(instructions[index]) ? index : null
    return seam.execute(instructions[index], context).then((outcome) => {
      const decision = settleOutcome(index, outcome)
      if (decision !== 'continue') return state
      // 单步完成一条指令：PP 已推进；还有指令则等待下一步，否则已完成。
      state = programPointer < instructions.length ? 'stopped' : 'completed'
      stopReason = state === 'stopped' ? 'step-completed' : null
      return state
    })
  }

  function stop(): void {
    if (state !== 'running') return
    // 只委托一次 seam.stop；第二次 stop 在当前指令返回前不得再次调用。
    if (stopRequested) return
    stopRequested = true
    // 不在这里直接改状态，避免“旧 async 链在 stop 后再次写状态”的竞态。
    seam.stop()
  }

  function ppToMain(): void {
    // 只在无活动运动时把 PP 移到 main；不让机器人回零、不清空轨迹。
    if (state === 'running') return
    programPointer = 0
    motionPointer = null
    error = null
    stopReason = null
    stopRequested = false
    state = 'idle'
  }

  return { run, step, stop, ppToMain, getSnapshot: currentSnapshot }
}

function normalizeVariableName(name: string): string {
  return name.toLocaleLowerCase('en-US')
}
