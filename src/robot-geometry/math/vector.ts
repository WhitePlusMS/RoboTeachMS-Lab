/** 将向量模长限制到指定范围，避免单次 DLS 更新过大。 */
export function clampVectorMagnitude(vector: number[], maxNorm: number): number[] {
  const norm = Math.hypot(...vector)
  if (norm <= maxNorm || norm === 0) return vector
  const scale = maxNorm / norm
  return vector.map((value) => value * scale)
}

/** 将关节更新按最大绝对值同比例限制。 */
export function clampDegStep(step: number[], maxStepDeg: number): number[] {
  const maxAbs = Math.max(...step.map((value) => Math.abs(value)))
  if (maxAbs <= maxStepDeg || maxAbs === 0) return step
  const scale = maxStepDeg / maxAbs
  return step.map((value) => value * scale)
}
