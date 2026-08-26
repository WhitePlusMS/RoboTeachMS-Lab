import { describe, expect, it } from 'vitest'
import { presentMotionError } from './motion-errors.ts'

describe('宿主运动错误呈现', () => {
  it('把 Core 的稳定错误分类映射为场景化中文文案和恢复建议', () => {
    expect(
      presentMotionError({
        code: 'wrist-singularity',
        category: 'planning-failure',
        details: { failure: 'wrist-singularity' },
      }),
    ).toEqual({
      title: '腕部奇异',
      message: '严格姿态路径无法通过腕部奇异位置。',
      recovery: '修改路径姿态，或明确启用 SingArea\\Wrist。',
    })
  })

  it('不把 Core 机器字段改写成宿主文案字段', () => {
    const error = {
      code: 'unsupported-capability' as const,
      category: 'unsupported-capability' as const,
      details: { zone: 'fly-by' },
    }
    const presentation = presentMotionError(error)
    expect(presentation.title).toBe('运动能力暂不支持')
    expect(error).toEqual({
      code: 'unsupported-capability',
      category: 'unsupported-capability',
      details: { zone: 'fly-by' },
    })
  })
})
