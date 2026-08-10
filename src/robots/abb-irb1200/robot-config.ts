import type { JointAngles, RobotConfig } from '../../core/robot/types'

/**
 * ABB 经典 IRB 1200-5/0.9 候选标准 DH profile。
 * 几何量采用 ROS-Industrial irb1200_5_90 等价链与公开资料交叉核验结果；
 * 这不是 ABB 官方 RobotStudio 机制的标定 DH 导出。
 */
export const ABB_IRB1200_5_90_STANDARD_DH: RobotConfig = {
  name: 'ABB IRB 1200-5/0.9',
  dhParams: {
    joint1: { a: 0, alpha: -Math.PI / 2, d: 399.1, thetaRange: [-170, 170] },
    // 报告中的 URDF 0.448 m 偏移，经当前标准 DH 坐标约定映射为 a=448 mm。
    joint2: { a: 448, alpha: 0, d: 0, thetaOffset: -Math.PI / 2, thetaRange: [-100, 130] },
    joint3: { a: 42, alpha: -Math.PI / 2, d: 0, thetaRange: [-200, 70] },
    joint4: { a: 0, alpha: Math.PI / 2, d: 451, thetaRange: [-270, 270] },
    joint5: { a: 0, alpha: -Math.PI / 2, d: 0, thetaRange: [-130, 130] },
    joint6: { a: 0, alpha: 0, d: 82, thetaRange: [-400, 400] },
  },
  baseHeight: 399.1,
  linkColors: ['#f59e0b', '#f59e0b', '#f59e0b', '#1f2937', '#1f2937', '#1f2937'],
}

export const ABB_DEFAULT_JOINTS: JointAngles = [0, 0, 0, 0, 0, 0]
export const ABB_JOINT_RANGES = Object.values(ABB_IRB1200_5_90_STANDARD_DH.dhParams).map(
  (dh) => dh.thetaRange,
) as readonly (readonly [number, number])[]
