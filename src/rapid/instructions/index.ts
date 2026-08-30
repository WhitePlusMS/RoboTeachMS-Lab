/**
 * RAPID 叶子指令模块的公开接缝。
 *
 * 叶子指令：不改变控制流跳转目标计算的语句（运动、赋值、模式切换）。
 * 新增一个叶子指令时：在本目录下新增文件（或复用 motion/mode/assign 现有文件），
 * 导出其 parse 函数并在下面的 LEAF_INSTRUCTION_KEYWORDS 里注册一行；
 * control-flow.ts 的穷尽 switch 与 rapid-parser.ts 的 resolveLeaf 会在编译期提示还需要处理的分支。
 */
export { parseMotion, type MotionStatementContext } from './motion/motion-statement.ts'
export {
  parseConfiguration,
  parseSingArea,
  type ModeStatementContext,
} from './mode/mode-statement.ts'
export { parseAssignment, type AssignmentStatementContext } from './assign/assignment-statement.ts'

/** 叶子指令判别 kind；与 control-flow.ts 的穷尽 switch 共用同一份真源列表。 */
export type LeafInstructionKind = 'movej' | 'movel' | 'movec' | 'singarea' | 'confj' | 'confl' | 'assign'

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
