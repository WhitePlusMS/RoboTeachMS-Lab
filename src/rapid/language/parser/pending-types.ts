import type { RapidScalarExpression, RapidSourceRange } from './rapid-parser.ts'
import type { SingAreaMode } from '../../data/index.ts'
import type { ConfigurationMonitoringMode } from '../../data/index.ts'
import type { OperandKind } from '../rapid-symbols.ts'
import type { Token } from '../rapid-lexer.ts'

/** 目标操作数意图：命名 robtarget、Offs/RelTool 表达式或未示教占位。 */
export interface PendingTarget {
  kind: 'name' | 'offs' | 'reltool' | 'star'
  baseName: string
  baseToken: Token
  dx?: number
  dy?: number
  dz?: number
  rx?: number
  ry?: number
  rz?: number
  range: RapidSourceRange
  sourceText: string
}

export type PendingTargetExpressionKind = Exclude<PendingTarget['kind'], 'name' | 'star'>

export interface PendingReference {
  kind: OperandKind
  token: Token
  targetExpression?: PendingTargetExpressionKind
}

export interface PendingMotion {
  kind: 'movej' | 'movel' | 'movec'
  target: PendingTarget
  cirPoint?: PendingTarget
  speedName: string
  speedToken: Token
  zoneName: string
  zoneToken: Token
  toolName: string
  toolToken: Token
  wobjName: string
  wobjToken: Token | null
  range: RapidSourceRange
  sourceText: string
}

export interface PendingSingArea {
  mode: SingAreaMode
  range: RapidSourceRange
  sourceText: string
}

export interface PendingConfiguration {
  mode: ConfigurationMonitoringMode
  range: RapidSourceRange
  sourceText: string
}

export interface PendingAssignment {
  targetToken: Token
  expression: RapidScalarExpression
  range: RapidSourceRange
  sourceText: string
}

export interface PendingConditionalBranch {
  conditionKind: 'if' | 'elseif'
  condition: RapidScalarExpression | null
  range: RapidSourceRange
  sourceText: string
  statements: PendingStatement[]
}

export interface PendingConditional {
  branches: PendingConditionalBranch[]
  elseStatements: PendingStatement[] | null
}

export interface PendingWhile {
  condition: RapidScalarExpression | null
  conditionToken: Token
  sourceText: string
  range: RapidSourceRange
  statements: PendingStatement[]
}

export interface PendingFor {
  loopVarToken: Token
  fromExpr: RapidScalarExpression | null
  toExpr: RapidScalarExpression | null
  stepExpr: RapidScalarExpression | null
  sourceText: string
  range: RapidSourceRange
  statements: PendingStatement[]
}

/** 循环内 EXITDO 在解析阶段暂存，结果组装阶段填充循环退出目标。 */
export interface PendingExit {
  token: Token
  sourceText: string
  range: RapidSourceRange
}

export type PendingStatement =
  | { kind: 'motion'; motion: PendingMotion }
  | { kind: 'singarea'; singArea: PendingSingArea }
  | { kind: 'confj' | 'confl'; configuration: PendingConfiguration }
  | { kind: 'assign'; assignment: PendingAssignment }
  | { kind: 'conditional'; conditional: PendingConditional }
  | { kind: 'while'; whileLoop: PendingWhile }
  | { kind: 'for'; forLoop: PendingFor }
  | { kind: 'exitdo'; exit: PendingExit }
