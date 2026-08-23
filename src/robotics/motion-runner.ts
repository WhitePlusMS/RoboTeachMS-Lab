import { DEFAULT_MOTION_CONFIG, easeInOutCubic, lerpJoints } from './motion-smoothing.ts'
import type { JointAngles, MotionConfig } from './types.ts'

/**
 * 运动状态：只有空闲、运行、暂停三种。它不是 RAPID 程序状态。
 */
export type MotionStatus = 'idle' | 'running' | 'paused'

/**
 * 一次运动执行终止时供上层等待的结果：仅到达终点的 completed 和提前终止的 stopped。
 * paused 不是终止结果；failed/replaced 不在结果集合内。
 */
export type MotionResult = 'completed' | 'stopped'

type MotionType =
  | 'none'
  | 'joint-eased'
  | 'joint-speed'
  | 'joint-trajectory'
  | 'joint-stream'

const STREAM_JOIN_DISTANCE_DEG = 10

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
  /** 只把新 waypoint 追加到当前笛卡尔执行队列尾部，不重置已执行段。 */
  appendTrajectory: (
    waypoints: readonly JointAngles[],
    duration?: number,
    generation?: number,
  ) => Promise<MotionResult>
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
  let streamSegmentIndex = 0
  let streamSegmentStartTime = 0
  let streamSegmentDuration = config.ikAnimDuration
  let streamGeneration: number | null = null
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

  function runStreamTrajectory(): void {
    const start = trajectoryJoints[streamSegmentIndex]
    const end = trajectoryJoints[streamSegmentIndex + 1]
    if (!start || !end) {
      finishMotion()
      return
    }
    const progress = Math.min(
      Math.max((options.clock.now() - streamSegmentStartTime) / streamSegmentDuration, 0),
      1,
    )
    const eased = easeInOutCubic(progress)
    options.setJoints(
      start.map((value, index) => value + (end[index] - value) * eased) as JointAngles,
    )
    if (progress < 1) {
      requestFrame(runStreamTrajectory)
      return
    }
    streamSegmentIndex += 1
    streamSegmentStartTime = options.clock.now()
    if (streamSegmentIndex >= trajectoryJoints.length - 1) finishMotion()
    else requestFrame(runStreamTrajectory)
  }

  function startEased(
    target: JointAngles,
    duration = config.ikAnimDuration,
  ): Promise<MotionResult> {
    targetJoints = [...target]
    startJoints = [...options.getCurrentJoints()]
    startTime = options.clock.now()
    animationDuration = Math.max(duration, 1)
    // 同模式 retarget 建立新的时间轴：清空历史暂停累计与暂停点，避免 effectiveElapsed 变负。
    totalPausedTime = 0
    pausedAt = null

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
    // 同模式 retarget 建立新的时间轴：清空历史暂停累计与暂停点，避免 effectiveElapsed 变负。
    totalPausedTime = 0
    pausedAt = null

    if (activeType === 'joint-trajectory' && active) return active.promise

    beginMotion('joint-trajectory', () => requestFrame(runTrajectory))
    return active!.promise
  }

  function appendTrajectory(
    waypoints: readonly JointAngles[],
    duration = config.ikAnimDuration,
    generation?: number,
  ): Promise<MotionResult> {
    if (waypoints.length === 0) {
      throw new Error('appendTrajectory 收到空的 waypoint 轨迹，无法追加运动')
    }
    const copied = waypoints.map((waypoint) => [...waypoint] as JointAngles)
    if (activeType === 'joint-stream' && active) {
      if (generation !== undefined && generation !== streamGeneration) {
        trajectoryJoints = [
          [...options.getCurrentJoints()] as JointAngles,
          copied[copied.length - 1],
        ]
        streamSegmentIndex = 0
        streamSegmentStartTime = options.clock.now()
        streamSegmentDuration = Math.max(duration, 1)
        streamGeneration = generation
        return active.promise
      }
      // 规划器通常从发送时快照开始，结果前缀可能已经落在当前已提交尾部之前；
      // 只追加从队列尾部最近的 waypoint 开始的未来后缀，绝不把执行拉回历史点。
      const tail = trajectoryJoints[trajectoryJoints.length - 1]
      const endpoint = copied[copied.length - 1]
      const endpointDelta = endpoint.map((value, index) => value - tail[index])
      const dominantAxis = endpointDelta.reduce(
        (best, value, index) => Math.abs(value) > Math.abs(endpointDelta[best]) ? index : best,
        0,
      )
      // 同一代次内的结果只能沿当前目标的主方向接续；终点落到尾部反向侧的
      // 结果通常是旧规划快照，直接拒绝，避免 [5,20,0] 之类的来回抽动。
      if (Math.abs(endpointDelta[dominantAxis]) > 1e-7 && endpointDelta[dominantAxis] < 0) {
        return active.promise
      }
      const futureCandidates = copied.filter((candidate) =>
        candidate.every((value, index) => Math.abs(value - tail[index]) <= STREAM_JOIN_DISTANCE_DEG),
      )
      if (futureCandidates.length === 0) return active.promise
      let closestIndex = 0
      let closestDistance = Number.POSITIVE_INFINITY
      copied.forEach((candidate, index) => {
        if (!futureCandidates.includes(candidate)) return
        const candidateDelta = candidate.map((value, jointIndex) => value - tail[jointIndex])
        const projection = candidateDelta.reduce(
          (sum, value, jointIndex) => sum + value * endpointDelta[jointIndex],
          0,
        )
        if (projection < -1e-7) return
        const distance = Math.hypot(...candidate.map((value, jointIndex) => value - tail[jointIndex]))
        if (distance < closestDistance) {
          closestDistance = distance
          closestIndex = index
        }
      })
      const suffix = copied.slice(closestIndex).filter((candidate) =>
        futureCandidates.includes(candidate) &&
        candidate.some((value, index) => Math.abs(value - tail[index]) > 1e-7),
      )
      if (suffix.length > 0) trajectoryJoints.push(...suffix)
      return active.promise
    }
    // 空闲时当前关节已经是执行尾部；只取最新目标，避免结果前缀把关节拉回旧点。
    trajectoryJoints = [
      [...options.getCurrentJoints()] as JointAngles,
      copied[copied.length - 1],
    ]
    streamSegmentIndex = 0
    streamSegmentStartTime = options.clock.now()
    streamSegmentDuration = Math.max(duration, 1)
    streamGeneration = generation ?? null
    beginMotion('joint-stream', () => requestFrame(runStreamTrajectory))
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
    else if (activeType === 'joint-stream') requestFrame(runStreamTrajectory)
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

  return {
    startEased,
    startSpeedLimited,
    startTrajectory,
    appendTrajectory,
    pause,
    resume,
    stop,
    getStatus,
  }
}
