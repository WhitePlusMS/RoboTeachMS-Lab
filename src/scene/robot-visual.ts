import { DEFAULT_ROBOT } from '@/robot-models/registry.ts'
import { ABB_IRB1200_PROFILE } from '@/robot-models/abb-irb1200/profile.ts'
import { IRB1200_VISUAL } from '@/robot-models/abb-irb1200/visual-profile.ts'

/** 固定单机型宿主的视觉装配。增加机型时只在此处补对应资产映射。 */
function selectVisual() {
  if (DEFAULT_ROBOT.id === ABB_IRB1200_PROFILE.id) return IRB1200_VISUAL
  throw new Error(`没有为机型 ${DEFAULT_ROBOT.id} 装配视觉映射`)
}
export const DEFAULT_ROBOT_VISUAL = selectVisual()
