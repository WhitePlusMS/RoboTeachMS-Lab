/** RAPID 执行模块的公开接缝。 */
export { executeRapidMotion } from './motion-execution.ts'
export type { RapidMotionExecutionContext } from './motion-execution.ts'
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
