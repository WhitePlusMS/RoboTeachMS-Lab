/**
 * Cartesian waypoint 的连续性策略常量。
 *
 * 候选图与 waypoint 解算共同使用这组策略；将它们放在独立模块中，
 * 避免一个算法实现为了复用常量而反向依赖另一个算法实现。
 */
export const MAX_CARTESIAN_JOINT_STEP_DEG = 5
export const MAX_ADAPTIVE_JOINT_STEP_DEG = MAX_CARTESIAN_JOINT_STEP_DEG * 2
