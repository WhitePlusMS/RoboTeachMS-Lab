import { describe, expect, it } from 'vitest'
import { quaternionToRotationMatrix } from '@/robot-geometry/math/rotation3d.ts'
import { rapidQuatToInternal } from './pose-transform.ts'
import {
  defaultTool0,
  defaultWobj0,
  defaultZoneFine,
  NO_EXTERNAL_AXIS,
  RAPID_UNIT_QUAT,
  type LoadData,
  type RapidPose,
  type WobjData,
  type ZoneData,
} from './index.ts'

/**
 * RAPID 数据契约验收：四元数顺序、外部轴 9E9、各记录字段必须忠实反映 ABB 定义，
 * 而不是项目内部自定义形状。
 */
describe('RAPID 数据契约', () => {
  it('单位 RAPID 四元数 [1,0,0,0] 经 seam 转换后得到单位旋转矩阵', () => {
    const internal = rapidQuatToInternal([1, 0, 0, 0])
    expect(internal).toEqual([0, 0, 0, 1])
    const rotation = quaternionToRotationMatrix(internal)
    expect(rotation).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
  })

  it('RAPID Z 轴 90° 四元数 [cos45,0,0,sin45] 转换后得到绕 Z +90° 旋转矩阵', () => {
    const s = Math.SQRT1_2
    const internal = rapidQuatToInternal([s, 0, 0, s])
    expect(internal).toEqual([0, 0, s, s])
    const rotation = quaternionToRotationMatrix(internal)
    // 绕 Z 轴 +90°：+X → +Y。
    expect(Math.abs(rotation[0][0])).toBeLessThan(1e-9)
    expect(Math.abs(rotation[0][1] + 1)).toBeLessThan(1e-9)
    expect(Math.abs(rotation[1][0] - 1)).toBeLessThan(1e-9)
    expect(Math.abs(rotation[2][2] - 1)).toBeLessThan(1e-9)
  })

  it('RAPID 四元数顺序是 [q1,q2,q3,q4]，q1 为标量 w', () => {
    // 绕 Z 轴 90° 的姿态在 ABB 约定下 q1=cos45、q4=sin45，而不是 x/y 分量。
    const rot = rapidQuatToInternal([Math.SQRT1_2, 0, 0, Math.SQRT1_2])
    expect(rot[3]).toBeCloseTo(Math.SQRT1_2) // 内部 w 来自 RAPID q1
    expect(rot[2]).toBeCloseTo(Math.SQRT1_2) // 内部 z 来自 RAPID q4
  })

  it('LoadData 包含质量/质心/aom 四元数与主惯量 ix/iy/iz', () => {
    const load: LoadData = {
      mass: 0,
      cog: [0, 0, 0],
      aom: [...RAPID_UNIT_QUAT],
      ix: 0,
      iy: 0,
      iz: 0,
    }
    expect(load.aom).toHaveLength(4)
    expect(typeof load.ix).toBe('number')
    expect(typeof load.iy).toBe('number')
    expect(typeof load.iz).toBe('number')
  })

  it('WobjData.ufmec 为字符串，默认 wobj0 为空字符串', () => {
    const wobj: WobjData = defaultWobj0()
    expect(typeof wobj.ufmec).toBe('string')
    expect(wobj.ufmec).toBe('')
  })

  it('ZoneData 字段与 ABB zonedata 记录一致', () => {
    const zone: ZoneData = defaultZoneFine()
    const fields: Array<keyof ZoneData> = [
      'finep',
      'pzoneTcp',
      'pzoneOri',
      'pzoneEax',
      'zoneOri',
      'zoneLeax',
      'zoneReax',
    ]
    for (const field of fields) expect(field in zone).toBe(true)
    expect(zone.finep).toBe(true)
  })

  it('无外部轴常量六项均为 9E9', () => {
    expect(NO_EXTERNAL_AXIS).toEqual([9e9, 9e9, 9e9, 9e9, 9e9, 9e9])
  })

  it('默认 tool0/wobj0 的 frame 四元数均为单位 RAPID 四元数 [1,0,0,0]', () => {
    const tool = defaultTool0()
    const wobj = defaultWobj0()
    const frames: RapidPose[] = [tool.tframe, wobj.uframe, wobj.oframe]
    for (const frame of frames) expect(frame.rot).toEqual([1, 0, 0, 0])
  })
})
