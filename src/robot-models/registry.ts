import type { RobotProfile } from '@/robot-geometry/robot-types.ts'
import { ABB_IRB1200_PROFILE } from './abb-irb1200/profile.ts'

/** 当前仅装配一个真实机型；Web 与 Worker 使用同一注册表，不提供界面选择入口。 */
export const DEFAULT_ROBOT = ABB_IRB1200_PROFILE
const profiles: readonly RobotProfile[] = [DEFAULT_ROBOT]
export function resolveRobotProfile(identity: {
  modelId: string
  modelRevision: string
}): RobotProfile | undefined {
  return profiles.find(
    (profile) => profile.id === identity.modelId && profile.revision === identity.modelRevision,
  )
}
export function robotIdentity(profile: RobotProfile) {
  return { modelId: profile.id, modelRevision: profile.revision }
}
