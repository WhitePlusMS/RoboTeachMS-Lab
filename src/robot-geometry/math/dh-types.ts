/** DH 参数和机器人几何配置；具体数值由厂家 model parameters 提供。 */
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
