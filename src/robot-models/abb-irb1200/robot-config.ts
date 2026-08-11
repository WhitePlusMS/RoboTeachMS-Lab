import type { JointAngles, RobotConfig } from '../../robotics/types.ts'

/**
 * ABB 经典 IRB 1200-5/0.9 候选标准 DH profile。
 * 几何量采用 ROS-Industrial irb1200_5_90 等价链与公开资料交叉核验结果；
 * 这不是 ABB 官方 RobotStudio 机制的标定 DH 导出。
 */
export const ABB_IRB1200_5_90_STANDARD_DH: RobotConfig = {
  name: 'ABB IRB 1200-5/0.9',
  dhParams: {
    joint1: { a: 0, alpha: -Math.PI / 2, d: 399.1, thetaRange: [-170, 170] },
    // FBX 的 J2/J3 正方向与标准 DH 的 -Z 轴相反；448/42 mm 仍由关节轴线公法线验证。
    joint2: { a: 448, alpha: 0, d: 0, thetaOffset: -Math.PI / 2, thetaSign: -1, thetaRange: [-100, 130] },
    joint3: { a: 42, alpha: -Math.PI / 2, d: 0, thetaSign: -1, thetaRange: [-200, 70] },
    joint4: { a: 0, alpha: Math.PI / 2, d: 451, thetaRange: [-270, 270] },
    // FBX 零位的 J6 轴沿 Y；J5 的 +90° 固定偏置把标准 DH 的 J6 轴由 X 转到 -Y。
    joint5: { a: 0, alpha: -Math.PI / 2, d: 0, thetaOffset: Math.PI / 2, thetaSign: -1, thetaRange: [-130, 130] },
    joint6: { a: 0, alpha: 0, d: 82, thetaSign: -1, thetaRange: [-400, 400] },
  },
  baseHeight: 399.1,
  linkColors: ['#f59e0b', '#f59e0b', '#f59e0b', '#1f2937', '#1f2937', '#1f2937'],
}

export const ABB_DEFAULT_JOINTS: JointAngles = [0, 0, 0, 0, 0, 0]
export const ABB_JOINT_RANGES = Object.values(ABB_IRB1200_5_90_STANDARD_DH.dhParams).map(
  (dh) => dh.thetaRange,
) as readonly (readonly [number, number])[]
