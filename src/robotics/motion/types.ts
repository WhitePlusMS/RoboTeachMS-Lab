/** 机器人关节动画参数；速度单位为度/秒，时长单位为毫秒。 */
export interface MotionConfig {
  jointSpeedLimit: number
  ikAnimDuration: number
  snapThreshold: number
}
