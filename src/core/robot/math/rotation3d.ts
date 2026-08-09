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

/** 从目标旋转到当前旋转的轴角误差，保持原项目定义。 */
export function orientationError(
  targetRotation: RotationMatrix,
  currentRotation: RotationMatrix,
): [number, number, number] {
  const relative = mat3Mul(targetRotation, mat3Transpose(currentRotation))
  return [
    (relative[2][1] - relative[1][2]) / 2,
    (relative[0][2] - relative[2][0]) / 2,
    (relative[1][0] - relative[0][1]) / 2,
  ]
}
