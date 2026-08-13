import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '../robot-models/abb-irb1200/robot-profile.ts'
import type { JointAngles } from '../robotics/types.ts'
import { planMoveJ } from './movej-planner.ts'
import { planMoveL } from './movel-planner.ts'
import { isRapidMotionInstruction, parseRapidProgram } from './rapid-parser.ts'
import {
  defaultTool0,
  defaultWobj0,
  defaultZoneFine,
  type RobTarget,
  type SpeedData,
  type ToolData,
  type WobjData,
  type ZoneData,
} from './rapid-types.ts'

/**
 * Ticket 04 — SpeedData 与 ZoneData 运行边界。
 * 验证 v_tcp 真实影响时长、fine 停点与 fly-by 识别的区分，以及非法速度/zone 的精确诊断。
 */

const MODEL = ABB_IRB1200_PROFILE.model
const JOINT_RANGES = ABB_IRB1200_PROFILE.jointRanges
const HOME: JointAngles = [...ABB_IRB1200_PROFILE.homeJoints] as JointAngles

// 可达的 robtarget：从 HOME 水平 +X 平移 80mm（MoveJ/MoveL 均平滑可达）。
const TARGET: RobTarget = {
  trans: [531, 0, 807.1],
  rot: [1, 0, 0, 0],
  robconf: [0, 0, 0, 0],
  extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
}

function mk(target: RobTarget, speed: SpeedData, zone: ZoneData, tool: ToolData = defaultTool0(), wobj: WobjData = defaultWobj0()) {
  return { kind: 'movej' as const, target, speed, zone, tool, wobj }
}
function movej(target: RobTarget, speed: SpeedData, zone: ZoneData) {
  return planMoveJ(mk(target, speed, zone), MODEL, HOME, JOINT_RANGES)
}

describe('Ticket 04 — v_tcp 真实影响规划/执行时长', () => {
  it('同一目标只替换 v_tcp，时长随速度反比变化（不再固定动画时长）', () => {
    const slow = movej(TARGET, { v_tcp: 50, v_ori: 500, v_leax: 5000, v_reax: 1000 }, defaultZoneFine())
    const fast = movej(TARGET, { v_tcp: 200, v_ori: 500, v_leax: 5000, v_reax: 1000 }, defaultZoneFine())
    expect(slow.ok).toBe(true)
    expect(fast.ok).toBe(true)
    if (!slow.ok || !fast.ok) return
    // 距离 / v_tcp：v50 的时长约为 v200 的 4 倍。
    expect(fast.durationMs).toBeGreaterThan(0)
    expect(slow.durationMs / fast.durationMs).toBeGreaterThan(3.5)
    expect(slow.durationMs / fast.durationMs).toBeLessThan(4.5)
  })

  it('MoveL 亦按 v_tcp 反比计算时长', () => {
    const mkL = (s: SpeedData) => ({ kind: 'movel' as const, target: TARGET, speed: s, zone: defaultZoneFine(), tool: defaultTool0(), wobj: defaultWobj0() })
    const slowL = planMoveL(mkL({ v_tcp: 60, v_ori: 500, v_leax: 5000, v_reax: 1000 }), MODEL, HOME, JOINT_RANGES)
    const fastL = planMoveL(mkL({ v_tcp: 240, v_ori: 500, v_leax: 5000, v_reax: 1000 }), MODEL, HOME, JOINT_RANGES)
    expect(slowL.ok).toBe(true)
    expect(fastL.ok).toBe(true)
    if (!slowL.ok || !fastL.ok) return
    expect(slowL.durationMs / fastL.durationMs).toBeGreaterThan(3.5)
  })
})

describe('Ticket 04 — fine 与 fly-by zone 的正确识别', () => {
  const ZONES = ['z0', 'z1', 'z5', 'z10', 'z15', 'z20', 'z30', 'z40', 'z50', 'z60', 'z80', 'z100', 'z150', 'z200']

  it('z0..z200 均识别为官方 fly-by（非 fine、非语法错误），并携带 zone 数据', () => {
    for (const name of ZONES) {
      const source = `MODULE T\n    CONST robtarget p := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n    PROC main()\n        MoveJ p,v100,${name},tool0;\n    ENDPROC\nENDMODULE\n`
      const result = parseRapidProgram(source)
      expect(result.diagnostics.some((d) => d.code === 'unsupported-syntax')).toBe(false)
      expect(result.diagnostics.some((d) => d.code === 'undefined-symbol')).toBe(false)
      const inst = result.program[0]
      expect(inst).toBeDefined()
      if (inst && isRapidMotionInstruction(inst)) {
        expect(inst.zone.finep).toBe(false) // 非 fine，不是 fine 别名。
        expect(inst.zone).not.toBe(defaultZoneFine())
      }
    }
  })

  it('fine 保持精确停点语义（finep=true、其余 zone 数值为零）', () => {
    const result = parseRapidProgram(`MODULE T\n    CONST robtarget p := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n    PROC main()\n        MoveJ p,v100,fine,tool0;\n    ENDPROC\nENDMODULE\n`)
    const inst = result.program[0]
    expect(inst && isRapidMotionInstruction(inst) ? inst.zone.finep : undefined).toBe(true)
    if (inst && isRapidMotionInstruction(inst)) {
      expect(inst.zone.pzoneTcp).toBe(0)
      expect(inst.zone.zoneOri).toBe(0)
    }
  })
})

describe('Ticket 04 — 非法速度/zone 精确诊断并阻止执行', () => {
  function parse(body: string) {
    return parseRapidProgram(`MODULE T\n    CONST robtarget p := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n    PROC main()\n${body}    ENDPROC\nENDMODULE\n`)
  }

  it('未定义速度名（v999）报 undefined-symbol 并阻止执行', () => {
    const result = parse('        MoveJ p,v999,z10,tool0;\n')
    expect(result.diagnostics.some((d) => d.code === 'undefined-symbol' && d.message.includes('v999'))).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('未定义 zone 名（z77）报 undefined-symbol 并阻止执行', () => {
    const result = parse('        MoveJ p,v100,z77,tool0;\n')
    expect(result.diagnostics.some((d) => d.code === 'undefined-symbol' && d.message.includes('z77'))).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('非法 zone 记录（长度错误）报 invalid-data 并阻止执行', () => {
    const result = parseRapidProgram(`MODULE T\n    CONST zonedata bad := [FALSE,100];\n    CONST robtarget p := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n    PROC main()\n        MoveJ p,v100,z10,tool0;\n    ENDPROC\nENDMODULE\n`)
    expect(result.diagnostics.some((d) => d.code === 'invalid-data')).toBe(true)
    expect(result.canExecute).toBe(false)
  })

  it('非法速度记录（v_tcp 非正）在规划层被 invalid-data 拦截', () => {
    const bad = movej(TARGET, { v_tcp: -5, v_ori: 500, v_leax: 5000, v_reax: 1000 }, defaultZoneFine())
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.kind).toBe('invalid-data')
  })
})
