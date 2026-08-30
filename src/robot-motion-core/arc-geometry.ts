import type { Pose } from '@/robot-geometry/model/index.ts'
import { quaternionToRotationMatrix } from '@/robot-geometry/math/rotation3d.ts'

/**
 * 圆弧采样（MoveC Core）：由 TCP 空间三点（起点 / 圆点 / 终点）确定唯一圆弧，
 * 在圆弧上按进度采样一串 TCP 位姿（含途经点与终点）。纯数学，不依赖 Vue/Three、
 * RAPID 运行时或机器人控制器。
 */

function sub3(a: readonly number[], b: readonly number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function add3(a: readonly number[], b: readonly number[]): number[] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scale3(a: readonly number[], scale: number): number[] {
  return [a[0] * scale, a[1] * scale, a[2] * scale]
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

function normalize3(vector: readonly number[]): number[] | null {
  const length = Math.hypot(...vector)
  if (!Number.isFinite(length) || length < 1e-12) return null
  return scale3(vector, 1 / length)
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
    const interpolated = start.map((value, index) => value + (end[index] - value) * progress)
    const length = Math.hypot(...interpolated)
    return interpolated.map((value) => value / length) as [number, number, number, number]
  }
  const angle = Math.acos(clamp(dot, -1, 1))
  const denominator = Math.sin(angle)
  const startWeight = Math.sin((1 - progress) * angle) / denominator
  const endWeight = Math.sin(progress * angle) / denominator
  return start.map((value, index) => value * startWeight + end[index] * endWeight) as [number, number, number, number]
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
  const first = sub3(p1, p0)
  const second = sub3(p2, p0)
  const normal = cross3(first, second)
  const area = Math.hypot(...normal)
  const firstLength = Math.hypot(...first)
  const secondLength = Math.hypot(...second)
  if (firstLength < 1e-9 || secondLength < 1e-9 || area / (firstLength * secondLength) < 1e-4) return null

  const normalAxis = normalize3(normal)
  if (!normalAxis) return null

  // 圆心相对 p0 的位移 t = u·first + v·second，解 2x2 线性系统。
  const firstSquared = dot3(first, first)
  const secondSquared = dot3(second, second)
  const crossDot = dot3(first, second)
  const determinant = firstSquared * secondSquared - crossDot * crossDot
  if (Math.abs(determinant) < 1e-12) return null
  const firstWeight = (secondSquared * (firstSquared - crossDot)) / (2 * determinant)
  const secondWeight = (firstSquared * (secondSquared - crossDot)) / (2 * determinant)
  const center = add3(p0, add3(scale3(first, firstWeight), scale3(second, secondWeight)))

  const xAxis = normalize3(sub3(p0, center))
  if (!xAxis) return null
  const radius = Math.hypot(...sub3(p0, center))
  if (!Number.isFinite(radius) || radius < 1e-9) return null
  const yAxis = cross3(normalAxis, xAxis)

  const angleOf = (point: readonly number[]): number => {
    const relative = sub3(point, center)
    const cos = clamp(dot3(relative, xAxis) / radius, -1, 1)
    let angle = Math.acos(cos)
    if (dot3(relative, yAxis) < 0) angle = -angle
    angle %= 2 * Math.PI
    if (angle < 0) angle += 2 * Math.PI
    return angle
  }
  const viaAngle = angleOf(p1)
  const targetAngle = angleOf(p2)

  // 从 p0(0) 出发、先经 p1 再达 p2 的唯一走向。
  const endAngle = viaAngle < targetAngle ? targetAngle : targetAngle - 2 * Math.PI
  if (!Number.isFinite(endAngle)) return null
  return { center, radius, xAxis, yAxis, endAngle }
}

/**
 * 采样圆弧得到一串 TCP 位姿（含起点、途经点、终点），姿态在首末间 slerp。
 * 退化无法定圆时返回 null，调用方应将其映射为结构化规划错误。
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
  for (let segment = 0; segment <= count; segment += 1) {
    const progress = segment / count
    const theta = arc.endAngle * progress
    const position = add3(
      arc.center,
      add3(scale3(arc.xAxis, Math.cos(theta) * arc.radius), scale3(arc.yAxis, Math.sin(theta) * arc.radius)),
    )
    const quaternion = slerpQuaternion(q0, q2, progress)
    poses.push({
      position: [position[0], position[1], position[2]],
      euler: [0, 0, 0],
      rotation: quaternionToRotationMatrix(quaternion),
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
