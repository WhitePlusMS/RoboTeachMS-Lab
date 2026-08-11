import { DEFAULT_MOTION_CONFIG, easeInOutCubic, lerpJoints } from './motion-smoothing'
import type { JointAngles, MotionConfig } from './types'

/**
 * 运动状态：只有空闲、运行、暂停三种。它不是 RAPID 程序状态。
 */
export type MotionStatus = 'idle' | 'running' | 'paused'

/**
 * 一次运动执行终止时供上层等待的结果：仅到达终点的 completed 和提前终止的 stopped。
 * paused 不是终止结果；failed/replaced 不在结果集合内。
 */
export type MotionResult = 'completed' | 'stopped'

type MotionType = 'none' | 'joint-eased' | 'joint-speed' | 'joint-trajectory'

/**
 * 动画时钟接缝。
 *
 * 生产环境由浏览器 RAF adapter 实现，测试由手动时钟 adapter 实现；Motion Runner
 * 不感知 Vue、window 或 performance，完整生命周期可以通过同一个 interface 验证。
 */
export interface MotionClock {
  now: () => number
  requestFrame: (callback: () => void) => number
  cancelFrame: (frameId: number) => void
}

export interface MotionRunnerOptions {
  clock: MotionClock
  getCurrentJoints: () => JointAngles
  setJoints: (joints: JointAngles) => void
  motionConfig?: MotionConfig
}

/** 当前活动运动的终止 Promise 与结算句柄；同模式连续目标复用同一个实例。 */
interface ActiveMotion {
  promise: Promise<MotionResult>
  finish: (result: MotionResult) => void
}

export interface MotionRunner {
  startEased: (target: JointAngles, duration?: number) => Promise<MotionResult>
  startSpeedLimited: (target: JointAngles) => Promise<MotionResult>
  startTrajectory: (waypoints: readonly JointAngles[], duration?: number) => Promise<MotionResult>
  pause: () => void
  resume: () => void
  stop: () => void
  getStatus: () => MotionStatus
}

/**
 * 管理单一关节运动生命周期：模式切换、目标替换、时间推进、暂停和停止语义均封装在内部。
 * 同类目标会复用当前帧循环与未完成 Promise，避免连续输入造成 cancel/restart 卡顿；
 * 切换运动模式时旧运动解析为 stopped，并始终只存在一个待执行帧循环。
 */
export function createMotionRunner(options: MotionRunnerOptions): MotionRunner {
  const config = options.motionConfig ?? DEFAULT_MOTION_CONFIG
  let frameId: number | null = null
  let status: MotionStatus = 'idle'
  let activeType: MotionType = 'none'
  let targetJoints: JointAngles = [...options.getCurrentJoints()]
  let startJoints: JointAngles = [...targetJoints]
  let startTime = 0
  let lastTime: number | null = null
  let animationDuration = config.ikAnimDuration
  let trajectoryJoints: JointAngles[] = []
  // 暂停累计时长：暂停期间的流逝时间不参与缓动/轨迹进度计算。
  let totalPausedTime = 0
  let pausedAt: number | null = null
  let active: ActiveMotion | null = null

  function requestFrame(callback: () => void): void {
    frameId = options.clock.requestFrame(callback)
  }

  function cancelFrame(): void {
    if (frameId !== null) options.clock.cancelFrame(frameId)
    frameId = null
  }

  /** 不含暂停时长的有效流逝时间；只在帧推进中调用，此时 pausedAt 恒为 null。 */
  function effectiveElapsed(): number {
    return options.clock.now() - startTime - totalPausedTime
  }

  function createActiveMotion(): ActiveMotion {
    let resolve: (result: MotionResult) => void = () => {}
    const promise = new Promise<MotionResult>((res) => {
      resolve = res
    })
    const motion: ActiveMotion = { promise, finish: (result) => resolve(result) }
    active = motion
    return motion
  }

  function settleActive(result: MotionResult): void {
    if (!active) return
    const motion = active
    active = null
    motion.finish(result)
  }

  function clearRunState(): void {
    frameId = null
    lastTime = null
    totalPausedTime = 0
    pausedAt = null
  }

  /** 自然到达终点：结算 completed，回到 idle，不残留请求帧。 */
  function finishMotion(): void {
    cancelFrame()
    settleActive('completed')
    activeType = 'none'
    status = 'idle'
    clearRunState()
  }

  /** 切换到某个新的运动模式：结算旧运动为 stopped，开始新的 Promise 与帧循环。 */
  function beginMotion(type: MotionType, start: () => void): void {
    settleActive('stopped')
    cancelFrame()
    activeType = type
    createActiveMotion()
    status = 'running'
    lastTime = type === 'joint-speed' ? options.clock.now() : null
    totalPausedTime = 0
    pausedAt = null
    start()
  }

  function runEased(): void {
    const elapsed = effectiveElapsed()
    const progress = Math.min(Math.max(elapsed / animationDuration, 0), 1)
    options.setJoints(lerpJoints(startJoints, targetJoints, progress) as JointAngles)

    if (progress < 1) requestFrame(runEased)
    else finishMotion()
  }

  function runSpeedLimited(): void {
    const now = options.clock.now()
    const deltaTime = Math.max(now - (lastTime ?? now), 0)
    lastTime = now
    const current = options.getCurrentJoints()
    const maxStep = (config.jointSpeedLimit * deltaTime) / 1000
    const next = current.map((value, index) => {
      const difference = targetJoints[index] - value
      if (Math.abs(difference) < config.snapThreshold) return targetJoints[index]
      return value + Math.sign(difference) * Math.min(Math.abs(difference), maxStep)
    }) as JointAngles

    options.setJoints(next)
    const completed = next.every(
      (value, index) => Math.abs(value - targetJoints[index]) < config.snapThreshold,
    )
    if (completed) finishMotion()
    else requestFrame(runSpeedLimited)
  }

  function runTrajectory(): void {
    const elapsed = effectiveElapsed()
    const progress = easeInOutCubic(Math.min(Math.max(elapsed / animationDuration, 0), 1))
    const segmentPosition = progress * (trajectoryJoints.length - 1)
    const segmentIndex = Math.min(Math.floor(segmentPosition), trajectoryJoints.length - 2)
    const segmentProgress = segmentPosition - segmentIndex
    const start = trajectoryJoints[segmentIndex]
    const end = trajectoryJoints[segmentIndex + 1]
    options.setJoints(
      start.map((value, index) => value + (end[index] - value) * segmentProgress) as JointAngles,
    )

    if (progress < 1) requestFrame(runTrajectory)
    else finishMotion()
  }

  function startEased(target: JointAngles, duration = config.ikAnimDuration): Promise<MotionResult> {
    targetJoints = [...target]
    startJoints = [...options.getCurrentJoints()]
    startTime = options.clock.now()
    animationDuration = Math.max(duration, 1)

    // 同类型连续目标：复用当前帧循环与未完成 Promise（长按不卡顿的基础）。
    if (activeType === 'joint-eased' && active) return active.promise

    beginMotion('joint-eased', () => requestFrame(runEased))
    return active!.promise
  }

  function startSpeedLimited(target: JointAngles): Promise<MotionResult> {
    targetJoints = [...target]

    if (activeType === 'joint-speed' && active) return active.promise

    beginMotion('joint-speed', () => requestFrame(runSpeedLimited))
    return active!.promise
  }

  function startTrajectory(
    waypoints: readonly JointAngles[],
    duration = config.ikAnimDuration,
  ): Promise<MotionResult> {
    // 空轨迹不是有效运动计划：在不改变现有运动状态的前提下明确抛出参数错误，
    // 不能返回一个永远不结算的 Promise。
    if (waypoints.length === 0) {
      throw new Error('startTrajectory 收到空的 waypoint 轨迹，无法开始运动')
    }
    trajectoryJoints = [
      [...options.getCurrentJoints()] as JointAngles,
      ...waypoints.map((waypoint) => [...waypoint] as JointAngles),
    ]
    startTime = options.clock.now()
    animationDuration = Math.max(duration, 1)

    if (activeType === 'joint-trajectory' && active) return active.promise

    beginMotion('joint-trajectory', () => requestFrame(runTrajectory))
    return active!.promise
  }

  function pause(): void {
    // 只在运行中冻结；未运行状态幂等。
    if (status !== 'running') return
    status = 'paused'
    pausedAt = options.clock.now()
    cancelFrame()
  }

  function resume(): void {
    // 只在暂停中恢复；其余状态幂等。恢复后仍属于同一次运动与同一个 Promise。
    if (status !== 'paused') return
    if (pausedAt !== null) totalPausedTime += options.clock.now() - pausedAt
    pausedAt = null
    status = 'running'
    // 限速运动恢复后的首帧增量不能把整段暂停时间换算成关节步长，因此重置 lastTime。
    lastTime = options.clock.now()
    if (activeType === 'joint-eased') requestFrame(runEased)
    else if (activeType === 'joint-speed') requestFrame(runSpeedLimited)
    else if (activeType === 'joint-trajectory') requestFrame(runTrajectory)
  }

  function stop(): void {
    // 空闲时幂等。
    if (activeType === 'none' && !active) return
    cancelFrame()
    // 保持停止瞬间的关节值（此处不修改关节）。
    settleActive('stopped')
    activeType = 'none'
    status = 'idle'
    clearRunState()
  }

  function getStatus(): MotionStatus {
    return status
  }

  return { startEased, startSpeedLimited, startTrajectory, pause, resume, stop, getStatus }
}
