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

  /**
   * 特征化测试：补齐剩余 MotionErrorCode 分支的文案锁定，防止今后修改 switch 时
   * 静默改变某个分支的呈现文字。这是 RAPID/末端拖拽提示表面自己的文案，与
   * cartesian-control.ts 面板的场景化短文案是两个刻意分开维护的呈现表面。
   */
  it('把 configuration-unreachable 映射为场景化中文文案和恢复建议', () => {
    expect(
      presentMotionError({ code: 'configuration-unreachable', category: 'planning-failure', details: {} }),
    ).toEqual({
      title: '目标构型不可达',
      message: '目标 robconf 无法沿当前路径连续到达。',
      recovery: '修改目标构型或先用关节 Jog 脱离当前分支。',
    })
  })

  it('把 joint-limit 映射为场景化中文文案和恢复建议', () => {
    expect(
      presentMotionError({ code: 'joint-limit', category: 'planning-failure', details: {} }),
    ).toEqual({
      title: '关节限位',
      message: '路径会触及关节限位。',
      recovery: '缩小目标范围或调整起始构型。',
    })
  })

  it('把 path-discontinuity 映射为场景化中文文案和恢复建议', () => {
    expect(
      presentMotionError({ code: 'path-discontinuity', category: 'planning-failure', details: {} }),
    ).toEqual({
      title: '路径不连续',
      message: '相邻路径点之间的关节变化过大。',
      recovery: '增加中间点或调整目标姿态。',
    })
  })

  it('把 invalid-request 映射为场景化中文文案和恢复建议', () => {
    expect(
      presentMotionError({ code: 'invalid-request', category: 'invalid-request', details: {} }),
    ).toEqual({
      title: '运动请求无效',
      message: '运动参数不完整或包含非法数值。',
      recovery: '检查目标、Tool/WObj 和关节数组后重试。',
    })
  })

  it('把 unsupported-model 映射为场景化中文文案和恢复建议', () => {
    expect(
      presentMotionError({ code: 'unsupported-model', category: 'unsupported-model', details: {} }),
    ).toEqual({
      title: '机器人型号不支持',
      message: '当前模型版本没有注册到运动 Core。',
      recovery: '选择已注册的 ABB IRB1200 模型。',
    })
  })

  it('把 unreachable 映射为默认分支的场景化中文文案和恢复建议', () => {
    expect(
      presentMotionError({ code: 'unreachable', category: 'planning-failure', details: {} }),
    ).toEqual({
      title: '目标不可达',
      message: '运动 Core 未找到满足约束的规划。',
      recovery: '调整目标位置、姿态或构型后重试。',
    })
  })
})
