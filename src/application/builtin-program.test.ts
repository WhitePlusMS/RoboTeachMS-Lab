import { describe, expect, it } from 'vitest'
import { createBuiltinRapidSource } from './builtin-program.ts'
import { AbbDhRobotModel } from '../robot-models/abb-irb1200/dh-robot-model.ts'
import { ABB_JOINT_RANGES } from '../robot-models/abb-irb1200/robot-config.ts'
import { planMoveJ } from '../rapid/movej-planner.ts'
import { planMoveL } from '../rapid/movel-planner.ts'
import { isDefaultTool0, isDefaultWobj0 } from '../rapid/rapid-types.ts'
import type { JointAngles } from '../robotics/types.ts'
import { parseRapidProgram } from '../rapid/rapid-parser.ts'

describe('页面默认 RAPID 源程序', () => {
  it('固定三条 MoveJ → MoveL → MoveJ，全部使用 tool0/wobj0/fine、无外部轴', () => {
    const result = parseRapidProgram(createBuiltinRapidSource())
    expect(result.diagnostics).toEqual([])
    const program = result.program
    expect(program).toHaveLength(3)
    expect(program.map((inst) => inst.kind)).toEqual(['movej', 'movel', 'movej'])
    for (const inst of program) {
      expect(inst.zone.finep).toBe(true)
      expect(isDefaultTool0(inst.tool)).toBe(true)
      expect(isDefaultWobj0(inst.wobj)).toBe(true)
    }
  })

  it('按真实程序顺序逐条可达：用上一条规划终点作为下一条起点', () => {
    const model = new AbbDhRobotModel()
    const result = parseRapidProgram(createBuiltinRapidSource())
    expect(result.canExecute).toBe(true)
    const program = result.program
    const [first, second, third] = program
    if (!first || !second || !third || first.kind !== 'movej' || second.kind !== 'movel' || third.kind !== 'movej') {
      throw new Error('内置程序结构异常，应为 MoveJ → MoveL → MoveJ')
    }

    let joints: JointAngles = [0, 0, 0, 0, 0, 0]
    const moveJ = planMoveJ(first, model, joints, ABB_JOINT_RANGES)
    expect(moveJ.ok, `指令 0 (${first.target.trans}) 规划失败`).toBe(true)
    if (!moveJ.ok) return
    joints = moveJ.joints

    const moveL = planMoveL(second, model, joints, ABB_JOINT_RANGES)
    expect(moveL.ok, '指令 1 (MoveL 下降) 从第一条终点规划失败').toBe(true)
    if (!moveL.ok) return
    joints = [...moveL.waypoints[moveL.waypoints.length - 1]]

    const moveJFinal = planMoveJ(third, model, joints, ABB_JOINT_RANGES)
    expect(moveJFinal.ok, '指令 2 (MoveJ 返回) 从第二条终点规划失败').toBe(true)
  })
})
