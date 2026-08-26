/** RAPID 语言模块的公开接缝；词法、诊断、符号和数据字面量解析是内部实现。 */
export {
  isRapidMotionInstruction,
  isRobtargetProgramData,
  parseRapidProgram,
} from './parser/index.ts'
export type {
  RapidAssignmentInstruction,
  RapidConditionalInstruction,
  RapidDiagnostic,
  RapidDiagnosticCode,
  RapidExecutableInstruction,
  RapidForInstruction,
  RapidMotionInstruction,
  RapidMotionInsertionPoint,
  RapidParseResult,
  RapidProgramData,
  RapidProgramDataTarget,
  RapidScalarBinaryOperator,
  RapidScalarExpression,
  RapidScalarUnaryOperator,
  RapidSingAreaInstruction,
  RapidConfigurationInstruction,
  RapidSourcePosition,
  RapidSourceRange,
  RapidWhileInstruction,
} from './parser/index.ts'
export type { RapidDataKind } from './rapid-symbols.ts'
