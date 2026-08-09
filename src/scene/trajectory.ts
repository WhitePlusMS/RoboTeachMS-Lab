export type ScenePoint = [number, number, number]

export const DEFAULT_TRAJECTORY_LIMIT = 200
export const DEFAULT_TRAJECTORY_DISTANCE = 0.001

/** 按最小距离采样末端轨迹，并限制内存中的最大点数。 */
export function appendTrajectoryPoint(
  points: readonly ScenePoint[],
  point: ScenePoint,
  maxPoints = DEFAULT_TRAJECTORY_LIMIT,
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
