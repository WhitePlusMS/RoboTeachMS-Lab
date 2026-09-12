export type ScenePoint = [number, number, number]

/** 轨迹缓冲初始容量（点）；仅作预分配起点，超出后缓冲区按需翻倍增长，不再截断。 */
export const DEFAULT_TRAJECTORY_LIMIT = 200
export const DEFAULT_TRAJECTORY_DISTANCE = 0.001

/** 按最小距离采样末端轨迹；默认不截断，传入 maxPoints 时才丢弃最旧的点。 */
export function appendTrajectoryPoint(
  points: readonly ScenePoint[],
  point: ScenePoint,
  maxPoints = Number.POSITIVE_INFINITY,
  minDistance = DEFAULT_TRAJECTORY_DISTANCE,
): ScenePoint[] {
  const last = points[points.length - 1]
  if (last) {
    const distance = Math.hypot(point[0] - last[0], point[1] - last[1], point[2] - last[2])
    if (distance < minDistance) return [...points]
  }

  const next = [...points, [...point] as ScenePoint]
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next
}
