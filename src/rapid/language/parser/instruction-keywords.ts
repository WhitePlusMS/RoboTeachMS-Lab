/**
 * RAPID 叶子指令关键词注册表。
 *
 * 叶子指令：不改变控制流跳转目标计算的语句（运动、赋值、模式切换）。
 * 新增叶子指令时复用本目录的语句 parser，并登记关键词；
 * control-flow-lowering 与 rapid-parser 的穷尽分派负责检查后续处理。
 */

/** 叶子指令判别 kind；与 control-flow.ts 的穷尽 switch 共用同一份真源列表。 */
export type LeafInstructionKind =
  'movej' | 'movel' | 'movec' | 'singarea' | 'confj' | 'confl' | 'assign'

/** 每个叶子指令的固定关键字；assign 没有固定关键字，靠 `identifier :=` 前瞻识别。 */
export const LEAF_INSTRUCTION_KEYWORDS = {
  movej: ['MOVEJ'],
  movel: ['MOVEL'],
  movec: ['MOVEC'],
  singarea: ['SINGAREA'],
  confj: ['CONFJ'],
  confl: ['CONFL'],
  assign: [],
} satisfies Record<LeafInstructionKind, readonly string[]>

const registeredKeywords = Object.values(LEAF_INSTRUCTION_KEYWORDS).flat()
if (new Set(registeredKeywords).size !== registeredKeywords.length) {
  throw new Error('叶子指令关键字注册表存在重复关键字')
}
