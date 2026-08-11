import { describe, expect, it } from 'vitest'
import { ABB_DEFAULT_JOINTS, ABB_IRB1200_5_90_STANDARD_DH, ABB_JOINT_RANGES } from './robot-config'

describe('ABB IRB 1200-5/0.9 profile', () => {
  it('使用官方手册的六轴关节范围', () => {
    expect(ABB_JOINT_RANGES).toEqual([[-170, 170], [-100, 130], [-200, 70], [-270, 270], [-130, 130], [-400, 400]])
  })

  it('保留报告中 5/0.9 URDF 等价链映射后的 DH 候选长度', () => {
    const dh = ABB_IRB1200_5_90_STANDARD_DH.dhParams
    expect([dh.joint1.d, dh.joint2.a, dh.joint3.a, dh.joint4.d, dh.joint6.d]).toEqual([399.1, 448, 42, 451, 82])
    expect(dh.joint2.thetaOffset).toBeCloseTo(-Math.PI / 2)
    expect(dh.joint5.thetaOffset).toBeCloseTo(Math.PI / 2)
    expect(Object.values(dh).map((joint) => joint.thetaSign ?? 1)).toEqual([1, -1, -1, 1, -1, -1])
    expect(ABB_DEFAULT_JOINTS).toEqual([0, 0, 0, 0, 0, 0])
  })
})
