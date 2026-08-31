import type { MotionError } from '@/robot-motion-core/index.ts'

export interface HostMotionErrorPresentation {
  readonly title: string
  readonly message: string
  readonly recovery: string
}

export function presentMotionError(error: MotionError): HostMotionErrorPresentation {
  switch (error.code) {
    case 'invalid-request': return { title: '运动请求无效', message: '运动参数不完整或包含非法数值。', recovery: '检查目标、Tool/WObj 和关节数组后重试。' }
    case 'unsupported-capability': return { title: '运动能力暂不支持', message: '当前请求超出已验收的运动能力范围。', recovery: '改用 fine、支持的构型或显式授权的奇异策略。' }
    case 'configuration-unreachable': return { title: '目标构型不可达', message: '目标 robconf 无法沿当前路径连续到达。', recovery: '修改目标构型或先用关节 Jog 脱离当前分支。' }
    case 'wrist-singularity': return { title: '腕部奇异', message: '严格姿态路径无法通过腕部奇异位置。', recovery: '修改路径姿态，或明确启用 SingArea\\Wrist。' }
    case 'joint-limit': return { title: '关节限位', message: '路径会触及关节限位。', recovery: '缩小目标范围或调整起始构型。' }
    case 'path-discontinuity': return { title: '路径不连续', message: '相邻路径点之间的关节变化过大。', recovery: '增加中间点或调整目标姿态。' }
    case 'unsupported-model': return { title: '机器人型号不支持', message: '当前模型版本没有注册到运动 Core。', recovery: '选择已注册的 ABB IRB1200 模型。' }
    default: return { title: '目标不可达', message: '运动 Core 未找到满足约束的规划。', recovery: '调整目标位置、姿态或构型后重试。' }
  }
}
