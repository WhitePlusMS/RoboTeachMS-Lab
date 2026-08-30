import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { MotionPlanningRequest } from '@/robot-motion-core/index.ts'
import type { JointAngles } from '@/robot-geometry/model/index.ts'
import type { RobotProfile } from '@/robot-geometry/model/robot-profile.ts'
import { isRapidMotionInstruction, parseRapidProgram, type RapidDiagnostic, type RapidExecutableInstruction, type RapidParseResult, type RapidSourceRange } from '@/rapid/language/index.ts'
import type { RapidScalarVariable } from '@/rapid/data/index.ts'
import { applyRapidEdit, type RapidEditCommand, type RapidEditResult, type RapidEditSuccess } from '@/rapid/editing/index.ts'
import { createRapidRuntime } from '@/rapid/runtime/index.ts'
import type { InstructionOutcome, ProgramError, ProgramExecutor, ProgramSnapshot } from '@/rapid/execution/index.ts'

/** 程序控制器唯一的运动提交 seam；宿主负责把 request 交给 MotionCoordinator。 */
export interface ProgramControllerMotion {
  submitMotion: (
    request: MotionPlanningRequest,
    playback: 'eased' | 'trajectory',
  ) => Promise<InstructionOutcome>
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
  needsPPtoMain: boolean
  offPath: boolean
}

export interface ProgramController {
  snapshot: Ref<ProgramControllerSnapshot>
  parsed: Ref<RapidParseResult>
  run: () => void
  step: () => void
  stop: () => void
  ppToMain: () => void
  applyEdit: (command: RapidEditCommand) => RapidEditResult
  undo: () => void
  redo: () => void
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
  stopActiveProgram: () => void
  confirmClearToNext: () => void
  cancelClearToNext: () => void
  pendingClear: Ref<'run' | 'step' | null>
}

function normalizeVariableName(name: string): string {
  return name.toLocaleLowerCase('en-US')
}

/** 从当前解析结果生成 runtime 初始值；已有同名同类型运行值优先保留。 */
function runtimeVariablesForParsed(
  parsed: RapidParseResult,
  previous: ReadonlyMap<string, RapidScalarVariable> = new Map(),
): Map<string, RapidScalarVariable> {
  const variables = new Map<string, RapidScalarVariable>()
  for (const entry of parsed.data) {
    if ((entry.kind !== 'num' && entry.kind !== 'bool') || entry.storage !== 'var') continue
    const key = normalizeVariableName(entry.name)
    const old = previous.get(key)
    if (old && old.kind === entry.kind) variables.set(key, { ...old })
    else if (entry.kind === 'num') variables.set(key, { kind: 'num', value: entry.value })
    else variables.set(key, { kind: 'bool', value: entry.value })
  }
  return variables
}

/** 只把会改变运行逻辑的源码纳入签名，点位编辑仍可保留 PP。 */
function rapidLogicSignature(parsed: RapidParseResult): string {
  const scalarDeclarations = parsed.data
    .filter((entry) => !entry.system && (entry.kind === 'num' || entry.kind === 'bool'))
    .map((entry) => {
      const value = entry.kind === 'num' || entry.kind === 'bool' ? entry.value : ''
      return `${entry.kind}|${normalizeVariableName(entry.name)}|${entry.storage}|${String(value)}`
    })
  const statements = parsed.program.map((instruction) => {
    if (instruction.kind === 'assign') return `assign|${instruction.sourceText}`
    if (instruction.kind === 'singarea') return `singarea|${instruction.mode}`
    if (instruction.kind === 'confj' || instruction.kind === 'confl') return `${instruction.kind}|${instruction.mode}`
    if (instruction.kind === 'if') return `if|${instruction.conditionKind}|${instruction.sourceText}`
    if (instruction.kind === 'while') return `while|${instruction.sourceText}`
    if (instruction.kind === 'for') return `for|${instruction.sourceText}`
    if (instruction.kind === 'exitdo') return `exitdo|${instruction.sourceText}`
    return `motion|${instruction.kind}`
  })
  return `${scalarDeclarations.join('\n')}\n---\n${statements.join('\n')}`
}

function describeProgramError(
  error: ProgramError,
  program: readonly RapidExecutableInstruction[],
): {
  summary: string
  instructionNumber: number
  instructionIndex: number
  sourceLine: number | null
  sourceColumn: number | null
  instructionText: string | null
  errorCode: ProgramError['code']
  errorMessage: string
  diagnostic: {
    waypointIndex: number | null
    axis: string | null
    axisIndex: number | null
    previousAngleDeg: number | null
    attemptedAngleDeg: number | null
    deltaDeg: number | null
    limitRangeDeg: readonly [number, number] | null
  } | null
} {
  const instruction = program[error.index]
  const diagnostic = error.diagnostic
    ? {
        waypointIndex: error.diagnostic.waypointIndex ?? null,
        axis: error.diagnostic.axisIndex === undefined ? null : `J${error.diagnostic.axisIndex + 1}`,
        axisIndex: error.diagnostic.axisIndex ?? null,
        previousAngleDeg: error.diagnostic.previousAngleDeg ?? null,
        attemptedAngleDeg: error.diagnostic.attemptedAngleDeg ?? null,
        deltaDeg: error.diagnostic.deltaDeg ?? null,
        limitRangeDeg: error.diagnostic.limitRangeDeg ?? null,
      }
    : null
  const sourceLine = instruction?.sourceRange.start.line ?? null
  const sourceColumn = instruction?.sourceRange.start.column ?? null
  const location = sourceLine === null
    ? `程序指令 #${error.index + 1}`
    : `程序指令 #${error.index + 1}（第 ${sourceLine} 行，第 ${sourceColumn} 列）`
  const detail = diagnostic
    ? [
        diagnostic.waypointIndex === null ? null : `waypoint #${diagnostic.waypointIndex}`,
        diagnostic.axis === null ? null : `失败轴 ${diagnostic.axis}`,
        diagnostic.previousAngleDeg === null ? null : `前值 ${diagnostic.previousAngleDeg.toFixed(3)}°`,
        diagnostic.attemptedAngleDeg === null ? null : `尝试值 ${diagnostic.attemptedAngleDeg.toFixed(3)}°`,
        diagnostic.deltaDeg === null ? null : `步长 ${diagnostic.deltaDeg.toFixed(3)}°`,
        diagnostic.limitRangeDeg === null ? null : `限位 [${diagnostic.limitRangeDeg[0]}°, ${diagnostic.limitRangeDeg[1]}°]`,
      ].filter((part): part is string => part !== null).join('，')
    : '规划器未提供关节级诊断（可能在起点正解、输入校验或全局候选筛选阶段失败）'
  return {
    summary: `${location}：${error.message}；错误码 ${error.code}；${detail}`,
    instructionNumber: error.index + 1,
    instructionIndex: error.index,
    sourceLine,
    sourceColumn,
    instructionText: instruction?.sourceText ?? null,
    errorCode: error.code,
    errorMessage: error.message,
    diagnostic,
  }
}

export function useProgramController(options: ProgramControllerOptions): ProgramController {
  const runtime = createRapidRuntime({
    currentJoints: () => [...options.joints.value] as MotionPlanningRequest['state']['jointsDeg'],
    submit: options.motion.submitMotion,
    stop: options.motion.stopAnimation,
  })
  const parsed = computed(() => parseRapidProgram(options.source.value))
  const snapshot = ref<ProgramControllerSnapshot>({
    state: 'idle',
    programPointer: 0,
    motionPointer: null,
    stopReason: null,
    error: null,
    variables: new Map(),
    diagnostics: parsed.value.diagnostics,
    needsPPtoMain: false,
    offPath: false,
  })
  let executor: ProgramExecutor = runtime.load([])
  let loadedProgram: readonly RapidExecutableInstruction[] = []
  let loadedLogicSignature: string | null = null
  let logicContextDirty = false
  let offPath = false
  let needsPPtoMain = false
  let pendingEdit: RapidEditSuccess | null = null
  let trackedPP: number | null = null
  const undoStack: Array<{ source: string }> = []
  const redoStack: Array<{ source: string }> = []
  const canUndo = ref(false)
  const canRedo = ref(false)
  const pendingClear = ref<'run' | 'step' | null>(null)
  let applyingHistory = false
  let pollTimer: number | null = null
  const HISTORY_LIMIT = 3

  const sync = (): void => {
    const base = executor.getSnapshot()
    const sourceRange = base.error ? loadedProgram[base.error.index]?.sourceRange : undefined
    snapshot.value = {
      ...base,
      error: base.error ? { ...base.error, sourceRange } : null,
      diagnostics: parsed.value.diagnostics,
      needsPPtoMain,
      offPath,
    }
  }
  const updateHistoryFlags = (): void => {
    canUndo.value = undoStack.length > 0
    canRedo.value = redoStack.length > 0
  }
  const clearEditHistory = (): void => {
    undoStack.length = 0
    redoStack.length = 0
    updateHistoryFlags()
  }
  const startPolling = (): void => {
    if (pollTimer !== null) return
    pollTimer = window.setInterval(() => {
      sync()
      if (snapshot.value.state !== 'running') stopPolling()
    }, 100)
  }
  const stopPolling = (): void => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer)
      pollTimer = null
    }
  }
  const findUnsupportedZone = (program: readonly RapidExecutableInstruction[]): number | null => {
    const index = program.findIndex((instruction) => isRapidMotionInstruction(instruction) && instruction.zone.finep !== true)
    return index >= 0 ? index : null
  }

  function beginExecution(start: (exec: ProgramExecutor) => Promise<ProgramSnapshot['state']>): void {
    if (executor.getSnapshot().state === 'idle') {
      const result = parsed.value
      if (!result.canExecute) {
        loadedProgram = []
        loadedLogicSignature = null
        logicContextDirty = false
        snapshot.value = { ...snapshot.value, state: 'error', error: null, diagnostics: result.diagnostics }
        console.warn('[ABB-PROGRAM] RAPID 源程序诊断阻止执行', result.diagnostics.length)
        return
      }
      loadedProgram = result.program
      const unsupportedZoneIndex = findUnsupportedZone(loadedProgram)
      if (unsupportedZoneIndex !== null) {
        loadedLogicSignature = rapidLogicSignature(result)
        logicContextDirty = false
        snapshot.value = {
          ...snapshot.value,
          state: 'error',
          error: {
            index: unsupportedZoneIndex,
            code: 'unsupported-option',
            message: '程序包含尚未支持的 fly-by zone，执行前已拒绝。',
            sourceRange: loadedProgram[unsupportedZoneIndex]?.sourceRange,
          },
        }
        console.warn('[ABB-PROGRAM] 非 fine zone 在启动前被拒绝', unsupportedZoneIndex + 1)
        return
      }
      loadedLogicSignature = rapidLogicSignature(result)
      logicContextDirty = false
      executor = runtime.load(loadedProgram, 0, runtimeVariablesForParsed(result))
    }
    const promise = start(executor)
    sync()
    startPolling()
    void promise.then((final) => {
      if (final === 'completed') console.info('[ABB-PROGRAM] 程序完成/单步完成')
      else if (final === 'stopped') console.info('[ABB-PROGRAM] 程序停止或等待下一步')
      else if (final === 'error') {
        const error = executor.getSnapshot().error
        if (error) console.error('[ABB-PROGRAM] 程序规划错误', describeProgramError(error, loadedProgram))
      }
      sync()
      stopPolling()
    })
  }

  function gate(mode: 'run' | 'step'): boolean {
    if (executor.getSnapshot().state === 'running' || needsPPtoMain) return false
    if (offPath) {
      pendingClear.value = mode
      sync()
      console.info('[ABB-PROGRAM] 偏离路径，等待从当前位置规划到下一目标的确认')
      return false
    }
    return true
  }
  const run = (): void => {
    if (!gate('run')) return
    console.info('[ABB-PROGRAM] 运行请求')
    beginExecution((exec) => exec.run())
  }
  const step = (): void => {
    if (!gate('step')) return
    console.info('[ABB-PROGRAM] 单步请求')
    beginExecution((exec) => exec.step())
  }
  const requestStop = (): void => {
    executor.stop()
    console.info('[ABB-PROGRAM] 停止请求')
    window.setTimeout(sync, 0)
  }
  const stop = (): void => {
    if (executor.getSnapshot().state === 'running') requestStop()
  }
  const stopActiveProgram = (): void => {
    const stateBefore = executor.getSnapshot().state
    stop()
    if (stateBefore === 'running' || stateBefore === 'stopped') offPath = true
    sync()
  }
  const ppToMain = (): void => {
    if (executor.getSnapshot().state === 'running') return
    needsPPtoMain = false
    pendingEdit = null
    trackedPP = null
    const runtimeValues = logicContextDirty ? new Map<string, RapidScalarVariable>() : executor.getSnapshot().variables
    const result = parsed.value
    loadedProgram = result.canExecute ? result.program : []
    loadedLogicSignature = result.canExecute ? rapidLogicSignature(result) : null
    executor = runtime.load(loadedProgram, 0, runtimeVariablesForParsed(result, runtimeValues))
    logicContextDirty = false
    sync()
    stopPolling()
    console.info('[ABB-PROGRAM] PP to Main')
  }
  const confirmClearToNext = (): void => {
    const mode = pendingClear.value
    if (!mode) return
    pendingClear.value = null
    offPath = false
    sync()
    if (mode === 'run') run()
    else step()
  }
  const cancelClearToNext = (): void => {
    pendingClear.value = null
    sync()
  }
  const applyEdit = (command: RapidEditCommand): RapidEditResult => {
    if (executor.getSnapshot().state === 'running') return { ok: false, error: { code: 'source-error', message: '程序运行期间禁止编辑源码' } }
    const previousSource = options.source.value
    const result = applyRapidEdit(previousSource, command)
    if (result.ok) {
      pendingEdit = result.result
      options.source.value = result.result.source
      undoStack.push({ source: previousSource })
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
      redoStack.length = 0
      updateHistoryFlags()
    }
    return result
  }
  const undo = (): void => {
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
  const redo = (): void => {
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

  function reconcileProgramAfterSourceChange(): void {
    const historyDriven = applyingHistory
    applyingHistory = false
    if (!historyDriven && pendingEdit === null) clearEditHistory()
    const base = executor.getSnapshot()
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
    if (needsPPtoMain) { sync(); return }
    const isStructuredEdit = pendingEdit !== null
    if (!isStructuredEdit && loadedLogicSignature !== null && rapidLogicSignature(next) !== loadedLogicSignature) {
      needsPPtoMain = true
      logicContextDirty = true
      pendingEdit = null
      trackedPP = null
      console.info('[ABB-PROGRAM] 逻辑源码已变化，需 PP to Main 重建变量上下文')
      sync()
      return
    }
    let mapTo: number | null = null
    if (isStructuredEdit) {
      const edit = pendingEdit as RapidEditSuccess
      pendingEdit = null
      const baseIndex = trackedPP ?? oldIndex
      if (edit.programTextChangedAt !== undefined && edit.programTextChangedAt === baseIndex) trackedPP = null
      else {
        let mapped = baseIndex
        const removed = edit.programRemap?.removed ?? []
        const removedHit = removed.includes(mapped)
        if (!removedHit) {
          mapped -= removed.filter((index) => index < mapped).length
          const inserted = edit.programRemap?.inserted
          if (inserted && mapped >= inserted.at) mapped += inserted.count
        }
        if (removedHit) trackedPP = null
        else if (next.canExecute && mapped < next.program.length) { mapTo = mapped; trackedPP = null }
        else if (!next.canExecute) { trackedPP = mapped; sync(); return }
        else trackedPP = null
      }
    } else {
      trackedPP = null
      if (next.canExecute && next.program.length > 0) {
        const oldSourceText = oldProgram[oldIndex]?.sourceText
        const candidates = oldSourceText ? next.program.map((instruction, index) => instruction.sourceText === oldSourceText ? index : -1).filter((index) => index >= 0) : []
        if (candidates.length === 1) mapTo = candidates[0]
      }
    }
    if (mapTo === null) {
      needsPPtoMain = true
      console.info('[ABB-PROGRAM] 停止态源码无法唯一映射 PP，需 PP to Main')
    } else {
      loadedProgram = next.program
      loadedLogicSignature = rapidLogicSignature(next)
      executor = runtime.load(next.program, mapTo, runtimeVariablesForParsed(next, base.variables))
    }
    sync()
  }

  watch(parsed, reconcileProgramAfterSourceChange)
  onBeforeUnmount(stopPolling)
  return { snapshot, parsed, run, step, stop, ppToMain, applyEdit, undo, redo, canUndo, canRedo, stopActiveProgram, confirmClearToNext, cancelClearToNext, pendingClear }
}
