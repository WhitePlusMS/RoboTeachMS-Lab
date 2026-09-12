/** RAPID 执行模块的公开接缝。 */
export { submitMotionInstruction } from './submit-motion-instruction.ts'
export type { RapidMotionExecutionContext } from './submit-motion-instruction.ts'
export { createProgramExecutor } from './program-executor.ts'
export type {
  InstructionOutcome,
  ProgramExecutionContext,
  ProgramExecutionSeam,
  ProgramError,
  ProgramExecutor,
  ProgramInstruction,
  ProgramSnapshot,
  ProgramState,
} from './program-executor.ts'

/** RAPID 运行时公开接缝；实现不依赖 Vue、DOM 或 Runner。 */
export { createRapidRuntime } from './rapid-runtime.ts'
export type { RapidMotionPort, RapidRuntime } from './rapid-runtime.ts'
