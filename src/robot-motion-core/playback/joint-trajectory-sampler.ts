import type { JointAngles } from '../../robot-geometry/robot-types.ts'

/** 已规划的时间点：毫秒从 0 开始，关节角使用度。 */
export interface TimedJointWaypoint {
  readonly timeMs: number
  readonly jointsDeg: Readonly<JointAngles>
}

/** 只做时间采样，不重新缓动或改变运动路径。 */
export function sampleJointTrajectory(
  points: readonly TimedJointWaypoint[],
  elapsedMs: number,
): JointAngles {
  if (elapsedMs <= 0) return [...points[0].jointsDeg]
  const last = points[points.length - 1]
  if (elapsedMs >= last.timeMs) return [...last.jointsDeg]
  const index = points.findIndex((point) => point.timeMs > elapsedMs)
  const start = points[index - 1],
    end = points[index]
  const progress = (elapsedMs - start.timeMs) / (end.timeMs - start.timeMs)
  return start.jointsDeg.map(
    (value, axis) => value + (end.jointsDeg[axis] - value) * progress,
  ) as JointAngles
}

export function validateJointTrajectory(points: readonly TimedJointWaypoint[]): void {
  if (
    points.length < 2 ||
    points[0].timeMs !== 0 ||
    points.some(
      (point, index) =>
        !Number.isFinite(point.timeMs) ||
        (index > 0 && point.timeMs <= points[index - 1].timeMs) ||
        point.jointsDeg.length !== 6 ||
        !point.jointsDeg.every(Number.isFinite),
    )
  ) {
    throw new Error('运动计划必须包含从 0 开始、时间严格递增的有限六轴路径点')
  }
}
