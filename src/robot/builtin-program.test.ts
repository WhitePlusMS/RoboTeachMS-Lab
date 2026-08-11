import { describe, expect, it } from 'vitest'
import { createBuiltinProgram } from './builtin-program'
import { AbbDhRobotModel } from '../robots/abb-irb1200/dh-robot-model'
import { ABB_JOINT_RANGES } from '../robots/abb-irb1200/robot-config'
import { planMoveJ } from '../core/rapid/movej-planner'
import { planMoveL } from '../core/rapid/movel-planner'
import type { JointAngles } from '../core/robot/types'

describe('页面内置演示程序', () => {
  it('全部目标点经 ABB 模型规划均可达（MoveJ/MoveL 交替、含 90° 放件姿态）', () => {
    const model = new AbbDhRobotModel()
    const joints: JointAngles = [0, 0, 0, 0, 0, 0]
    const program = createBuiltinProgram()
    for (const inst of program) {
      if (inst.kind === 'movej') {
        const result = planMoveJ(inst, model, joints, ABB_JOINT_RANGES)
        expect(result.ok, JSON.stringify(inst.target.trans)).toBe(true)
      } else {
        const result = planMoveL(inst, model, joints, ABB_JOINT_RANGES)
        expect(result.ok, JSON.stringify(inst.target.trans)).toBe(true)
      }
    }
  })
})
