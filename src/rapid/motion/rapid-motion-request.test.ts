import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/index.ts'
import { parseRapidProgram, isRapidMotionInstruction } from '../language/index.ts'
import { buildRapidMotionRequest } from './rapid-motion-request.ts'

describe('RAPID motion request adapter', () => {
  it('只把 MoveJ/MoveL/MoveC 转换为强类型 Core request，不执行规划', () => {
    const parsed = parseRapidProgram(`
MODULE RequestTest
    CONST robtarget p := [[368.789,0,821.082],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p,v100,fine,tool0;
        MoveL p,v100,fine,tool0;
    ENDPROC
ENDMODULE`)
    expect(parsed.canExecute).toBe(true)
    const instructions = parsed.program.filter(isRapidMotionInstruction)
    expect(instructions).toHaveLength(2)
    for (const instruction of instructions) {
      const result = buildRapidMotionRequest(instruction, 'off', [
        ...ABB_IRB1200_PROFILE.homeJoints,
      ])
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.request.intent.kind).toBe(
          instruction.kind === 'movej' ? 'pose-joint-target' : 'linear-path',
        )
        expect(result.request.state.jointsDeg).toEqual(ABB_IRB1200_PROFILE.homeJoints)
      }
    }
  })
})
