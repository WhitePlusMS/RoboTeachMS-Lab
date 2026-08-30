import type { MotionPlanningRequest } from '@/robot-motion-core/index.ts'
import type {
  RapidExecutableInstruction,
  RapidAssignmentInstruction,
  RapidForInstruction,
  RapidScalarExpression,
  RapidWhileInstruction,
} from '../language/index.ts'
import type { RapidScalarVariable, SingAreaMode } from '../data/index.ts'
import { executeRapidMotion } from '../execution/motion-execution.ts'
import {
  createProgramExecutor,
  type InstructionOutcome,
  type ProgramExecutionContext,
  type ProgramExecutor,
  type ProgramExecutionSeam,
} from '../execution/program-executor.ts'
import { evaluateScalarExpression } from './scalar-evaluation.ts'

/** RAPID 运行时与宿主之间唯一的运动提交 seam。 */
export interface RapidMotionPort {
  currentJoints: () => readonly [number, number, number, number, number, number]
  submit: (
    request: MotionPlanningRequest,
    playback: 'eased' | 'trajectory',
  ) => Promise<InstructionOutcome>
  stop: () => void
}

export interface RapidRuntime {
  /** 装载一份结构化程序并创建新的执行器；装载即重置模式与循环游标。 */
  load: (
    instructions: readonly RapidExecutableInstruction[],
    initialPointer?: number,
    initialVariables?: ReadonlyMap<string, RapidScalarVariable>,
  ) => ProgramExecutor
}

function attachBranchNextPointer(
  instruction: RapidExecutableInstruction,
  outcome: InstructionOutcome,
): InstructionOutcome {
  if (
    !outcome.ok ||
    outcome.result !== 'completed' ||
    !('nextPointer' in instruction) ||
    instruction.nextPointer === undefined
  ) return outcome
  return { ...outcome, nextPointer: instruction.nextPointer }
}

const MAX_LOOP_STEPS = 10000

interface ForCursor {
  initialized: boolean
  current: number
  end: number
  step: number
}

export function createRapidRuntime(port: RapidMotionPort): RapidRuntime {
  let singAreaMode: SingAreaMode = 'off'
  let confJMode: 'on' | 'off' = 'on'
  let confLMode: 'on' | 'off' = 'on'
  let loopSteps = 0
  let loadedProgram: readonly RapidExecutableInstruction[] = []
  let forCursors = new Map<RapidForInstruction, ForCursor>()

  function consumeLoopStep(): InstructionOutcome | null {
    loopSteps += 1
    return loopSteps > MAX_LOOP_STEPS
      ? { ok: false, error: { kind: 'runtime-error', message: `循环迭代次数超过安全上限 ${MAX_LOOP_STEPS}` } }
      : null
  }

  function clearForCursorByExitTarget(target: number): void {
    for (const instruction of loadedProgram) {
      if (instruction.kind === 'for' && instruction.falseTarget === target) forCursors.delete(instruction)
    }
  }

  function executeAssignment(
    instruction: RapidAssignmentInstruction,
    context: ProgramExecutionContext,
  ): InstructionOutcome {
    const result = evaluateScalarExpression(instruction.expression, context)
    if (!result.ok) return { ok: false, error: { kind: 'runtime-error', message: result.message } }
    if (!context.writeVariable(instruction.target.name, result.value)) {
      return { ok: false, error: { kind: 'runtime-error', message: `无法写入变量 ${instruction.target.name}` } }
    }
    return {
      ok: true,
      result: 'completed',
      ...(instruction.nextPointer === undefined ? {} : { nextPointer: instruction.nextPointer }),
    }
  }

  function evaluateNumExpr(
    expression: RapidScalarExpression,
    context: ProgramExecutionContext,
    what: string,
  ): { ok: true; value: number } | { ok: false; outcome: InstructionOutcome } {
    const result = evaluateScalarExpression(expression, context)
    if (!result.ok) return { ok: false, outcome: { ok: false, error: { kind: 'runtime-error', message: result.message } } }
    if (typeof result.value !== 'number' || !Number.isFinite(result.value)) {
      return { ok: false, outcome: { ok: false, error: { kind: 'runtime-error', message: `${what} 必须是有限数值` } } }
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
    return evaluated.ok ? evaluated.value : evaluated.outcome
  }

  function executeFor(instruction: RapidForInstruction, context: ProgramExecutionContext): InstructionOutcome {
    const over = consumeLoopStep()
    if (over) return over
    let cursor = forCursors.get(instruction)
    if (!cursor) {
      cursor = { initialized: false, current: 0, end: 0, step: 1 }
      forCursors.set(instruction, cursor)
    }
    if (!cursor.initialized) {
      const from = evaluateNumExpr(instruction.fromExpr, context, 'FOR 起始值')
      if (!from.ok) return from.outcome
      const to = evaluateNumExpr(instruction.toExpr, context, 'FOR 终止值')
      if (!to.ok) return to.outcome
      const step = readForBound(instruction.stepExpr, 1, context, 'FOR 步长')
      if (typeof step !== 'number') return step
      if (step === 0) {
        forCursors.delete(instruction)
        return { ok: true, result: 'completed', nextPointer: instruction.falseTarget }
      }
      cursor.initialized = true
      cursor.current = from.value
      cursor.end = to.value
      cursor.step = step
    } else cursor.current += cursor.step
    const finished = cursor.step > 0 ? cursor.current > cursor.end : cursor.current < cursor.end
    if (finished) {
      forCursors.delete(instruction)
      return { ok: true, result: 'completed', nextPointer: instruction.falseTarget }
    }
    if (!context.writeVariable(instruction.loopVar.name, cursor.current)) {
      return { ok: false, error: { kind: 'runtime-error', message: `无法写入循环变量 ${instruction.loopVar.name}` } }
    }
    return { ok: true, result: 'completed', nextPointer: instruction.trueTarget }
  }

  function executeWhile(instruction: RapidWhileInstruction, context: ProgramExecutionContext): InstructionOutcome {
    const over = consumeLoopStep()
    if (over) return over
    const result = evaluateScalarExpression(instruction.condition, context)
    if (!result.ok) return { ok: false, error: { kind: 'runtime-error', message: result.message } }
    if (typeof result.value !== 'boolean') return { ok: false, error: { kind: 'runtime-error', message: 'WHILE 条件必须是 bool' } }
    return { ok: true, result: 'completed', nextPointer: result.value ? instruction.trueTarget : instruction.falseTarget }
  }

  function load(
    instructions: readonly RapidExecutableInstruction[],
    initialPointer = 0,
    initialVariables: ReadonlyMap<string, RapidScalarVariable> = new Map(),
  ): ProgramExecutor {
    loadedProgram = instructions
    loopSteps = 0
    forCursors = new Map()
    singAreaMode = 'off'
    confJMode = 'on'
    confLMode = 'on'

    const execute = async (
      instruction: RapidExecutableInstruction,
      context: ProgramExecutionContext,
    ): Promise<InstructionOutcome> => {
      if (instruction.kind === 'if') {
        const result = evaluateScalarExpression(instruction.condition, context)
        if (!result.ok) return { ok: false, error: { kind: 'runtime-error', message: result.message } }
        if (typeof result.value !== 'boolean') return { ok: false, error: { kind: 'runtime-error', message: 'IF 条件必须是 bool' } }
        return { ok: true, result: 'completed', nextPointer: result.value ? instruction.trueTarget : instruction.falseTarget }
      }
      if (instruction.kind === 'while') return executeWhile(instruction, context)
      if (instruction.kind === 'for') return executeFor(instruction, context)
      if (instruction.kind === 'exitdo') {
        clearForCursorByExitTarget(instruction.target)
        return { ok: true, result: 'completed', nextPointer: instruction.target }
      }
      if (instruction.kind === 'singarea') {
        singAreaMode = instruction.mode
        return attachBranchNextPointer(instruction, { ok: true, result: 'completed' })
      }
      if (instruction.kind === 'confj' || instruction.kind === 'confl') {
        if (instruction.kind === 'confj') confJMode = instruction.mode
        else confLMode = instruction.mode
        return attachBranchNextPointer(instruction, { ok: true, result: 'completed' })
      }
      if (instruction.kind === 'movej' || instruction.kind === 'movel' || instruction.kind === 'movec') {
        const motion = {
          ...instruction,
          ...(instruction.kind === 'movej' ? { confJ: confJMode } : { confL: confLMode }),
        }
        const outcome = await executeRapidMotion(motion, singAreaMode, {
          currentJoints: () => [...port.currentJoints()],
          submit: port.submit,
        })
        return attachBranchNextPointer(instruction, outcome)
      }
      if (instruction.kind === 'assign') return executeAssignment(instruction, context)
      return { ok: false, error: { kind: 'runtime-error', message: `不支持的 RAPID 指令 ${instruction.kind}` } }
    }
    const seam: ProgramExecutionSeam<RapidExecutableInstruction> = { execute, stop: port.stop }
    return createProgramExecutor(instructions, seam, initialPointer, initialVariables)
  }

  return { load }
}
