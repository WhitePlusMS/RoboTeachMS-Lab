import type { JointAngles, RobotConfig } from '@/robotics/types.ts'

/** KUKA-like 六轴模型的 DH 配置，长度单位毫米，控制角度单位度。 */
export const KUKA_LIKE: RobotConfig = {
  name: 'KUKA-6DOF',
  dhParams: {
    joint1: { a: 0, alpha: 0, d: 459, thetaOffset: 0, thetaSign: 1, thetaRange: [-180, 180] },
    joint2: {
      a: 354,
      alpha: -Math.PI / 2,
      d: 0,
      thetaOffset: 0,
      thetaSign: 1,
      thetaRange: [-90, 45],
    },
    joint3: { a: 941, alpha: 0, d: 0, thetaOffset: 0, thetaSign: 1, thetaRange: [-45, 90] },
    joint4: {
      a: 0,
      alpha: Math.PI / 2,
      d: 705,
      thetaOffset: -Math.PI / 2,
      thetaSign: 1,
      thetaRange: [-185, 185],
    },
    joint5: {
      a: 272,
      alpha: Math.PI / 2,
      d: 0,
      thetaOffset: 0,
      thetaSign: 1,
      thetaRange: [-50, 210],
    },
    joint6: {
      a: 0,
      alpha: -Math.PI / 2,
      d: 201,
      thetaOffset: 0,
      thetaSign: 1,
      thetaRange: [-350, 350],
    },
  },
  baseHeight: 150,
  linkColors: ['#2563EB', '#2563EB', '#2563EB', '#9CA3AF', '#9CA3AF', '#9CA3AF'],
}

export const DEFAULT_JOINTS: JointAngles = [0, 0, 0, 0, 0, 0]

export const KUKA_JOINT_RANGES = Object.values(KUKA_LIKE.dhParams).map(
  (dh) => dh.thetaRange,
) as readonly (readonly [number, number])[]
