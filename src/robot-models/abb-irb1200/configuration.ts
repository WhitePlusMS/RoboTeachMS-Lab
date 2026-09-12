import type { JointAngles } from '@/robot-geometry/robot-types.ts'
import type { RobotConfiguration } from '@/robot-geometry/ik/ik-types.ts'

/** ABB robtarget 构型参数 [cf1, cf4, cf6, cfx]。 */
export type ABBConfiguration = [cf1: number, cf4: number, cf6: number, cfx: number]

/** ABB 构型象限：0=[0,90)，-1=[-90,0)，1=[90,180)，依此类推。 */
export function abbQuadrant(angleDeg: number): number {
  // 解析三角函数在理论 0° 附近可能产生 -1e-16°；它仍属于 cf=0，
  // 不能被浮点噪声误分到负象限。
  const stableAngle = Math.abs(angleDeg) < 1e-7 ? 0 : angleDeg
  const quadrant = Math.floor(stableAngle / 90)
  return Object.is(quadrant, -0) ? 0 : quadrant
}

/** 由解析分支的拓扑位和关节角生成 ABB 构型。 */
export function abbConfigurationFromBranch(
  jointsDeg: JointAngles,
  armBit: 0 | 1,
  elbowBit: 0 | 1,
  wristBit: 0 | 1,
): ABBConfiguration {
  return [
    abbQuadrant(jointsDeg[0]),
    abbQuadrant(jointsDeg[3]),
    abbQuadrant(jointsDeg[5]),
    (armBit << 2) | (elbowBit << 1) | wristBit,
  ]
}

/**
 * 将解析分支构型映射到某个多圈关节表示。
 * cf1/cf4/cf6 必须使用未回绕的实际角度，cfx 仍沿用解析分支的拓扑位。
 */
export function abbConfigurationForRepresentation(
  source: RobotConfiguration,
  jointsDeg: JointAngles,
): ABBConfiguration {
  return [
    abbQuadrant(jointsDeg[0]),
    abbQuadrant(jointsDeg[3]),
    abbQuadrant(jointsDeg[5]),
    source[3] ?? 0,
  ]
}
