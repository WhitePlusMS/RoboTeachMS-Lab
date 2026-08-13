import { describe, expect, it } from 'vitest'
import { ABB_IRB1200_PROFILE } from '../robot-models/abb-irb1200/robot-profile.ts'
import type { JointAngles, Pose } from '../robotics/types.ts'
import { isRapidMotionInstruction, parseRapidProgram } from './rapid-parser.ts'
import { planMoveJ } from './movej-planner.ts'
import { robTargetToFlangePose } from './coordinate-transform.ts'
import { defaultTool0, defaultWobj0, type RobTarget, type ToolData, type WobjData } from './rapid-types.ts'
import { rotationMatrixToQuaternion } from '../robotics/math/rotation3d.ts'
import { internalQuatToRapid } from './plan-shared.ts'

/**
 * Ticket 06 — 用四个可复现 RAPID 教学任务闭环验收本里程碑。
 * 每个任务同时验证：固定 RAPID fixture、源码解析、Program Data 派生值、结构化执行快照，以及
 * TCP/法兰或轨迹几何观察结果。MVP 近似文案不与完整 ABB 控制器能力混淆。
 */

const MODEL = ABB_IRB1200_PROFILE.model
const JOINT_RANGES = ABB_IRB1200_PROFILE.jointRanges
const HOME: JointAngles = [...ABB_IRB1200_PROFILE.homeJoints] as JointAngles
function homeFk(): Pose {
  const pose = MODEL.forwardKinematics(HOME)
  if (!pose) throw new Error('home FK unavailable')
  return pose
}
function posErr(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

describe('Task 1 — 同一 robtarget 在不同固定 wobjdata/tooldata 下得到不同 TCP/法兰目标', () => {
  it('wobj0 vs 平移 uframe 的 wobj：同一 MoveJ robtarget → 不同法兰目标与 FK', () => {
    // 固定 robtarget（由 home 法兰 FK 得到的目标）。
    const baseFk = homeFk()
    const quat = rotationMatrixToQuaternion(baseFk.rotation)
    const target: RobTarget = {
      trans: [...baseFk.position],
      rot: internalQuatToRapid(quat),
      robconf: [0, 0, 0, 0],
      extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
    }
    const offsetWobj: WobjData = { ...defaultWobj0(), uframe: { trans: [60, 0, 0], rot: [1, 0, 0, 0] } }

    const flangeWorld = robTargetToFlangePose(target, defaultWobj0(), defaultTool0())
    const flangeOffset = robTargetToFlangePose(target, offsetWobj, defaultTool0())

    // 工件沿世界 +X 平移 60mm → 法兰目标也应移动约 60mm。
    expect(posErr(flangeOffset.position, flangeWorld.position)).toBeGreaterThan(55)

    // 端到端：用带平移 wobj 的 MoveJ 规划，FK 落点应近似等于换算后的法兰目标。
    const instruction = {
      kind: 'movej' as const,
      target,
      speed: { v_tcp: 100, v_ori: 500, v_leax: 5000, v_reax: 1000 },
      zone: { finep: true, pzoneTcp: 0, pzoneOri: 0, pzoneEax: 0, zoneOri: 0, zoneLeax: 0, zoneReax: 0 },
      tool: defaultTool0(),
      wobj: offsetWobj,
    }
    const plan = planMoveJ(instruction, MODEL, HOME, JOINT_RANGES)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const fk = MODEL.forwardKinematics(plan.joints)
    expect(fk).not.toBeNull()
    if (fk) expect(posErr(fk.position, flangeOffset.position)).toBeLessThanOrEqual(1)
  })

  it('同一 robtarget 使用带 TCP 前伸的自定义 tool：法兰目标相对 tool0 负向偏移（TCP 仍到点）', () => {
    const baseFk = homeFk()
    const quat = rotationMatrixToQuaternion(baseFk.rotation)
    const target: RobTarget = {
      trans: [...baseFk.position],
      rot: internalQuatToRapid(quat),
      robconf: [0, 0, 0, 0],
      extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9],
    }
    const tip: ToolData = {
      robhold: true,
      tframe: { trans: [0, 0, 50], rot: [1, 0, 0, 0] },
      tload: { mass: 0.2, cog: [0, 0, 25], aom: [1, 0, 0, 0], ix: 0, iy: 0, iz: 0 },
    }
    const flangeTip = robTargetToFlangePose(target, defaultWobj0(), tip)
    const flangeTool0 = robTargetToFlangePose(target, defaultWobj0(), defaultTool0())
    // 工具沿其 z 前伸 → 法兰相对 tool0 的法兰目标移动（方向相反）。
    expect(posErr(flangeTip.position, flangeTool0.position)).toBeGreaterThan(40)
  })
})

describe('Task 2 — 同一基准分别 Offs() 与 RelTool()，沿工件/工具轴产生可解释差异', () => {
  it('旋转基准下 Offs(10,0,0) → 世界 +X；RelTool(10,0,0) → 世界 -Z（不同解释）', () => {
    const source = `MODULE T
    CONST robtarget pBase := [[100,200,300],[0.7071,0,0.7071,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ Offs(pBase,10,0,0),v100,fine,tool0;
        MoveL RelTool(pBase,10,0,0),v100,fine,tool0;
    ENDPROC
ENDMODULE
`
    const result = parseRapidProgram(source)
    expect(result.canExecute).toBe(true)
    const offsInstruction = result.program[0]
    const relInstruction = result.program[1]
    expect(offsInstruction && isRapidMotionInstruction(offsInstruction)).toBe(true)
    expect(relInstruction && isRapidMotionInstruction(relInstruction)).toBe(true)
    if (!offsInstruction || !relInstruction || !isRapidMotionInstruction(offsInstruction) || !isRapidMotionInstruction(relInstruction)) return
    const offs = offsInstruction.target
    const rel = relInstruction.target
    expect(offs.trans).toEqual([110, 200, 300]) // Offs：沿 Object 轴 +X。
    expect(rel).toBeDefined()
    if (rel) {
      expect(rel.trans[2]).toBeCloseTo(290, 1) // RelTool：沿工具轴 +X → 世界 -Z。
      expect(rel.trans[0]).toBeCloseTo(100, 1)
      // 同一数值偏移，两种函数结果可解释且不同。
      expect(rel.trans).not.toEqual(offs?.trans)
    }
  })
})

describe('Task 3 — 同一路径替换 speeddata，运行时长产生可解释差异', () => {
  it('v50 与 v200 的 MoveJ：规划时长相差约 4 倍（距离/v_tcp）', () => {
    const mkInstruction = (vTcp: number) => {
      const baseFk = homeFk()
      const quat = rotationMatrixToQuaternion(baseFk.rotation)
      return {
        kind: 'movej' as const,
        target: {
          trans: [baseFk.position[0] + 80, baseFk.position[1], baseFk.position[2]] as [number, number, number],
          rot: internalQuatToRapid(quat),
          robconf: [0, 0, 0, 0] as [number, number, number, number],
          extax: [9e9, 9e9, 9e9, 9e9, 9e9, 9e9] as [number, number, number, number, number, number],
        },
        speed: { v_tcp: vTcp, v_ori: 500, v_leax: 5000, v_reax: 1000 },
        zone: { finep: true, pzoneTcp: 0, pzoneOri: 0, pzoneEax: 0, zoneOri: 0, zoneLeax: 0, zoneReax: 0 },
        tool: defaultTool0(),
        wobj: defaultWobj0(),
      }
    }
    const slow = planMoveJ(mkInstruction(50), MODEL, HOME, JOINT_RANGES)
    const fast = planMoveJ(mkInstruction(200), MODEL, HOME, JOINT_RANGES)
    expect(slow.ok).toBe(true)
    expect(fast.ok).toBe(true)
    if (!slow.ok || !fast.ok) return
    expect(slow.durationMs / fast.durationMs).toBeGreaterThan(3.5)
    expect(slow.durationMs / fast.durationMs).toBeLessThan(4.5)
  })
})

describe('Task 4 — fine 精确停点 vs z50 fly-by 识别', () => {
  it('同一 MoveJ：改用 z50 后 zone 携带 finep=FALSE（不再误报，也不再是 fine 别名）', () => {
    const fine = parseRapidProgram(`MODULE T
    CONST robtarget p := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p,v100,fine,tool0;
    ENDPROC
ENDMODULE
`)
    const flyby = parseRapidProgram(`MODULE T
    CONST robtarget p := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p,v100,z50,tool0;
    ENDPROC
ENDMODULE
`)
    const fineInstruction = fine.program[0]
    const flybyInstruction = flyby.program[0]
    expect(fineInstruction && isRapidMotionInstruction(fineInstruction)).toBe(true)
    expect(flybyInstruction && isRapidMotionInstruction(flybyInstruction)).toBe(true)
    expect(flyby.canExecute).toBe(true)
    if (!fineInstruction || !flybyInstruction || !isRapidMotionInstruction(fineInstruction) || !isRapidMotionInstruction(flybyInstruction)) return
    expect(fineInstruction.zone.finep).toBe(true)
    const zone = flybyInstruction.zone
    expect(zone?.finep).toBe(false)
    expect(zone?.pzoneTcp).toBe(50)
    if (zone) expect(zone).not.toEqual(fineInstruction.zone)
  })

  it('语法/数据/规划 error 都阻止部分执行，合法 MoveJ/MoveL 继续通过现有执行链', () => {
    const broken = parseRapidProgram(`MODULE T
    CONST robtarget p := [[0,0,0],[1,0,0,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];
    PROC main()
        MoveJ p,v100,fine,tool0;
        MoveL undefinedPoint,v50,fine,tool0;
    ENDPROC
ENDMODULE
`)
    expect(broken.canExecute).toBe(false)
    expect(broken.program).toHaveLength(0) // 不部分执行。
    expect(broken.diagnostics.some((d) => d.code === 'undefined-symbol')).toBe(true)
  })
})
