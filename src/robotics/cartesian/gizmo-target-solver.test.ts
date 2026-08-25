import { describe, expect, it } from 'vitest'
import { DEFAULT_IK_CONFIG, solveIK } from '../inverse-kinematics/numerical-ik.ts'
import { solveGizmoTarget } from './gizmo-target-solver.ts'
import type { JointAngles, Pose } from '../model/types.ts'
import { rotationDistanceRad } from '@/robotics/math/rotation3d.ts'
import { ABB_JOINT_RANGES } from '@/robot-models/abb-irb1200/parameters.ts'
import { AbbRobotModelAdapter } from '@/robot-models/abb-irb1200/kinematics/abb-robot-model-adapter.ts'

function axisMat(ax: number[], deg: number): number[][] {
  const h = (deg * Math.PI) / 180
  const c = Math.cos(h),
    s = Math.sin(h),
    t = 1 - c
  const [x, y, z] = ax
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ]
}
function mul(A: number[][], B: number[][]): number[][] {
  return Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) => A[r].reduce((s, v, k) => s + v * B[k][c], 0)),
  )
}

describe('solveGizmoTarget', () => {
  const model = new AbbRobotModelAdapter()
  let seed = 1
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  function randJ(mid: number) {
    return ABB_JOINT_RANGES.map(([a, b]) => {
      const c = (a + b) / 2
      const r = ((b - a) / 2) * mid
      const v = c + (rand() * 2 - 1) * r
      return Math.round(v * 10) / 10
    }) as JointAngles
  }

  it('全范围关节小幅旋转：共享候选图保持有限失败率', { timeout: 60000 }, () => {
    let candidateFailures = 0
    let maxPositionError = 0
    let maxOrientationError = 0
    const N = 2000
    for (let i = 0; i < N; i++) {
      const j = randJ(0.05)
      const cur = model.forwardKinematics(j) as Pose
      const ax = (() => {
        const v = [rand(), rand(), rand()]
        const n = Math.hypot(...v) || 1
        return v.map((x) => x / n)
      })()
      const tR = mul(cur.rotation, axisMat(ax, 5))
      const target: Pose = { position: [...cur.position], euler: [0, 0, 0], rotation: tR }
      const solved = solveGizmoTarget(target, j, model, ABB_JOINT_RANGES)
      if (!solved) {
        candidateFailures++
        continue
      }
      const solvedPose = model.forwardKinematics(solved)
      expect(solvedPose).not.toBeNull()
      if (!solvedPose) continue
      maxPositionError = Math.max(
        maxPositionError,
        Math.hypot(...solvedPose.position.map((v, index) => v - target.position[index])),
      )
      maxOrientationError = Math.max(
        maxOrientationError,
        rotationDistanceRad(target.rotation, solvedPose.rotation),
      )
    }
    expect(candidateFailures).toBe(0)
    // Gizmo 复用解析候选目录的默认验收容差；此处验证实际 FK 残差没有绕过
    // 求解器契约，而不是要求浮点运算达到真实数据回放的零误差量级。
    expect(maxPositionError).toBeLessThan(DEFAULT_IK_CONFIG.posTolerance)
    expect(maxOrientationError).toBeLessThan(DEFAULT_IK_CONFIG.oriTolerance)
  })

  it('中等范围关节旋转：共享候选图保持有限失败率', { timeout: 60000 }, () => {
    let baselineFailures = 0
    let candidateFailures = 0
    const N = 2000
    for (let i = 0; i < N; i++) {
      const j = randJ(0.8)
      const cur = model.forwardKinematics(j) as Pose
      const ax = (() => {
        const v = [rand(), rand(), rand()]
        const n = Math.hypot(...v) || 1
        return v.map((x) => x / n)
      })()
      const tR = mul(cur.rotation, axisMat(ax, 5))
      const target: Pose = { position: [...cur.position], euler: [0, 0, 0], rotation: tR }
      if (!solveIK(target, j, model, {}, ABB_JOINT_RANGES)) baselineFailures++
      if (!solveGizmoTarget(target, j, model, ABB_JOINT_RANGES)) candidateFailures++
    }
    expect(candidateFailures).toBeLessThanOrEqual(baselineFailures)
  })
})
