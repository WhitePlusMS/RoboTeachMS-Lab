import type { Matrix4x4 } from './transform-matrix.ts'

/** 从齐次矩阵提取页面和 RobotModel 共用的位姿分量；不绑定任何 DH 约定。 */
export function extractPose(matrix: Matrix4x4): {
  position: [number, number, number]
  eulerZYX: [number, number, number]
} {
  const m = matrix.data
  const sy = -m[2][0]
  const cy = Math.sqrt(m[0][0] ** 2 + m[1][0] ** 2)

  let rx: number
  let rz: number
  const ry = Math.atan2(sy, cy)
  if (Math.abs(cy) > 1e-6) {
    rx = Math.atan2(m[2][1], m[2][2])
    rz = Math.atan2(m[1][0], m[0][0])
  } else {
    rx = Math.atan2(-m[1][2], m[1][1])
    rz = 0
  }

  return {
    position: [m[0][3], m[1][3], m[2][3]],
    eulerZYX: [rx, ry, rz],
  }
}
