import { describe, expect, it } from 'vitest'
import { createAbbDhDebugChain } from './abb-dh-debug-chain.ts'

describe('ABB DH 参考链显示轴心', () => {
  it('J5 与 J6 轴心按腕部偏移分开，J6 与法兰共点', () => {
    const chain = createAbbDhDebugChain()
    chain.update([0, 0, 0, 0, 0, 0])

    const j5 = chain.group.getObjectByName('ABB_DH_J5_Origin')
    const j6 = chain.group.getObjectByName('ABB_DH_J6_Origin')
    const flange = chain.group.getObjectByName('ABB_DH_FLANGE_Origin')

    expect(j5).not.toBeNull()
    expect(j6).not.toBeNull()
    expect(flange).not.toBeNull()
    if (!j5 || !j6 || !flange) return

    expect(j5.position.x).toBeCloseTo(0.451)
    expect(j5.position.y).toBeCloseTo(0.8891)
    expect(j6.position.x).toBeCloseTo(0.533)
    expect(j6.position.y).toBeCloseTo(0.8891)
    expect(j6.position.distanceTo(flange.position)).toBeCloseTo(0)
  })
})
