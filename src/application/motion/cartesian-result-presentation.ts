import type { JointAngles } from '@/robot-geometry/robot-types.ts'
import type { MotionError, MotionPlanningResult } from '@/robot-motion-core/index.ts'

export type CartesianStatus =
  | 'ready'
  | 'planning'
  | 'solved'
  | 'wrist-solved'
  | 'invalid'
  | 'unreachable'
  | 'singularity'
  | 'reconfiguration'
  | 'joint-limit'
  | 'joint-step'
  | 'not-converged'

/** 应用层只保留用于状态呈现的路径结果，不暴露 Core 内部求解器类型。 */
export type CartesianPathFailure =
  'wrist-singularity' | 'wrist-reconfiguration' | 'joint-limit' | 'joint-step' | 'ik-not-converged'

export interface WaypointFailureDiagnostic {
  waypointIndex: number
  axisIndex: number
  previousAngleDeg: number
  attemptedAngleDeg?: number
  deltaDeg?: number
  limitRangeDeg?: readonly [number, number]
}

export type CartesianPathResult =
  | {
      ok: true
      waypoints: JointAngles[]
      appliedSingularityMode: 'wrist' | null
    }
  | {
      ok: false
      failure: CartesianPathFailure
      diagnostic?: WaypointFailureDiagnostic
      coreError?: MotionError
    }

export function mapPathFailureToStatus(failure: CartesianPathFailure): CartesianStatus {
  if (failure === 'wrist-singularity') return 'singularity'
  if (failure === 'wrist-reconfiguration') return 'reconfiguration'
  if (failure === 'joint-limit') return 'joint-limit'
  if (failure === 'joint-step') return 'joint-step'
  // 普通 IK 不收敛仍归入原有 unreachable 状态；规划器已经保留了更细的 failure 枚举，
  // 这里只保持控制面板状态数量精简，避免为一次数值失败增加重复的 UI 分支。
  return 'unreachable'
}

export function formatFailureDiagnostic(diagnostic: WaypointFailureDiagnostic | null): string {
  if (!diagnostic) return ''
  const waypoint = `第 ${diagnostic.waypointIndex} 个路径点`
  if (diagnostic.axisIndex < 0 || diagnostic.axisIndex > 5) {
    return `${waypoint} 未找到可验收的关节解，无法归因到单个关节`
  }
  const axis = `J${diagnostic.axisIndex + 1}`
  const current = `当前 ${diagnostic.previousAngleDeg.toFixed(2)}°`
  const attempted =
    diagnostic.attemptedAngleDeg === undefined
      ? ''
      : `，尝试 ${diagnostic.attemptedAngleDeg.toFixed(2)}°`
  const delta = diagnostic.deltaDeg === undefined ? '' : `，变化 ${diagnostic.deltaDeg.toFixed(2)}°`
  const limit = diagnostic.limitRangeDeg
    ? `，允许范围 ${diagnostic.limitRangeDeg[0]}°~${diagnostic.limitRangeDeg[1]}°`
    : ''
  return `${waypoint}：${axis} 无法继续（${current}${attempted}${delta}${limit}）`
}

export function coreResultToPathResult(result: MotionPlanningResult): CartesianPathResult {
  if (result.ok) {
    return {
      ok: true,
      waypoints: result.waypoints.slice(1).map((point) => [...point.jointsDeg] as JointAngles),
      appliedSingularityMode: result.validation.relaxedConstraints ? 'wrist' : null,
    }
  }
  const failure =
    result.error.code === 'joint-limit'
      ? 'joint-limit'
      : result.error.code === 'path-discontinuity'
        ? 'joint-step'
        : result.error.code === 'wrist-singularity'
          ? 'wrist-singularity'
          : 'ik-not-converged'
  const details = result.error.details
  const diagnostic =
    typeof details.waypointIndex === 'number' &&
    typeof details.axisIndex === 'number' &&
    typeof details.previousAngleDeg === 'number'
      ? {
          waypointIndex: details.waypointIndex,
          axisIndex: details.axisIndex,
          previousAngleDeg: details.previousAngleDeg,
          attemptedAngleDeg:
            typeof details.attemptedAngleDeg === 'number' ? details.attemptedAngleDeg : undefined,
          deltaDeg: typeof details.deltaDeg === 'number' ? details.deltaDeg : undefined,
          limitRangeDeg:
            typeof details.limitMinDeg === 'number' && typeof details.limitMaxDeg === 'number'
              ? ([details.limitMinDeg, details.limitMaxDeg] as const)
              : undefined,
        }
      : undefined
  return { ok: false, failure, diagnostic, coreError: result.error }
}
