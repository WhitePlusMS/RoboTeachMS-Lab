/** 机器人核心领域类型；不依赖 Vue、Three.js 或具体页面。 */
export interface DHParams {
  a: number
  alpha: number
  d: number
  thetaOffset?: number
  thetaSign?: 1 | -1
  thetaRange: readonly [number, number]
}

export interface RobotConfig {
  name: string
  dhParams: {
    joint1: DHParams
    joint2: DHParams
    joint3: DHParams
    joint4: DHParams
    joint5: DHParams
    joint6: DHParams
  }
  baseHeight: number
  linkColors: readonly string[]
}

/** 关节控制界面统一使用角度；DH 正解内部在入口处转换为弧度。 */
export type JointAngles = [number, number, number, number, number, number]

/** 面板展示的末端位姿；位置沿用机器人模型的毫米单位。 */
export interface PoseDisplay {
  positionMm: [number, number, number]
  orientationDeg: [number, number, number]
}

export type CoordinateSystem = 'World' | 'Tool'
export type CartesianAxis = 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz'
