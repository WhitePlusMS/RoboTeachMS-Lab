import { onBeforeUnmount, ref, type Ref } from 'vue'
import type { MotionResult, MotionStatus } from '../core/robot/motion-runner'
import type { RobotModel } from '../core/robot/robot-model'
import type { JointAngles } from '../core/robot/types'
import type { StructuredMotionInstruction } from '../core/rapid/rapid-types'
import { executeMoveJ } from '../core/rapid/movej-planner'
import { executeMoveL } from '../core/rapid/movel-planner'
import {
  createProgramExecutor,
  type InstructionOutcome,
  type ProgramExecutionSeam,
  type ProgramSnapshot,
} from '../core/rapid/program-executor'

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
  getMotionStatus: () => MotionStatus
}

export interface ProgramControllerOptions {
  program: readonly StructuredMotionInstruction[]
  robotModel: Ref<RobotModel>
  joints: Ref<JointAngles>
  jointRanges: readonly (readonly [number, number])[]
  motion: ProgramControllerMotion
}

export interface ProgramController {
  snapshot: Ref<ProgramSnapshot>
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
        model: options.robotModel.value,
        currentJoints: () => [...options.joints.value],
        jointRanges: options.jointRanges,
        runEased: (target, durationMs) => options.motion.startEasedAnimation(target, durationMs),
      })
    }
    return executeMoveL(instruction, {
      model: options.robotModel.value,
      currentJoints: () => [...options.joints.value],
      jointRanges: options.jointRanges,
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
  const executor = createProgramExecutor([...options.program], seam)
  const snapshot = ref<ProgramSnapshot>(executor.getSnapshot())
  let pollTimer: number | null = null

  function sync(): void {
    snapshot.value = executor.getSnapshot()
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
    const promise = executor.run()
    sync()
    startPolling()
    // 程序终止后再同步一次快照并停止轮询。
    void promise.then(() => {
      sync()
      stopPolling()
    })
  }

  function pause(): void {
    executor.pause()
    sync()
  }

  function resume(): void {
    executor.resume()
    sync()
  }

  function stop(): void {
    executor.stop()
    // 终止由执行链在微任务中结算，用一次宏任务刷新快照以反映 stopped。
    window.setTimeout(sync, 0)
  }

  function reset(): void {
    executor.reset()
    sync()
    stopPolling()
  }

  function stopActiveProgram(): void {
    const state = executor.getSnapshot().state
    if (state === 'running' || state === 'paused') {
      executor.stop()
      window.setTimeout(sync, 0)
    }
  }

  onBeforeUnmount(stopPolling)

  return { snapshot, run, pause, resume, stop, reset, stopActiveProgram }
}
