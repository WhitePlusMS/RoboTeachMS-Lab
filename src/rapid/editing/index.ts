/** RAPID 结构化编辑模块的公开接缝。 */
export {
  applyRapidEdit,
  makeEmptyTaughtTarget,
  makeTaughtTargetFromPose,
} from './controlled-rapid-edit.ts'
export { DEFAULT_ROBTARGET, formatRobTarget, formatTargetDeclaration } from './formatting.ts'
export type { RapidEditCommand, RapidEditError, RapidEditResult, RapidEditSuccess } from './types.ts'
