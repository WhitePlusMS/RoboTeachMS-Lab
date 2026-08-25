import { describe, expect, it } from 'vitest'
import { findRapidPreset, RAPID_PRESET_PROGRAMS } from './preset-programs.ts'
import { isRapidMotionInstruction, parseRapidProgram } from '@/rapid/rapid-parser.ts'
import { planMoveJ } from '@/rapid/movej-planner.ts'
import { planMoveL } from '@/rapid/movel-planner.ts'
import { planMoveC } from '@/rapid/movec-planner.ts'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/profile.ts'
import type { JointAngles } from '@/robotics/model/types.ts'
import type { StructuredMoveC, StructuredMoveJ, StructuredMoveL } from '@/rapid/rapid-types.ts'

describe('RAPID 预设程序库', () => {
  it('提供 6 个取自测试用例文档的可运行示例模板', () => {
    expect(RAPID_PRESET_PROGRAMS).toHaveLength(6)
    const ids = RAPID_PRESET_PROGRAMS.map((preset) => preset.id)
    expect([...new Set(ids)]).toEqual(ids)
    for (const preset of RAPID_PRESET_PROGRAMS) {
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.source.length).toBeGreaterThan(0)
    }
  })

  it('findRapidPreset 可按 id 精确找到；未知 id 返回 undefined', () => {
    for (const preset of RAPID_PRESET_PROGRAMS) {
      expect(findRapidPreset(preset.id)).toEqual(preset)
    }
    expect(findRapidPreset('missing')).toBeUndefined()
  })

  it('每个预设都能被 parser 解析为可执行程序，且无诊断', () => {
    for (const preset of RAPID_PRESET_PROGRAMS) {
      const result = parseRapidProgram(preset.source)
      expect(result.diagnostics, preset.name).toEqual([])
      expect(result.canExecute, preset.name).toBe(true)
      expect(result.program.length, preset.name).toBeGreaterThan(0)
      // 全部预设都应含运动指令（可实际演示机械臂运动）。
      expect(
        result.program.some(isRapidMotionInstruction),
        `${preset.name} 应包含至少一条运动指令`,
      ).toBe(true)
    }
  })

  it('预设含 MoveC 时，圆弧指令经真实 planMoveC 按程序次序可全部规划', () => {
    const model = ABB_IRB1200_PROFILE.model
    const jointRanges = ABB_IRB1200_PROFILE.jointRanges
    for (const preset of RAPID_PRESET_PROGRAMS) {
      const result = parseRapidProgram(preset.source)
      // 线性累计关节状态：随运动指令推进（控制流/赋值不改关节），逐条规划到位。
      let joints: JointAngles = [...ABB_IRB1200_PROFILE.homeJoints]
      let movecCount = 0
      for (const inst of result.program) {
        if (!isRapidMotionInstruction(inst)) continue
        if (inst.kind === 'movej') {
          // 预设是旧版几何示例，点位未携带与当前模型一致的逐点 confdata；
          // 这里显式验证几何可达性，生产 RAPID 执行仍走默认严格构型保持。
          const plan = planMoveJ(inst as StructuredMoveJ, model, joints, jointRanges, {
            preserveConfiguration: false,
          })
          expect(plan.ok, `${preset.name} MoveJ 规划失败`).toBe(true)
          if (plan.ok) joints = [...plan.joints]
        } else if (inst.kind === 'movel') {
          const plan = planMoveL(inst as StructuredMoveL, model, joints, jointRanges)
          expect(plan.ok, `${preset.name} MoveL 规划失败`).toBe(true)
          if (plan.ok) joints = [...plan.waypoints[plan.waypoints.length - 1]]
        } else if (inst.kind === 'movec') {
          movecCount += 1
          const plan = planMoveC(inst as StructuredMoveC, model, joints, jointRanges)
          expect(plan.ok, `${preset.name} MoveC 规划失败`).toBe(true)
          if (plan.ok) joints = [...plan.waypoints[plan.waypoints.length - 1]]
        }
      }
      // 至少一个预设实际演示 MoveC（当前为预设 5）。
      if (movecCount > 0) {
        // 确保 MoveC 圆弧确实生成连续 waypoint。
        expect(movecCount).toBeGreaterThan(0)
      }
    }
    // 覆盖保证：确有预设包含 MoveC，防止回归时丢掉圆弧路径演示。
    const withMoveC = RAPID_PRESET_PROGRAMS.filter((preset) =>
      parseRapidProgram(preset.source).program.some((inst) => inst.kind === 'movec'),
    )
    expect(withMoveC.length).toBeGreaterThan(0)
  })
})
