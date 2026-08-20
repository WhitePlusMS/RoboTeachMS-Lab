import type { SixAxisJointRanges } from '@/robotics/robot-profile.ts'
import type { JointAngles, RobotConfig } from '@/robotics/types.ts'

/**
 * ABB 经典 IRB 1200-5/0.9 候选标准 DH profile。
 * 几何量采用 ROS-Industrial irb1200_5_90 等价链与公开资料交叉核验结果；
 * 这不是 ABB 官方 RobotStudio 机制的标定 DH 导出。
 */
export const ABB_IRB1200_5_90_STANDARD_DH: RobotConfig = {
  name: 'ABB IRB 1200-5/0.9',
  dhParams: {
    joint1: { a: 0, alpha: -Math.PI / 2, d: 399.1, thetaRange: [-170, 170] },
    // 关节输入统一采用 ABB/DH 正方向；FBX 局部轴的方向差异只在场景适配层处理。
    // 448/42 mm 仍由关节轴线公法线验证。
    joint2: {
      a: 448,
      alpha: 0,
      d: 0,
      thetaOffset: -Math.PI / 2,
      thetaSign: 1,
      thetaRange: [-100, 130],
    },
    joint3: { a: 42, alpha: -Math.PI / 2, d: 0, thetaSign: 1, thetaRange: [-200, 70] },
    joint4: { a: 0, alpha: Math.PI / 2, d: 451, thetaRange: [-270, 270] },
    // J5 零位不附加角偏置：此时 J6/法兰径向与 J4 轴线同向，符合腕部零位几何关系。
    joint5: {
      a: 0,
      alpha: -Math.PI / 2,
      d: 0,
      thetaSign: 1,
      thetaRange: [-130, 130],
    },
    joint6: { a: 0, alpha: 0, d: 82, thetaSign: 1, thetaRange: [-400, 400] },
  },
  baseHeight: 399.1,
  linkColors: ['#f59e0b', '#f59e0b', '#f59e0b', '#1f2937', '#1f2937', '#1f2937'],
}

export const ABB_DEFAULT_JOINTS: JointAngles = [0, 0, 0, 0, 0, 0]

/**
 * 六轴关节范围在源头声明为严格六元 tuple，由六个具名 DH 关节的 thetaRange 显式构造。
 * 数值来自 ABB Product specification IRB 1200（3HAC081417-001）中经典
 * IRB 1200-5/0.9 的 Working range 表；不可替换为 IRB 1200 Gen2 的轴范围。
 * 删除任一关节项会立即产生 TypeScript 编译错误，范围数值仍只存在于 DH 配置的单一来源。
 */
export const ABB_JOINT_RANGES: SixAxisJointRanges = [
  ABB_IRB1200_5_90_STANDARD_DH.dhParams.joint1.thetaRange,
  ABB_IRB1200_5_90_STANDARD_DH.dhParams.joint2.thetaRange,
  ABB_IRB1200_5_90_STANDARD_DH.dhParams.joint3.thetaRange,
  ABB_IRB1200_5_90_STANDARD_DH.dhParams.joint4.thetaRange,
  ABB_IRB1200_5_90_STANDARD_DH.dhParams.joint5.thetaRange,
  ABB_IRB1200_5_90_STANDARD_DH.dhParams.joint6.thetaRange,
]
