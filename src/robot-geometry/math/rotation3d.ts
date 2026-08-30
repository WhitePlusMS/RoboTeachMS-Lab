export type RotationMatrix = number[][]

export function mat3Mul(left: RotationMatrix, right: RotationMatrix): RotationMatrix {
  return Array.from({ length: 3 }, (_, row) =>
    Array.from({ length: 3 }, (_, column) =>
      left[row].reduce((sum, value, index) => sum + value * right[index][column], 0),
    ),
  )
}

export function mat3Transpose(matrix: RotationMatrix): RotationMatrix {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ]
}

export function quaternionToRotationMatrix(
  quaternion: [number, number, number, number],
): RotationMatrix {
  const [x, y, z, w] = quaternion
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ]
}

export function rotationMatrixToEulerZYX(rotation: RotationMatrix): [number, number, number] {
  const sy = -rotation[2][0]
  const cy = Math.sqrt(rotation[0][0] ** 2 + rotation[1][0] ** 2)
  const ry = Math.atan2(sy, cy)
  if (Math.abs(cy) > 1e-6) {
    return [
      Math.atan2(rotation[2][1], rotation[2][2]),
      ry,
      Math.atan2(rotation[1][0], rotation[0][0]),
    ]
  }
  return [Math.atan2(-rotation[1][2], rotation[1][1]), ry, 0]
}

/**
 * 旋转矩阵转四元数 (x, y, z, w)，标量 w 在最后；与 RAPID robtarget.rot 记录形状一致。
 * 输出会归一化，输入需接近正交矩阵。
 */
export function rotationMatrixToQuaternion(
  rotation: RotationMatrix,
): [number, number, number, number] {
  const trace = rotation[0][0] + rotation[1][1] + rotation[2][2]
  let quaternion: [number, number, number, number]
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2
    quaternion = [
      (rotation[2][1] - rotation[1][2]) / scale,
      (rotation[0][2] - rotation[2][0]) / scale,
      (rotation[1][0] - rotation[0][1]) / scale,
      scale / 4,
    ]
  } else if (rotation[0][0] > rotation[1][1] && rotation[0][0] > rotation[2][2]) {
    const scale = Math.sqrt(1 + rotation[0][0] - rotation[1][1] - rotation[2][2]) * 2
    quaternion = [
      scale / 4,
      (rotation[0][1] + rotation[1][0]) / scale,
      (rotation[0][2] + rotation[2][0]) / scale,
      (rotation[2][1] - rotation[1][2]) / scale,
    ]
  } else if (rotation[1][1] > rotation[2][2]) {
    const scale = Math.sqrt(1 + rotation[1][1] - rotation[0][0] - rotation[2][2]) * 2
    quaternion = [
      (rotation[0][1] + rotation[1][0]) / scale,
      scale / 4,
      (rotation[1][2] + rotation[2][1]) / scale,
      (rotation[0][2] - rotation[2][0]) / scale,
    ]
  } else {
    const scale = Math.sqrt(1 + rotation[2][2] - rotation[0][0] - rotation[1][1]) * 2
    quaternion = [
      (rotation[0][2] + rotation[2][0]) / scale,
      (rotation[1][2] + rotation[2][1]) / scale,
      scale / 4,
      (rotation[1][0] - rotation[0][1]) / scale,
    ]
  }
  const length = Math.hypot(...quaternion)
  return quaternion.map((value) => value / length) as [number, number, number, number]
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/**
 * 返回两个旋转之间的几何最短夹角（弧度，范围 0…π）。
 *
 * 不能使用 `sin(theta)` 作为姿态残差：当姿态相差 180° 时 sin(theta)=0，
 * 会把腕部等价分支的大跳误判成精确姿态。这里直接从相对旋转的 trace 计算
 * geodesic angle，并在浮点误差下钳制到合法 acos 输入范围。
 */
export function rotationDistanceRad(
  targetRotation: RotationMatrix,
  currentRotation: RotationMatrix,
): number {
  const relative = mat3Mul(targetRotation, mat3Transpose(currentRotation))
  const cosine = clampUnit(
    (relative[0][0] + relative[1][1] + relative[2][2] - 1) / 2,
  )
  return Math.acos(cosine)
}

/**
 * 从目标旋转到当前旋转的 log-map 轴角误差向量（弧度）。
 *
 * 小角度时退化为反对称部分以保持数值 Jacobian 的连续性；一般角度按
 * theta/sin(theta) 恢复真正的轴角长度；接近 π 时改用四元数轴，避免
 * `sin(theta)` 退化。向量模长始终代表完整旋转角，而不是 |sin(theta)|。
 */
export function orientationError(
  targetRotation: RotationMatrix,
  currentRotation: RotationMatrix,
): [number, number, number] {
  const relative = mat3Mul(targetRotation, mat3Transpose(currentRotation))
  const skew: [number, number, number] = [
    (relative[2][1] - relative[1][2]) / 2,
    (relative[0][2] - relative[2][0]) / 2,
    (relative[1][0] - relative[0][1]) / 2,
  ]
  const sine = Math.hypot(...skew)
  const cosine = clampUnit(
    (relative[0][0] + relative[1][1] + relative[2][2] - 1) / 2,
  )
  const theta = Math.atan2(sine, cosine)

  if (theta < 1e-8 || sine < 1e-8) {
    if (theta < 1e-8) return skew

    // 在 π 附近，反对称部分趋近于零；四元数的向量部仍能稳定给出旋转轴。
    const quaternion = rotationMatrixToQuaternion(relative)
    const axisLength = Math.hypot(quaternion[0], quaternion[1], quaternion[2])
    if (axisLength >= 1e-8) {
      return [
        (quaternion[0] / axisLength) * theta,
        (quaternion[1] / axisLength) * theta,
        (quaternion[2] / axisLength) * theta,
      ]
    }
    return [0, 0, theta]
  }

  const scale = theta / sine
  return skew.map((value) => value * scale) as [number, number, number]
}
