import { describe, expect, it } from 'vitest'
import { findRapidPreset, RAPID_PRESET_PROGRAMS } from './preset-programs.ts'
import { isRapidMotionInstruction, parseRapidProgram } from '@/rapid/rapid-parser.ts'

describe('RAPID 预设程序库', () => {
  it('提供 6 个取自测试用例文档的可运行示例模板', () => {
    expect(RAPID_PRESET_PROGRAMS).toHaveLength(6)
    const ids = RAPID_PRESET_PROGRAMS.map((preset) => preset.id)
    expect([...new Set(ids)]).toEqual(ids)
    for (const preset of RAPID_PRESET_PROGRAMS) {
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.source.length).toBeGreaterThan(0)
    }
  })

  it('findRapidPreset 可按 id 精确找到；未知 id 返回 undefined', () => {
    for (const preset of RAPID_PRESET_PROGRAMS) {
      expect(findRapidPreset(preset.id)).toEqual(preset)
    }
    expect(findRapidPreset('missing')).toBeUndefined()
  })

  it('每个预设都能被 parser 解析为可执行程序，且无诊断', () => {
    for (const preset of RAPID_PRESET_PROGRAMS) {
      const result = parseRapidProgram(preset.source)
      expect(result.diagnostics, preset.name).toEqual([])
      expect(result.canExecute, preset.name).toBe(true)
      expect(result.program.length, preset.name).toBeGreaterThan(0)
      // 全部预设都应含运动指令（可实际演示机械臂运动）。
      expect(
        result.program.some(isRapidMotionInstruction),
        `${preset.name} 应包含至少一条运动指令`,
      ).toBe(true)
    }
  })
})
