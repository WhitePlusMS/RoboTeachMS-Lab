import type { Pose } from '@/robotics/types.ts'
import { quaternionToRotationMatrix } from '@/robotics/math/rotation3d.ts'

/**
 * 圆弧采样（MoveC 核心）：由 TCP 空间三点（起点 / 圆点 / 终点）确定唯一圆弧，
 * 在圆弧上按进度采样一串 TCP 位姿（含途经点与终点）。纯数学，不依赖 Vue/Three/机器人模型。
 *
 * 语义对齐 ABB MoveC：TCP 从当前位置(P0) 经圆点(P1) 到终点(P2)。三点确定圆周，且
 * “必须经过圆点 P1”决定了唯一走向（从 P0 出发沿圆走，先遇 P1 再遇 P2 的那个方向）；
 * 位姿方向在起终点间线性过渡（与 MoveL 的姿态 slerp 一致）。
 *
 * 退化情况（三点共线 / 三点过近 / 无法定圆）返回 null，由调用方映射为规划错误，
 * 绝不静默降级为直线。
 */

function sub3(a: readonly number[], b: readonly number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function add3(a: readonly number[], b: readonly number[]): number[] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scale3(a: readonly number[], s: number): number[] {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function cross3(a: readonly number[], b: readonly number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function normalize3(a: readonly number[]): number[] | null {
  const length = Math.hypot(...a)
  if (!Number.isFinite(length) || length < 1e-12) return null
  return scale3(a, 1 / length)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function slerpQuaternion(
  start: [number, number, number, number],
  target: [number, number, number, number],
  progress: number,
): [number, number, number, number] {
  let end = target
  let dot = start.reduce((sum, value, index) => sum + value * target[index], 0)
  if (dot < 0) {
    end = target.map((value) => -value) as [number, number, number, number]
    dot = -dot
  }
  if (dot > 0.9995) {
    const interp = start.map((value, index) => value + (end[index] - value) * progress)
    const length = Math.hypot(...interp)
    return interp.map((value) => value / length) as [number, number, number, number]
  }
  const angle = Math.acos(clamp(dot, -1, 1))
  const denominator = Math.sin(angle)
  const startWeight = Math.sin((1 - progress) * angle) / denominator
  const endWeight = Math.sin(progress * angle) / denominator
  return start.map(
    (value, index) => value * startWeight + end[index] * endWeight,
  ) as [number, number, number, number]
}

/**
 * 计算过三点 P0(起点)/P1(圆点)/P2(终点) 的圆弧，返回圆心、半径、平面基向量、
 * 以及从 P0 出发经 P1 到 P2 的终止扫掠角。退化无法定圆时返回 null。
 */
function buildArc(
  p0: readonly number[],
  p1: readonly number[],
  p2: readonly number[],
): {
  center: number[]
  radius: number
  xAxis: number[]
  yAxis: number[]
  endAngle: number
} | null {
  // 三点共线或过近 → 无法定圆。
  const a = sub3(p1, p0)
  const b = sub3(p2, p0)
  const n = cross3(a, b)
  const area = Math.hypot(...n)
  const lengthA = Math.hypot(...a)
  const lengthB = Math.hypot(...b)
  if (lengthA < 1e-9 || lengthB < 1e-9 || area / (lengthA * lengthB) < 1e-4) return null

  const nNorm = normalize3(n)
  if (!nNorm) return null

  // 圆心相对 p0 的位移 t = u·a + v·b，解 2x2 线性系统 t·a=|a|²/2, t·b=|b|²/2：
  //   aa·u + ab·v = aa/2
  //   ab·u + bb·v = bb/2
  const aa = dot3(a, a)
  const bb = dot3(b, b)
  const ab = dot3(a, b)
  const det = aa * bb - ab * ab
  if (Math.abs(det) < 1e-12) return null
  const u = (bb * (aa - ab)) / (2 * det)
  const v = (aa * (bb - ab)) / (2 * det)
  const t = add3(scale3(a, u), scale3(b, v))
  const center = add3(p0, t)

  const xAxis = normalize3(sub3(p0, center))
  if (!xAxis) return null
  const radius = Math.hypot(...sub3(p0, center))
  if (!Number.isFinite(radius) || radius < 1e-9) return null
  const zAxis = nNorm
  const yAxis = cross3(zAxis, xAxis)

  // p1 / p2 在圆上相对 xAxis 的基角（[0, 2π)）。
  const angleOf = (point: readonly number[]): number => {
    const v = sub3(point, center)
    const cos = clamp(dot3(v, xAxis) / radius, -1, 1)
    let theta = Math.acos(cos)
    if (dot3(v, yAxis) < 0) theta = -theta
    theta %= 2 * Math.PI
    if (theta < 0) theta += 2 * Math.PI
    return theta
  }
  const t1 = angleOf(p1) // p0 对应角为 0
  const t2 = angleOf(p2)

  // 从 p0(0) 出发、先经 p1 再达 p2 的唯一走向：t1 < t2 则正向 0→t2；否则反向 0→(t2-2π)。
  const endAngle = t1 < t2 ? t2 : t2 - 2 * Math.PI
  if (!Number.isFinite(endAngle)) return null
  return { center, radius, xAxis, yAxis, endAngle }
}

/**
 * 采样圆弧得到一串 TCP 位姿（含起点、途经点、终点），姿态在首末间 slerp。
 * 退化无法定圆时返回 null。
 */
export function sampleArcPoses(
  p0: readonly number[],
  p1: readonly number[],
  p2: readonly number[],
  q0: [number, number, number, number],
  q2: [number, number, number, number],
  segmentCount: number,
): Pose[] | null {
  const arc = buildArc(p0, p1, p2)
  if (!arc) return null
  const count = Math.max(1, Math.floor(segmentCount))
  const poses: Pose[] = []
  for (let seg = 0; seg <= count; seg += 1) {
    const progress = seg / count
    const theta = arc.endAngle * progress
    const position = add3(
      arc.center,
      add3(scale3(arc.xAxis, Math.cos(theta) * arc.radius), scale3(arc.yAxis, Math.sin(theta) * arc.radius)),
    )
    const quat = slerpQuaternion(q0, q2, progress)
    poses.push({
      position: [position[0], position[1], position[2]],
      euler: [0, 0, 0],
      rotation: quaternionToRotationMatrix(quat),
    })
  }
  return poses
}

/** 计算圆弧弧长（mm）：半径 × 扫掠角绝对值。用于时长估算。 */
export function arcLengthMm(
  p0: readonly number[],
  p1: readonly number[],
  p2: readonly number[],
): number | null {
  const arc = buildArc(p0, p1, p2)
  if (!arc) return null
  const length = arc.radius * Math.abs(arc.endAngle)
  return Number.isFinite(length) ? length : null
}
