import type { RobotProfile } from '@/robot-geometry/robot-types.ts'
import { AbbRobotModelAdapter } from './abb-robot-model-adapter.ts'
import {
  ABB_MECHANICAL_ZERO_JOINTS,
  ABB_IRB1200_5_90_STANDARD_DH,
  ABB_JOINT_RANGES,
  ABB_TEACHING_HOME_JOINTS,
} from './parameters.ts'

/**
 * ABB IRB 1200-5/0.9 唯一运行契约。
 * 直接复用既有型号名称、一体 DH 模型、关节范围与两种标准姿态，不复制任何数值，也不建立第二份配置。
 */
export const ABB_IRB1200_PROFILE: RobotProfile = {
  id: 'abb-irb1200-5-0.9',
  revision: 'dh-standard-v1',
  displayName: ABB_IRB1200_5_90_STANDARD_DH.name,
  model: new AbbRobotModelAdapter(),
  jointRanges: ABB_JOINT_RANGES,
  homeJoints: ABB_TEACHING_HOME_JOINTS,
  mechanicalZeroJoints: ABB_MECHANICAL_ZERO_JOINTS,
}
