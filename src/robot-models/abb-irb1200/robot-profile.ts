import type { RobotProfile } from '@/robotics/robot-profile.ts'
import { AbbDhRobotModel } from './dh-robot-model.ts'
import {
  ABB_MECHANICAL_ZERO_JOINTS,
  ABB_IRB1200_5_90_STANDARD_DH,
  ABB_JOINT_RANGES,
  ABB_TEACHING_HOME_JOINTS,
} from './robot-config.ts'

/**
 * ABB IRB 1200-5/0.9 唯一运行契约。
 * 直接复用既有型号名称、一体 DH 模型、关节范围与两种标准姿态，不复制任何数值，也不建立第二份配置。
 */
export const ABB_IRB1200_PROFILE: RobotProfile = {
  id: 'abb-irb1200-5-0.9',
  displayName: ABB_IRB1200_5_90_STANDARD_DH.name,
  model: new AbbDhRobotModel(),
  jointRanges: ABB_JOINT_RANGES,
  homeJoints: ABB_TEACHING_HOME_JOINTS,
  mechanicalZeroJoints: ABB_MECHANICAL_ZERO_JOINTS,
}
