import { describe, expect, it } from 'vitest'
import { createBuiltinRapidSource } from './builtin-program.ts'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/index.ts'
import { planMotion } from '@/robot-motion-core/index.ts'
import { buildRapidMotionRequest } from '@/rapid/planning/motion-requests.ts'
import { isDefaultTool0, isDefaultWobj0 } from '@/rapid/data/index.ts'
import { robTargetToPose } from '@/rapid/data/pose-transform.ts'
import { orientationError } from '@/robot-geometry/math/rotation3d.ts'
import { DEFAULT_IK_CONFIG } from '@/robot-geometry/numerical-ik/numerical-ik.ts'
import type { JointAngles } from '@/robot-geometry/model/index.ts'
import { isRapidMotionInstruction, parseRapidProgram } from '@/rapid/language/index.ts'

/** 相邻 waypoint 构型跳变上限（度），由 Cartesian 候选图统一定义。 */
const MAX_WAYPOINT_JOINT_STEP_DEG = 5
/** 相邻关节步长校验允许的合理浮点 epsilon（度）。 */
const JOINT_STEP_EPS_DEG = 1e-6
/** 内置点位固定字面量：均为 ABB 基座/机械法兰坐标（毫米）。 */
const P_APPROACH = [368.789, 0, 821.082]
const P_WORK = [368.789, 0, 771.082]
const P_REST = [406.727, 0, 884.937]

function positionError(actual: readonly number[], target: readonly number[]): number {
  return Math.hypot(...actual.map((value, index) => value - target[index]))
}

function rotationErrorMagnitude(
  actual: Parameters<typeof orientationError>[0],
  target: Parameters<typeof orientationError>[1],
): number {
  return Math.hypot(...orientationError(actual, target))
}

function planRapidMotion(
  instruction: Parameters<typeof buildRapidMotionRequest>[0],
  joints: JointAngles,
) {
  const request = buildRapidMotionRequest(instruction, 'off', joints)
  if (!request.ok) throw new Error(request.error.message)
  return planMotion(request.request)
}

describe('页面默认 RAPID 源程序', () => {
  it('固定三条 MoveJ → MoveL → MoveJ，全部使用 tool0/wobj0/fine、无外部轴', () => {
    const result = parseRapidProgram(createBuiltinRapidSource())
    expect(result.diagnostics).toEqual([])
    const program = result.program
    expect(program).toHaveLength(3)
    expect(program.map((inst) => inst.kind)).toEqual(['movej', 'movel', 'movej'])
    for (const inst of program) {
      if (!isRapidMotionInstruction(inst)) throw new Error('内置程序不应包含赋值语句')
      expect(inst.zone.finep).toBe(true)
      expect(isDefaultTool0(inst.tool)).toBe(true)
      expect(isDefaultWobj0(inst.wobj)).toBe(true)
    }
  })

  it('解析出由新 DH 零位生成的三个固定 robtarget 字面量', () => {
    const program = parseRapidProgram(createBuiltinRapidSource()).program
    expect(program).toHaveLength(3)
    for (const inst of program) {
      if (!isRapidMotionInstruction(inst)) throw new Error('内置程序不应包含赋值语句')
      expect(inst.target.trans.every(Number.isFinite)).toBe(true)
      expect(inst.target.rot.every(Number.isFinite)).toBe(true)
    }
    if (
      program[0] &&
      program[1] &&
      program[2] &&
      program[0].kind === 'movej' &&
      program[1].kind === 'movel' &&
      program[2].kind === 'movej'
    ) {
      expect(program[0].target.trans).toEqual(P_APPROACH)
      expect(program[1].target.trans).toEqual(P_WORK)
      expect(program[2].target.trans).toEqual(P_REST)
    } else {
      throw new Error('内置程序结构异常，应为 MoveJ → MoveL → MoveJ')
    }
  })

  it('按真实程序顺序逐条几何验收：MoveJ 终点 FK、MoveL 沿 ABB 基座 Z 轴直线下降、MoveJ 返回 pRest', () => {
    const model = ABB_IRB1200_PROFILE.model
    const homeJoints: JointAngles = [...ABB_IRB1200_PROFILE.homeJoints]

    const result = parseRapidProgram(createBuiltinRapidSource())
    expect(result.canExecute).toBe(true)
    const program = result.program
    const [first, second, third] = program
    if (
      !first ||
      !second ||
      !third ||
      first.kind !== 'movej' ||
      second.kind !== 'movel' ||
      third.kind !== 'movej'
    ) {
      throw new Error('内置程序结构异常，应为 MoveJ → MoveL → MoveJ')
    }

    // —— 第一条 MoveJ -> pApproach ——
    const moveJ = planRapidMotion(first, homeJoints)
    expect(moveJ.ok, `指令 0 (${first.target.trans}) 规划失败`).toBe(true)
    if (!moveJ.ok) return

    // MoveJ 终点 FK：位置与姿态误差均应满足既有 IK 容差。
    const approachPose = model.forwardKinematics([...moveJ.end.jointsDeg] as JointAngles)
    expect(approachPose).not.toBeNull()
    if (approachPose) {
      expect(positionError(approachPose.position, P_APPROACH)).toBeLessThanOrEqual(
        DEFAULT_IK_CONFIG.posTolerance,
      )
      const approachTargetRotation = robTargetToPose(first.target).rotation
      expect(
        rotationErrorMagnitude(approachPose.rotation, approachTargetRotation),
      ).toBeLessThanOrEqual(DEFAULT_IK_CONFIG.oriTolerance)
    }

    // —— 第二条 MoveL -> pWork（沿 ABB 基座 Z 轴下降约 50mm）——
    const moveL = planRapidMotion(second, [...moveJ.end.jointsDeg] as JointAngles)
    expect(moveL.ok, '指令 1 (MoveL 下降) 从第一条终点规划失败').toBe(true)
    if (!moveL.ok) return

    const waypoints = moveL.waypoints.map((point) => [...point.jointsDeg] as JointAngles)
    expect(waypoints.length).toBeGreaterThanOrEqual(2)

    // 逐 waypoint 做 FK：MoveL 主体沿 ABB 基座 Z 轴下降约 50mm，横向（X/Y）位移保持极小。
    const endFk = model.forwardKinematics(waypoints[waypoints.length - 1])
    expect(endFk).not.toBeNull()
    if (approachPose && endFk) {
      const lateralError = Math.hypot(
        endFk.position[0] - approachPose.position[0],
        endFk.position[1] - approachPose.position[1],
      )
      expect(lateralError).toBeLessThan(0.5)
      const deltaZ = endFk.position[2] - approachPose.position[2]
      // 首条 MoveJ 到 pApproach 的 IK 近似（亚毫米级）会带入微小 Z 误差，故用“约 50mm”。
      expect(deltaZ).toBeCloseTo(-50, 0)
    }

    // 直线路径横向误差：所有 waypoint 的 FK 位置都应在 pApproach→pWork 直线附近。
    for (const waypointJoints of waypoints) {
      const wpFk = model.forwardKinematics(waypointJoints)
      expect(wpFk).not.toBeNull()
      if (wpFk) {
        if (!approachPose) throw new Error('MoveJ 终点 FK 不可用')
        // 以实际 MoveJ 终点为线段起点，不能用绝对值掩盖 Y 轴镜像错误。
        const lateralError = Math.hypot(
          wpFk.position[0] - approachPose.position[0],
          wpFk.position[1] - approachPose.position[1],
        )
        expect(lateralError).toBeLessThan(0.5)
      }
    }

    // 包含 MoveJ 终点到首个 waypoint 的过渡，任一相邻关节步长不超过 5°。
    const jointPath = [moveJ.end.jointsDeg as JointAngles, ...waypoints]
    for (let i = 1; i < jointPath.length; i += 1) {
      const prev = jointPath[i - 1]
      const curr = jointPath[i]
      const maxStep = Math.max(...curr.map((value, index) => Math.abs(value - prev[index])))
      expect(maxStep).toBeLessThanOrEqual(MAX_WAYPOINT_JOINT_STEP_DEG + JOINT_STEP_EPS_DEG)
    }

    // MoveL 终点 FK 的位置/姿态误差满足既有 IK 容差。
    if (endFk) {
      expect(positionError(endFk.position, P_WORK)).toBeLessThan(0.2)
      const workTargetRotation = robTargetToPose(second.target).rotation
      expect(rotationErrorMagnitude(endFk.rotation, workTargetRotation)).toBeLessThan(1e-3)
    }

    // —— 第三条 MoveJ -> pRest（从 MoveL 最后 waypoint 起）——
    const lastMoveLWaypoint = waypoints[waypoints.length - 1]
    const moveJFinal = planRapidMotion(third, lastMoveLWaypoint)
    expect(moveJFinal.ok, '指令 2 (MoveJ 返回) 从第二条终点规划失败').toBe(true)
    if (!moveJFinal.ok) return

    const restPose = model.forwardKinematics([...moveJFinal.end.jointsDeg] as JointAngles)
    expect(restPose).not.toBeNull()
    if (restPose) {
      expect(positionError(restPose.position, P_REST)).toBeLessThanOrEqual(
        DEFAULT_IK_CONFIG.posTolerance,
      )
      const restTargetRotation = robTargetToPose(third.target).rotation
      expect(rotationErrorMagnitude(restPose.rotation, restTargetRotation)).toBeLessThanOrEqual(
        DEFAULT_IK_CONFIG.oriTolerance,
      )
    }
  })
})
