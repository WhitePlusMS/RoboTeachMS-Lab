import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { MotionResult } from '@/robotics/motion-runner.ts'
import type { RobotProfile } from '@/robotics/robot-profile.ts'
import type { JointAngles } from '@/robotics/types.ts'
import { executeMoveJ } from '@/rapid/movej-planner.ts'
import { executeMoveL } from '@/rapid/movel-planner.ts'
import type { RapidScalarValue, RapidScalarVariable } from '@/rapid/rapid-types.ts'
import {
  parseRapidProgram,
  type RapidAssignmentInstruction,
  type RapidDiagnostic,
  type RapidExecutableInstruction,
  type RapidForInstruction,
  type RapidMotionInstruction,
  type RapidParseResult,
  type RapidScalarExpression,
  type RapidSourceRange,
  type RapidWhileInstruction,
} from '@/rapid/rapid-parser.ts'
import {
  applyRapidEdit,
  type RapidEditCommand,
  type RapidEditResult,
  type RapidEditSuccess,
} from '@/rapid/controlled-rapid-edit.ts'
import {
  createProgramExecutor,
  type InstructionOutcome,
  type ProgramExecutionContext,
  type ProgramError,
  type ProgramExecutionSeam,
  type ProgramExecutor,
  type ProgramSnapshot,
  type ProgramState,
} from '@/rapid/program-executor.ts'

/** 程序控制器可用的 MotionRunner 能力子集（由现有 useMotion 提供）；不含程序级暂停/继续。 */
export interface ProgramControllerMotion {
  startEasedAnimation: (target: JointAngles, duration?: number) => Promise<MotionResult>
  startCartesianTrajectory: (
    waypoints: readonly JointAngles[],
    duration?: number,
  ) => Promise<MotionResult>
  stopAnimation: () => void
}

export interface ProgramControllerOptions {
  source: Ref<string>
  profile: RobotProfile
  joints: Ref<JointAngles>
  motion: ProgramControllerMotion
}

export interface ProgramControllerError extends ProgramError {
  sourceRange?: RapidSourceRange
}

export interface ProgramControllerSnapshot extends Omit<ProgramSnapshot, 'error'> {
  error: ProgramControllerError | null
  diagnostics: readonly RapidDiagnostic[]
  /** 停止后源码无法把 PP 唯一映射到新的下一条指令：运行/单步前必须先 PP to Main。 */
  needsPPtoMain: boolean
  /** 停止后机器人被手动 Jog，当前姿态偏离原程序路径。 */
  offPath: boolean
}

export interface ProgramController {
  snapshot: Ref<ProgramControllerSnapshot>
  /** 由源程序实时派生的同一次解析结果；源码、Program Data 列表与诊断共用它，无平行 parser。 */
  parsed: Ref<RapidParseResult>
  run: () => void
  /** 单步只执行 PP 对应的一条完整可见语句，成功后停在等待下一步或完成。 */
  step: () => void
  stop: () => void
  /** PP to Main：在非运行状态把 PP 移到 main，不让机器人回零、不清空轨迹。 */
  ppToMain: () => void
  /** 通过唯一受控编辑入口应用一条 Program Data 命令；成功更新源码，失败保持源码不变。 */
  applyEdit: (command: RapidEditCommand) => RapidEditResult
  /** FlexPendant 式撤销/重做：仅覆盖受控编辑，最多 3 步；自由文本编辑自动清空历史。 */
  undo: () => void
  redo: () => void
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  /** 手动关节/笛卡尔命令前调用：程序活动时先终止，避免争用同一 MotionRunner。 */
  stopActiveProgram: () => void
  /** off-path 时长按 ABB Clear 语义从当前位置规划到下一目标。请求模式为刚点击的运行/单步。 */
  confirmClearToNext: () => void
  /** 取消 off-path 确认：保持停止并保持 off-path 标记。 */
  cancelClearToNext: () => void
  /** 当前正等待 off-path Clear 确认的运行模式（run/step）或 null。 */
  pendingClear: Ref<'run' | 'step' | null>
}

type ScalarEvaluationResult = { ok: true; value: RapidScalarValue } | { ok: false; message: string }

function runtimeError(message: string): ScalarEvaluationResult {
  return { ok: false, message }
}

/** 求值只负责当前赋值表达式，不持有变量；变量状态统一由 ProgramExecutor 的 context 管理。 */
function evaluateScalarExpression(
  expression: RapidScalarExpression,
  context: ProgramExecutionContext,
): ScalarEvaluationResult {
  switch (expression.kind) {
    case 'num-literal':
      return { ok: true, value: expression.value }
    case 'bool-literal':
      return { ok: true, value: expression.value }
    case 'variable': {
      const variable = context.readVariable(expression.name)
      return variable
        ? { ok: true, value: variable.value }
        : runtimeError(`运行时不存在变量 ${expression.name}`)
    }
    case 'group':
      return evaluateScalarExpression(expression.expression, context)
    case 'unary': {
      const operand = evaluateScalarExpression(expression.operand, context)
      if (!operand.ok) return operand
      if (expression.operator === 'NOT') {
        if (typeof operand.value !== 'boolean') return runtimeError('NOT 运算的操作数必须是 bool')
        return { ok: true, value: !operand.value }
      }
      if (typeof operand.value !== 'number')
        return runtimeError(`${expression.operator} 运算的操作数必须是 num`)
      const value = expression.operator === '-' ? -operand.value : operand.value
      return Number.isFinite(value) ? { ok: true, value } : runtimeError('表达式结果不是有限数值')
    }
    case 'binary': {
      const left = evaluateScalarExpression(expression.left, context)
      if (!left.ok) return left
      const right = evaluateScalarExpression(expression.right, context)
      if (!right.ok) return right
      const operator = expression.operator
      if (operator === 'AND' || operator === 'OR') {
        if (typeof left.value !== 'boolean' || typeof right.value !== 'boolean') {
          return runtimeError(`${operator} 运算的两侧必须是 bool`)
        }
        return {
          ok: true,
          value: operator === 'AND' ? left.value && right.value : left.value || right.value,
        }
      }
      if (operator === '=' || operator === '<>') {
        if (typeof left.value !== typeof right.value)
          return runtimeError('比较运算的两侧类型不一致')
        const equal = left.value === right.value
        return { ok: true, value: operator === '=' ? equal : !equal }
      }
      if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
        if (typeof left.value !== 'number' || typeof right.value !== 'number') {
          return runtimeError(`${operator} 比较的两侧必须是 num`)
        }
        if (operator === '<') return { ok: true, value: left.value < right.value }
        if (operator === '<=') return { ok: true, value: left.value <= right.value }
        if (operator === '>') return { ok: true, value: left.value > right.value }
        return { ok: true, value: left.value >= right.value }
      }
      if (typeof left.value !== 'number' || typeof right.value !== 'number') {
        return runtimeError(`${operator} 运算的两侧必须是 num`)
      }
      if (operator === '/' && right.value === 0) return runtimeError('表达式除数不能为 0')
      let value: number
      switch (operator) {
        case '+':
          value = left.value + right.value
          break
        case '-':
          value = left.value - right.value
          break
        case '*':
          value = left.value * right.value
          break
        case '/':
          value = left.value / right.value
          break
      }
      return Number.isFinite(value) ? { ok: true, value } : runtimeError('表达式结果不是有限数值')
    }
  }
}

function normalizeVariableName(name: string): string {
  return name.toLocaleLowerCase('en-US')
}

/** 从当前解析结果生成 executor 初始值；已有同名同类型运行值优先保留。 */
function runtimeVariablesForParsed(
  parsed: RapidParseResult,
  previous: ReadonlyMap<string, RapidScalarVariable> = new Map(),
): Map<string, RapidScalarVariable> {
  const variables = new Map<string, RapidScalarVariable>()
  for (const entry of parsed.data) {
    if ((entry.kind !== 'num' && entry.kind !== 'bool') || entry.storage !== 'var') continue
    const key = normalizeVariableName(entry.name)
    const old = previous.get(key)
    if (old && old.kind === entry.kind) {
      variables.set(key, { ...old })
    } else if (entry.kind === 'num') {
      variables.set(key, { kind: 'num', value: entry.value })
    } else {
      variables.set(key, { kind: 'bool', value: entry.value })
    }
  }
  return variables
}

/**
 * 停止态源码映射只需要识别会改变逻辑上下文的最小事实：标量声明初值、赋值语句和条件头。
 * robtarget 字面量/名称、speed/zone/tool/wobj 值不纳入签名，继续沿用既有点位编辑 PP 保留语义。
 */
function rapidLogicSignature(parsed: RapidParseResult): string {
  const scalarDeclarations = parsed.data
    .filter((entry) => !entry.system && (entry.kind === 'num' || entry.kind === 'bool'))
    .map((entry) => {
      const value = entry.kind === 'num' || entry.kind === 'bool' ? entry.value : ''
      return `${entry.kind}|${normalizeVariableName(entry.name)}|${entry.storage}|${String(value)}`
    })
  const statements = parsed.program.map((instruction) => {
    if (instruction.kind === 'assign') return `assign|${instruction.sourceText}`
    if (instruction.kind === 'if')
      return `if|${instruction.conditionKind}|${instruction.sourceText}`
    if (instruction.kind === 'while') return `while|${instruction.sourceText}`
    if (instruction.kind === 'for') return `for|${instruction.sourceText}`
    if (instruction.kind === 'exitdo') return `exitdo|${instruction.sourceText}`
    return `motion|${instruction.kind}`
  })
  return `${scalarDeclarations.join('\n')}\n---\n${statements.join('\n')}`
}

/** 教学防死循环：整个程序运行期间所有循环步进（执行到循环头）的全局累计上限。 */
const MAX_LOOP_STEPS = 10000

/** FOR 计数循环的运行游标：每次执行到循环头时保持"是否已初始化"与当前值。 */
interface ForCursor {
  initialized: boolean
  current: number
  end: number
  step: number
}

function executeAssignment(
  instruction: RapidAssignmentInstruction,
  context: ProgramExecutionContext,
): InstructionOutcome {
  const result = evaluateScalarExpression(instruction.expression, context)
  if (!result.ok) return { ok: false, error: { kind: 'runtime-error', message: result.message } }
  if (!context.writeVariable(instruction.target.name, result.value)) {
    return {
      ok: false,
      error: { kind: 'runtime-error', message: `无法写入变量 ${instruction.target.name}` },
    }
  }
  return {
    ok: true,
    result: 'completed',
    ...(instruction.nextPointer === undefined ? {} : { nextPointer: instruction.nextPointer }),
  }
}

/** 运动 planner 不认识控制流元数据；在现有 seam 返回后补回分支末条的跳转目标。 */
function attachBranchNextPointer(
  instruction: RapidMotionInstruction | RapidAssignmentInstruction,
  outcome: InstructionOutcome,
): InstructionOutcome {
  if (!outcome.ok || outcome.result !== 'completed' || instruction.nextPointer === undefined) {
    return outcome
  }
  return { ...outcome, nextPointer: instruction.nextPointer }
}

/**
 * 页面端程序控制器：把 Vue 无关的 ProgramExecutor 接到现有 MotionRunner、ABB 模型
 * 与共享 joints 状态上。负责构造程序、PP 映射、off-path 标记与发出控制命令。
 * 不新增动画循环、IK、路径规划或通用 store。
 */
export function useProgramController(options: ProgramControllerOptions): ProgramController {
  async function execute(
    instruction: RapidExecutableInstruction,
    context: ProgramExecutionContext,
  ): Promise<InstructionOutcome> {
    if (instruction.kind === 'if') {
      const result = evaluateScalarExpression(instruction.condition, context)
      if (!result.ok)
        return { ok: false, error: { kind: 'runtime-error', message: result.message } }
      if (typeof result.value !== 'boolean') {
        return { ok: false, error: { kind: 'runtime-error', message: 'IF 条件必须是 bool' } }
      }
      return {
        ok: true,
        result: 'completed',
        nextPointer: result.value ? instruction.trueTarget : instruction.falseTarget,
      }
    }
    if (instruction.kind === 'while') {
      return executeWhile(instruction, context)
    }
    if (instruction.kind === 'for') {
      return executeFor(instruction, context)
    }
    if (instruction.kind === 'exitdo') {
      // EXITDO 的目标恒等于其所在（最内层）FOR 的正常结束目标 falseTarget。
      // 提前退出会绕过 executeFor 的自然完成清理，这里清除该 FOR 游标，
      // 使外层循环再次进入时能按 FROM 重新初始化而不是续值。
      clearForCursorByExitTarget(instruction.target)
      return { ok: true, result: 'completed', nextPointer: instruction.target }
    }
    if (instruction.kind === 'movej') {
      const outcome = await executeMoveJ(instruction, {
        model: options.profile.model,
        currentJoints: () => [...options.joints.value],
        jointRanges: options.profile.jointRanges,
        runEased: (target, durationMs) => options.motion.startEasedAnimation(target, durationMs),
      })
      return attachBranchNextPointer(instruction, outcome)
    }
    if (instruction.kind === 'movel') {
      const outcome = await executeMoveL(instruction, {
        model: options.profile.model,
        currentJoints: () => [...options.joints.value],
        jointRanges: options.profile.jointRanges,
        runTrajectory: (waypoints, durationMs) =>
          options.motion.startCartesianTrajectory(waypoints, durationMs),
      })
      return attachBranchNextPointer(instruction, outcome)
    }
    return executeAssignment(instruction, context)
  }

  // 教学防死循环：run/step 复用同一 seam，步数在全程序运行期内全局累计。
  let loopSteps = 0
  // FOR 计数循环运行游标：按指令引用追踪"是否已初始化 + 当前计数值"。
  const forCursors = new Map<RapidForInstruction, ForCursor>()

  /** 每次执行到循环头先递增全局步数，超限即报运行时错误并自动停止。 */
  function consumeLoopStep(): InstructionOutcome | null {
    loopSteps += 1
    if (loopSteps > MAX_LOOP_STEPS) {
      return {
        ok: false,
        error: { kind: 'runtime-error', message: `循环迭代次数超过安全上限 ${MAX_LOOP_STEPS}` },
      }
    }
    return null
  }

  /** EXITDO 提前退出 FOR 后清除其游标，使再次进入时按 FROM 重新初始化（而非续值）。 */
  function clearForCursorByExitTarget(target: number): void {
    if (forCursors.size === 0) return
    for (const instruction of loadedProgram) {
      if (instruction.kind === 'for' && instruction.falseTarget === target) {
        forCursors.delete(instruction)
      }
    }
  }

  function executeWhile(
    instruction: RapidWhileInstruction,
    context: ProgramExecutionContext,
  ): InstructionOutcome {
    const over = consumeLoopStep()
    if (over) return over
    const result = evaluateScalarExpression(instruction.condition, context)
    if (!result.ok) return { ok: false, error: { kind: 'runtime-error', message: result.message } }
    if (typeof result.value !== 'boolean') {
      return { ok: false, error: { kind: 'runtime-error', message: 'WHILE 条件必须是 bool' } }
    }
    return {
      ok: true,
      result: 'completed',
      nextPointer: result.value ? instruction.trueTarget : instruction.falseTarget,
    }
  }

  /** 求值一个必须为 num 的表达式；非 num 返回运行时错误结果。判别联合避免对象/数字的 typeof 判别。 */
  function evaluateNumExpr(
    expression: RapidScalarExpression,
    context: ProgramExecutionContext,
    what: string,
  ): { ok: true; value: number } | { ok: false; outcome: InstructionOutcome } {
    const result = evaluateScalarExpression(expression, context)
    if (!result.ok)
      return {
        ok: false,
        outcome: { ok: false, error: { kind: 'runtime-error', message: result.message } },
      }
    if (typeof result.value !== 'number' || !Number.isFinite(result.value)) {
      return {
        ok: false,
        outcome: { ok: false, error: { kind: 'runtime-error', message: `${what} 必须是有限数值` } },
      }
    }
    return { ok: true, value: result.value }
  }

  function readForBound(
    expression: RapidScalarExpression | null,
    fallback: number,
    context: ProgramExecutionContext,
    what: string,
  ): number | InstructionOutcome {
    if (expression === null) return fallback
    const evaluated = evaluateNumExpr(expression, context, what)
    if (!evaluated.ok) return evaluated.outcome
    return evaluated.value
  }

  function executeFor(
    instruction: RapidForInstruction,
    context: ProgramExecutionContext,
  ): InstructionOutcome {
    const over = consumeLoopStep()
    if (over) return over
    let cursor = forCursors.get(instruction)
    if (!cursor) {
      cursor = { initialized: false, current: 0, end: 0, step: 1 }
      forCursors.set(instruction, cursor)
    }
    if (!cursor.initialized) {
      // from/to 必填（parser 已保证非 null），直接经判别联合求值；step 可选由 readForBound 兜底 1。
      const from = evaluateNumExpr(instruction.fromExpr, context, 'FOR 起始值')
      if (!from.ok) return from.outcome
      const to = evaluateNumExpr(instruction.toExpr, context, 'FOR 终止值')
      if (!to.ok) return to.outcome
      const step = readForBound(instruction.stepExpr, 1, context, 'FOR 步长')
      if (typeof step !== 'number') return step
      // 步长为 0 无法推进，直接判定空循环。
      if (step === 0) {
        forCursors.delete(instruction)
        return { ok: true, result: 'completed', nextPointer: instruction.falseTarget }
      }
      cursor.initialized = true
      cursor.current = from.value
      cursor.end = to.value
      cursor.step = step
    } else {
      cursor.current += cursor.step
    }
    const finished = cursor.step > 0 ? cursor.current > cursor.end : cursor.current < cursor.end
    if (finished) {
      forCursors.delete(instruction)
      return { ok: true, result: 'completed', nextPointer: instruction.falseTarget }
    }
    if (!context.writeVariable(instruction.loopVar.name, cursor.current)) {
      return {
        ok: false,
        error: { kind: 'runtime-error', message: `无法写入循环变量 ${instruction.loopVar.name}` },
      }
    }
    return { ok: true, result: 'completed', nextPointer: instruction.trueTarget }
  }

  const seam: ProgramExecutionSeam<RapidExecutableInstruction> = {
    execute,
    stop: () => options.motion.stopAnimation(),
  }
  let executor = createProgramExecutor<RapidExecutableInstruction>([], seam)
  let loadedProgram: readonly RapidExecutableInstruction[] = []
  let loadedLogicSignature: string | null = null
  let logicContextDirty = false
  let offPath = false
  let needsPPtoMain = false
  // 紧邻一次受控编辑的标记；结构化编辑不会改变运动指令顺序，因此只需一次性消费。
  let pendingEdit: RapidEditSuccess | null = null
  // 程序因 missing-target（`*` 占位）暂不可执行时，旧 PP 下标挂在这里，等补全目标点后再映射。
  let trackedPP: number | null = null

  /** FlexPendant 式受控编辑历史：撤销/重做最多 3 步（3HAC050941 5.3.4），只存整份源码快照。 */
  interface EditHistoryEntry {
    source: string
  }
  const HISTORY_LIMIT = 3
  const undoStack: EditHistoryEntry[] = []
  const redoStack: EditHistoryEntry[] = []
  const canUndo = ref(false)
  const canRedo = ref(false)
  // undo/redo 写回源码时置位，让 reconcile 知道这不是自由文本编辑，不清空历史。
  let applyingHistory = false

  function updateHistoryFlags(): void {
    canUndo.value = undoStack.length > 0
    canRedo.value = redoStack.length > 0
  }

  function clearEditHistory(): void {
    undoStack.length = 0
    redoStack.length = 0
    updateHistoryFlags()
  }
  // 单一解析事实源：源程序变化时实时重算，运行、Program Data 列表与诊断共用它。
  const parsed = computed(() => parseRapidProgram(options.source.value))
  const snapshot = ref<ProgramControllerSnapshot>(createSnapshot())
  // off-path 请求等待确认的模式；null 表示当前没有待确认 Clear。
  const pendingClear = ref<'run' | 'step' | null>(null)
  let pollTimer: number | null = null

  function createSnapshot(): ProgramControllerSnapshot {
    const base = executor.getSnapshot()
    const sourceRange = base.error ? loadedProgram[base.error.index]?.sourceRange : undefined
    return {
      ...base,
      error: base.error ? { ...base.error, sourceRange } : null,
      diagnostics: parsed.value.diagnostics,
      needsPPtoMain,
      offPath,
    }
  }

  function sync(): void {
    snapshot.value = createSnapshot()
  }

  function startPolling(): void {
    if (pollTimer !== null) return
    pollTimer = window.setInterval(() => {
      sync()
      const state = snapshot.value.state
      // 程序退出活动状态后停止轮询。
      if (state !== 'running') stopPolling()
    }, 100)
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /**
   * 从 idle 首跑时加载程序并重建执行器；否则复用已加载执行器（其 PP 已保留/已映射），
   * 从而支持“停止后从当前执行位置继续”。随后启动一次执行并开始轮询快照。
   */
  function beginExecution(start: (exec: ProgramExecutor) => Promise<ProgramState>): void {
    if (executor.getSnapshot().state === 'idle') {
      const result = parsed.value
      if (!result.canExecute) {
        loadedProgram = []
        loadedLogicSignature = null
        logicContextDirty = false
        snapshot.value = { ...createSnapshot(), state: 'error', error: null }
        console.warn('[ABB-PROGRAM] RAPID 源程序诊断阻止执行', result.diagnostics.length)
        return
      }
      loadedProgram = result.program
      loadedLogicSignature = rapidLogicSignature(result)
      logicContextDirty = false
      executor = createProgramExecutor(loadedProgram, seam, 0, runtimeVariablesForParsed(result))
    }
    const promise = start(executor)
    sync()
    startPolling()
    void promise.then((final) => {
      if (final === 'completed') {
        console.info('[ABB-PROGRAM] 程序完成/单步完成')
      } else if (final === 'stopped') {
        console.info('[ABB-PROGRAM] 程序停止或等待下一步')
      } else if (final === 'error') {
        console.error('[ABB-PROGRAM] 程序规划错误', executor.getSnapshot().error?.message)
      }
      sync()
      stopPolling()
    })
  }

  /** 运行/单步前通过守卫：运行中、需 PP to Main 或 off-path 待确认时都不得立即运动。 */
  function gateRunRequest(): 'run' | 'closed' {
    if (executor.getSnapshot().state === 'running') return 'closed'
    if (needsPPtoMain) {
      console.info('[ABB-PROGRAM] PP 无法映射，需先 PP to Main')
      return 'closed'
    }
    if (offPath) {
      // off-path 不立即运动，而是请求 Clear 确认。
      pendingClear.value = 'run'
      sync()
      console.info('[ABB-PROGRAM] 偏离路径，等待从当前位置规划到下一目标的确认')
      return 'closed'
    }
    return 'run'
  }

  function gateStepRequest(): 'step' | 'closed' {
    if (executor.getSnapshot().state === 'running') return 'closed'
    if (needsPPtoMain) {
      console.info('[ABB-PROGRAM] PP 无法映射，需先 PP to Main')
      return 'closed'
    }
    if (offPath) {
      pendingClear.value = 'step'
      sync()
      console.info('[ABB-PROGRAM] 偏离路径，等待从当前位置规划到下一目标的确认')
      return 'closed'
    }
    return 'step'
  }

  function run(): void {
    if (gateRunRequest() === 'closed') return
    console.info('[ABB-PROGRAM] 运行请求')
    beginExecution((exec) => exec.run())
  }

  function step(): void {
    if (gateStepRequest() === 'closed') return
    console.info('[ABB-PROGRAM] 单步请求')
    beginExecution((exec) => exec.step())
  }

  /** off-path 确认为 ABB Clear：从当前位置规划到下一目标，随后按原请求模式执行。 */
  function confirmClearToNext(): void {
    const mode = pendingClear.value
    if (!mode) return
    pendingClear.value = null
    // 已接受从当前位置规划到下一目标，清除偏离路径标记。
    offPath = false
    sync()
    if (mode === 'run') run()
    else step()
  }

  function cancelClearToNext(): void {
    pendingClear.value = null
    sync()
  }

  /** 在活动程序时发出停止请求：只委托一次并记录；终止由执行链微任务结算。 */
  function requestStop(): void {
    executor.stop()
    console.info('[ABB-PROGRAM] 停止请求')
    window.setTimeout(sync, 0)
  }

  /** 用户点击停止：仅终止活动程序，不标记偏离路径（停止本身不是 Jog）。 */
  function stop(): void {
    if (executor.getSnapshot().state === 'running') requestStop()
  }

  /**
   * 手动命令入口统一先调用：终止活动程序，并在已有停止程序上下文时标记 off-path
   * （停止后机器人被手动 Jog）。初始空闲 Jog 不提示偏离。
   */
  function stopActiveProgram(): void {
    const stateBeforeManualMotion = executor.getSnapshot().state
    stop()
    // 运行中被手动抢占或已有 stopped 上下文才表示偏离程序路径；completed/error 不再伪造路径事实。
    if (stateBeforeManualMotion === 'running' || stateBeforeManualMotion === 'stopped')
      offPath = true
    sync()
  }

  function ppToMain(): void {
    if (executor.getSnapshot().state === 'running') return
    needsPPtoMain = false
    pendingEdit = null
    trackedPP = null
    // 复位教学防死循环计数器与 FOR 游标，开始全新的执行会话。
    loopSteps = 0
    forCursors.clear()
    // 用最新源码重建执行器并复位到 main；不清零机器人、不伪装已回到原路径。
    const runtimeValues = logicContextDirty ? new Map() : executor.getSnapshot().variables
    if (parsed.value.canExecute) {
      loadedProgram = parsed.value.program
      loadedLogicSignature = rapidLogicSignature(parsed.value)
    } else {
      loadedLogicSignature = null
    }
    executor = createProgramExecutor(
      loadedProgram,
      seam,
      0,
      runtimeVariablesForParsed(parsed.value, runtimeValues),
    )
    executor.ppToMain()
    logicContextDirty = false
    sync()
    stopPolling()
    console.info('[ABB-PROGRAM] PP to Main')
  }

  /** 唯一受控编辑入口：委托 RAPID 层执行单条命令；成功更新源码，失败保持源码不变。 */
  function applyEdit(command: RapidEditCommand): RapidEditResult {
    if (executor.getSnapshot().state === 'running') {
      return { ok: false, error: { code: 'source-error', message: '程序运行期间禁止编辑源码' } }
    }
    const previousSource = options.source.value
    const result = applyRapidEdit(previousSource, command)
    if (result.ok) {
      pendingEdit = result.result
      options.source.value = result.result.source
      // 成功的受控编辑入撤销栈并清空重做栈（FlexPendant：新编辑使 redo 失效）。
      undoStack.push({ source: previousSource })
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
      redoStack.length = 0
      updateHistoryFlags()
    }
    return result
  }

  /** 撤销最近一次受控编辑：恢复整份源码，PP 走自由编辑的唯一映射规则（失败则 PP to Main）。 */
  function undo(): void {
    if (executor.getSnapshot().state === 'running') return
    const entry = undoStack.pop()
    if (!entry) return
    redoStack.push({ source: options.source.value })
    pendingEdit = null
    trackedPP = null
    applyingHistory = true
    options.source.value = entry.source
    updateHistoryFlags()
    console.info('[ABB-PROGRAM] 撤销一次受控编辑')
  }

  function redo(): void {
    if (executor.getSnapshot().state === 'running') return
    const entry = redoStack.pop()
    if (!entry) return
    undoStack.push({ source: options.source.value })
    pendingEdit = null
    trackedPP = null
    applyingHistory = true
    options.source.value = entry.source
    updateHistoryFlags()
    console.info('[ABB-PROGRAM] 重做一次受控编辑')
  }

  /** 源码变化后把已停止程序的旧 PP 映射到新解析结果；无法唯一映射则要求 PP to Main。 */
  function reconcileProgramAfterSourceChange(): void {
    // 历史驱动（undo/redo）与受控编辑之外的源码变化 = 自由文本编辑/预设加载：清空编辑历史。
    const historyDriven = applyingHistory
    applyingHistory = false
    if (!historyDriven && pendingEdit === null) clearEditHistory()
    const base = executor.getSnapshot()
    // 运行中不重映射；无已加载程序的空闲态只需同步诊断，并消费不应跨越空闲周期的受控编辑标记。
    // 注意：停止态结构化编辑重建执行器后状态回到 idle 但 PP/loadedProgram 仍有效，
    // 这种 idle 必须继续走下面的 PP 映射，否则连续两次结构化编辑会丢失折算。
    if (base.state === 'running') return
    if (base.state === 'idle' && loadedProgram.length === 0) {
      pendingEdit = null
      trackedPP = null
      sync()
      return
    }
    const oldProgram = loadedProgram
    const oldIndex = base.programPointer
    if (oldProgram.length === 0) return
    const next = parsed.value
    if (pendingEdit && options.source.value !== pendingEdit.source) pendingEdit = null
    if (needsPPtoMain) {
      sync()
      return
    }
    const isStructuredEdit = pendingEdit !== null
    if (
      !isStructuredEdit &&
      loadedLogicSignature !== null &&
      rapidLogicSignature(next) !== loadedLogicSignature
    ) {
      needsPPtoMain = true
      logicContextDirty = true
      pendingEdit = null
      trackedPP = null
      console.info('[ABB-PROGRAM] 逻辑源码已变化，需 PP to Main 重建变量上下文')
      sync()
      return
    }
    // 结构化编辑按命令携带的 remap 精确折算 PP；自由编辑保守校验下标处指令是否仍一致。
    let mapTo: number | null = null
    if (isStructuredEdit) {
      const edit = pendingEdit as NonNullable<typeof pendingEdit>
      pendingEdit = null
      // 挂起期间基准是 trackedPP（`*` 占位程序的折算下标），否则是执行器当前 PP。
      const baseIndex = trackedPP ?? oldIndex
      if (edit.programTextChangedAt !== undefined && edit.programTextChangedAt === baseIndex) {
        // PP 指向的指令文本被改写（参数/运动类型变更）：无法证明等价，要求 PP to Main。
        trackedPP = null
      } else {
        let mapped = baseIndex
        const removed = edit.programRemap?.removed ?? []
        const removedHit = removed.includes(mapped)
        if (!removedHit) {
          mapped -= removed.filter((removedIndex) => removedIndex < mapped).length
          const inserted = edit.programRemap?.inserted
          if (inserted && mapped >= inserted.at) mapped += inserted.count
        }
        if (removedHit) {
          // PP 指向的指令被删除/注释 → 要求 PP to Main。
          trackedPP = null
        } else if (next.canExecute && mapped < next.program.length) {
          mapTo = mapped
          trackedPP = null
        } else if (!next.canExecute) {
          // 程序带 `*` 占位暂不可执行：挂起 PP，补全目标点后的下一次编辑再继续映射。
          trackedPP = mapped
          sync()
          return
        } else {
          trackedPP = null
        }
      }
    } else {
      trackedPP = null
      if (next.canExecute && next.program.length > 0) {
        const oldSourceText = oldProgram[oldIndex]?.sourceText
        const candidates = oldSourceText
          ? next.program
              .map((instruction, index) => (instruction.sourceText === oldSourceText ? index : -1))
              .filter((index) => index >= 0)
          : []
        // 自由编辑只能在唯一候选时保留 PP；重复相同指令无法证明是哪一条，必须 PP to Main。
        if (candidates.length === 1) mapTo = candidates[0]
      }
    }
    if (mapTo === null) {
      // 新源码不可执行、或无法唯一映射到新指令 → 要求 PP to Main。
      needsPPtoMain = true
      console.info('[ABB-PROGRAM] 停止态源码无法唯一映射 PP，需 PP to Main')
    } else {
      // 重建执行器并在原 PP 继续。
      loadedProgram = next.program
      loadedLogicSignature = rapidLogicSignature(next)
      executor = createProgramExecutor(
        next.program,
        seam,
        mapTo,
        runtimeVariablesForParsed(next, base.variables),
      )
    }
    sync()
  }

  // 源程序变化（受控编辑或手工输入）后重映射 PP。
  watch(parsed, () => {
    reconcileProgramAfterSourceChange()
  })

  onBeforeUnmount(stopPolling)

  return {
    snapshot,
    parsed,
    run,
    step,
    stop,
    ppToMain,
    applyEdit,
    undo,
    redo,
    canUndo,
    canRedo,
    stopActiveProgram,
    confirmClearToNext,
    cancelClearToNext,
    pendingClear,
  }
}
