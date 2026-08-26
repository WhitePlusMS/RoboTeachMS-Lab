/** Parser 内部实现的稳定接缝；语言模块只从这里取得一次解析结果。 */
export {
  isRapidMotionInstruction,
  isRobtargetProgramData,
  parseRapidProgram,
} from './rapid-parser.ts'
export type {
  RapidAssignmentInstruction,
  RapidConditionalInstruction,
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
} from './rapid-parser.ts'
export type { RapidDiagnostic, RapidDiagnosticCode } from '../rapid-diagnostics.ts'
