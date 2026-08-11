import { onBeforeUnmount, ref, type Ref } from 'vue'
import type { MotionResult } from '../robotics/motion-runner.ts'
import type { RobotProfile } from '../robotics/robot-profile.ts'
import type { JointAngles } from '../robotics/types.ts'
import { executeMoveJ } from '../rapid/movej-planner.ts'
import { executeMoveL } from '../rapid/movel-planner.ts'
import type { StructuredMotionInstruction } from '../rapid/rapid-types.ts'
import {
  parseRapidProgram,
  type RapidDiagnostic,
  type RapidExecutableInstruction,
  type RapidSourceRange,
} from '../rapid/rapid-parser.ts'
import {
  createProgramExecutor,
  type InstructionOutcome,
  type ProgramError,
  type ProgramExecutionSeam,
  type ProgramSnapshot,
} from '../rapid/program-executor.ts'

/** 程序控制器可用的 MotionRunner 能力子集（由现有 useMotion 提供）。 */
export interface ProgramControllerMotion {
  startEasedAnimation: (target: JointAngles, duration?: number) => Promise<MotionResult>
  startCartesianTrajectory: (
    waypoints: readonly JointAngles[],
    duration?: number,
  ) => Promise<MotionResult>
  stopAnimation: () => void
  pauseMotion: () => void
  resumeMotion: () => void
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
}

export interface ProgramController {
  snapshot: Ref<ProgramControllerSnapshot>
  run: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  reset: () => void
  /** 手动关节/笛卡尔命令前调用：程序活动时先终止，避免争用同一 MotionRunner。 */
  stopActiveProgram: () => void
}

/**
 * 页面端程序控制器：把 Vue 无关的 ProgramExecutor 接到现有 MotionRunner、ABB 模型
 * 与共享 joints 状态上。只负责构造程序、发出控制命令与同步快照，不新增动画循环、
 * IK、路径规划或通用 store。
 */
export function useProgramController(options: ProgramControllerOptions): ProgramController {
  async function execute(instruction: StructuredMotionInstruction): Promise<InstructionOutcome> {
    if (instruction.kind === 'movej') {
      return executeMoveJ(instruction, {
        model: options.profile.model,
        currentJoints: () => [...options.joints.value],
        jointRanges: options.profile.jointRanges,
        runEased: (target, durationMs) => options.motion.startEasedAnimation(target, durationMs),
      })
    }
    return executeMoveL(instruction, {
      model: options.profile.model,
      currentJoints: () => [...options.joints.value],
      jointRanges: options.profile.jointRanges,
      runTrajectory: (waypoints, durationMs) =>
        options.motion.startCartesianTrajectory(waypoints, durationMs),
    })
  }

  const seam: ProgramExecutionSeam = {
    execute,
    pause: () => options.motion.pauseMotion(),
    resume: () => options.motion.resumeMotion(),
    stop: () => options.motion.stopAnimation(),
  }
  let executor = createProgramExecutor([], seam)
  let loadedProgram: readonly RapidExecutableInstruction[] = []
  let diagnostics: readonly RapidDiagnostic[] = []
  const snapshot = ref<ProgramControllerSnapshot>(createSnapshot())
  let pollTimer: number | null = null

  function createSnapshot(): ProgramControllerSnapshot {
    const base = executor.getSnapshot()
    const sourceRange = base.error ? loadedProgram[base.error.index]?.sourceRange : undefined
    return {
      ...base,
      error: base.error ? { ...base.error, sourceRange } : null,
      diagnostics,
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
      if (state !== 'running' && state !== 'paused') stopPolling()
    }, 100)
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function run(): void {
    // 仅从 idle 启动；按钮可用性会限制，这里仍做防御。
    if (executor.getSnapshot().state !== 'idle') return
    const parsed = parseRapidProgram(options.source.value)
    diagnostics = parsed.diagnostics
    if (!parsed.canExecute) {
      loadedProgram = []
      snapshot.value = { ...createSnapshot(), state: 'error', error: null }
      console.warn('[ABB-PROGRAM] RAPID 源程序诊断阻止运行', parsed.diagnostics.length)
      return
    }

    loadedProgram = parsed.program
    diagnostics = []
    executor = createProgramExecutor(loadedProgram, seam)
    console.info('[ABB-PROGRAM] 程序开始')
    const promise = executor.run()
    sync()
    startPolling()
    // 程序终止后再同步一次快照、停止轮询并记录终止事件。
    void promise.then((final) => {
      if (final === 'completed') {
        console.info('[ABB-PROGRAM] 程序完成')
      } else if (final === 'stopped') {
        console.info('[ABB-PROGRAM] 程序停止')
      } else if (final === 'error') {
        console.error('[ABB-PROGRAM] 程序规划错误', executor.getSnapshot().error?.message)
      }
      sync()
      stopPolling()
    })
  }

  function pause(): void {
    executor.pause()
    sync()
    console.info('[ABB-PROGRAM] 暂停')
  }

  function resume(): void {
    executor.resume()
    sync()
    console.info('[ABB-PROGRAM] 继续')
  }

  /** 在活动程序时发出停止请求：只委托一次并记录；终止由执行链微任务结算。 */
  function requestStop(): void {
    executor.stop()
    console.info('[ABB-PROGRAM] 停止请求')
    // 终止由执行链在微任务中结算，用一次宏任务刷新快照以反映 stopped。
    window.setTimeout(sync, 0)
  }

  function stop(): void {
    stopActiveProgram()
  }

  function reset(): void {
    executor.reset()
    loadedProgram = []
    diagnostics = []
    sync()
    stopPolling()
  }

  function stopActiveProgram(): void {
    const state = executor.getSnapshot().state
    if (state === 'running' || state === 'paused') requestStop()
  }

  onBeforeUnmount(stopPolling)

  return { snapshot, run, pause, resume, stop, reset, stopActiveProgram }
}
