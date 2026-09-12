/**
 * 特征化测试：锁定 MOVEL 回放和关节 Jog 的现状行为（丝滑基线）。
 *
 * 本次修改（gizmo/笛卡尔连续点动改同步直调）不能连带影响这两条路径。
 * 这些测试不验证"丝滑"这个主观感受本身，只锁定关键技术事实：
 * - MOVEL 回放走 trajectory playback，预先拿到完整轨迹后单次 RAF 循环播放
 * - 关节 Jog 走 speed-limited playback，不经过 Worker（因为是 joint-target intent）
 */

import { describe, expect, it } from 'vitest'
import { planMotion } from '@/robot-motion-core/index.ts'
import type { JointAngles } from '@/robot-geometry/robot-types.ts'
import { buildRapidMotionRequest } from '@/rapid/motion/rapid-motion-request.ts'
import { parseRapidProgram, isRapidMotionInstruction } from '@/rapid/language/index.ts'
import { createJointTargetRequest } from '@/application/motion/manual-motion-request.ts'

const homeJoints: JointAngles = [0, -25, 45, 0, 20, 0]

describe('运动基线锁定：MOVEL 回放', () => {
  it('MOVEL 指令规划结果是完整多点轨迹（playback: trajectory，单次 RAF 循环）', () => {
    const parsed = parseRapidProgram(`
MODULE BaselineTest
    CONST robtarget p := [[368.789,0,821.082],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveL p,v100,fine,tool0;
    ENDPROC
ENDMODULE`)
    expect(parsed.canExecute).toBe(true)
    const [instruction] = parsed.program.filter(isRapidMotionInstruction)
    expect(instruction).toBeDefined()

    const requestResult = buildRapidMotionRequest(instruction, 'off', homeJoints)
    expect(requestResult.ok).toBe(true)
    if (!requestResult.ok) return

    // MOVEL 的 playback 类型必须是 trajectory（不是 eased、不是 speed-limited）
    expect(requestResult.playback).toBe('trajectory')

    const planResult = planMotion(requestResult.request)
    expect(planResult.ok).toBe(true)
    if (!planResult.ok) return

    // MOVEL 规划结果应包含多个 waypoint（完整轨迹，不是单点）
    expect(planResult.waypoints.length).toBeGreaterThan(1)

    // 每个 waypoint 都有严格递增的 timeMs（单次 RAF 循环按时间插值的依据）
    for (let i = 1; i < planResult.waypoints.length; i++) {
      expect(planResult.waypoints[i].timeMs).toBeGreaterThan(planResult.waypoints[i - 1].timeMs)
    }
  })
})

describe('运动基线锁定：关节 Jog', () => {
  it('关节 Jog 是 joint-target intent（不经过 Worker 的 Cartesian IK 求解）', () => {
    const targetJoints: JointAngles = [1, -25, 45, 0, 20, 0] // 从 home 的 J1 增加 1°

    const request = createJointTargetRequest(homeJoints, targetJoints)

    // 关节 Jog 的 intent 必须是 joint-target（不是 cartesian-target）
    expect(request.intent.kind).toBe('joint-target')

    const planResult = planMotion(request)
    expect(planResult.ok).toBe(true)
    if (!planResult.ok) return

    // joint-target 规划结果是单点目标（不是多点轨迹）
    // waypoints[0] 是起点（等于 state），waypoints[1] 是终点（等于 target）
    expect(planResult.waypoints.length).toBe(2)
    expect(planResult.waypoints[0].jointsDeg).toEqual([...homeJoints])
    expect(planResult.waypoints[1].jointsDeg).toEqual([...targetJoints])
  })

  it('关节 Jog 连续点动每次 tick 提交独立的 joint-target 请求（不累积轨迹）', () => {
    // 模拟连续点动：3 次 tick，每次 J1 增加 1°
    const tick1 = createJointTargetRequest(homeJoints, [1, -25, 45, 0, 20, 0])
    const tick2 = createJointTargetRequest([1, -25, 45, 0, 20, 0], [2, -25, 45, 0, 20, 0])
    const tick3 = createJointTargetRequest([2, -25, 45, 0, 20, 0], [3, -25, 45, 0, 20, 0])

    // 每个 tick 都是独立的 joint-target 请求
    expect(tick1.intent.kind).toBe('joint-target')
    expect(tick2.intent.kind).toBe('joint-target')
    expect(tick3.intent.kind).toBe('joint-target')

    // 每个 tick 的规划结果都是独立的单步目标
    const plan1 = planMotion(tick1)
    const plan2 = planMotion(tick2)
    const plan3 = planMotion(tick3)

    expect(plan1.ok && plan1.waypoints.length).toBe(2)
    expect(plan2.ok && plan2.waypoints.length).toBe(2)
    expect(plan3.ok && plan3.waypoints.length).toBe(2)
  })
})
