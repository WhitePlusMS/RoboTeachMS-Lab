import type { RapidDiagnostic } from '../rapid-diagnostics.ts'
import { rangeFromToken } from '../rapid-lexer.ts'
import type {
  RapidExecutableInstruction,
  RapidExitInstruction,
} from './rapid-parser.ts'
import {
  scalarExpressionType,
  type ScalarExpressionContext,
} from './scalar-expression.ts'
import type {
  PendingConditional,
  PendingExit,
  PendingFor,
  PendingStatement,
  PendingWhile,
} from './pending-types.ts'

export interface ControlFlowContext {
  readonly lineStarts: readonly number[]
  readonly scalarContext: ScalarExpressionContext
  readonly diagnostics: RapidDiagnostic[]
  resolveLeaf(statement: PendingStatement): RapidExecutableInstruction | null
}

/**
 * 结构语句体内最后一条语句若是叶子指令，需要显式接管其 nextPointer 跳出该结构。
 * 分支/循环本身（conditional/while/for/exitdo）已经通过自身 trueTarget/falseTarget/target
 * 完成跳转，不需要在这里处理；穷尽 switch 保证新增叶子指令类型时编译报错，而不是静默漏挂线。
 */
function setBranchExit(instruction: RapidExecutableInstruction, target: number): void {
  switch (instruction.kind) {
    case 'movej':
    case 'movel':
    case 'movec':
    case 'singarea':
    case 'confj':
    case 'confl':
    case 'assign':
      instruction.nextPointer = target
      return
    case 'if':
    case 'while':
    case 'for':
    case 'exitdo':
      return
    default:
      instruction satisfies never
  }
}

function appendConditional(
  conditional: PendingConditional,
  output: RapidExecutableInstruction[],
  ctx: ControlFlowContext,
  outerBack?: number,
): void {
  if (conditional.branches.some((branch) => branch.condition === null)) return
  for (const branch of conditional.branches) {
    const condition = branch.condition
    if (!condition) return
    const expressionKind = scalarExpressionType(ctx.scalarContext, condition)
    if (expressionKind && expressionKind !== 'bool') {
      ctx.diagnostics.push({
        code: 'invalid-data',
        severity: 'error',
        message: 'IF/ELSEIF 条件必须是 bool',
        range: condition.range,
      })
    }
  }

  const conditionIndices: number[] = []
  const branchBodies: Array<{ start: number; end: number }> = []
  for (const branch of conditional.branches) {
    const condition = branch.condition
    if (!condition) return
    const conditionIndex = output.length
    conditionIndices.push(conditionIndex)
    output.push({
      kind: 'if',
      conditionKind: branch.conditionKind,
      condition,
      trueTarget: 0,
      falseTarget: 0,
      sourceRange: branch.range,
      sourceText: branch.sourceText,
    })
    const bodyStart = output.length
    appendBody(branch.statements, output, ctx)
    branchBodies.push({ start: bodyStart, end: output.length })
  }

  const elseBody = conditional.elseStatements
    ? { start: output.length, end: output.length }
    : null
  if (conditional.elseStatements) {
    appendBody(conditional.elseStatements, output, ctx)
    if (elseBody) elseBody.end = output.length
  }

  const afterConditional = output.length
  const exitTarget = outerBack ?? afterConditional
  for (let index = 0; index < branchBodies.length; index += 1) {
    const body = branchBodies[index]
    const condition = output[conditionIndices[index]]
    if (!condition || condition.kind !== 'if') continue
    const nextCondition = conditionIndices[index + 1]
    const falseTarget = nextCondition ?? elseBody?.start ?? exitTarget
    condition.trueTarget = body.start < body.end ? body.start : exitTarget
    condition.falseTarget = falseTarget
    if (body.end > body.start) setBranchExit(output[body.end - 1], exitTarget)
  }
  if (elseBody && elseBody.end > elseBody.start) {
    setBranchExit(output[elseBody.end - 1], exitTarget)
  }
}

function appendStatement(
  statement: PendingStatement,
  output: RapidExecutableInstruction[],
  ctx: ControlFlowContext,
  outerBack?: number,
): void {
  if (statement.kind === 'conditional') {
    appendConditional(statement.conditional, output, ctx, outerBack)
    return
  }
  if (statement.kind === 'while') {
    appendWhile(statement.whileLoop, output, ctx, outerBack)
    return
  }
  if (statement.kind === 'for') {
    appendFor(statement.forLoop, output, ctx, outerBack)
    return
  }
  if (statement.kind === 'exitdo') {
    output.push({ kind: 'exitdo', target: -1, ...pendingExit(statement.exit) })
    return
  }
  const resolved = ctx.resolveLeaf(statement)
  if (resolved) output.push(resolved)
}

function pendingExit(
  exit: PendingExit,
): Pick<RapidExitInstruction, 'sourceRange' | 'sourceText'> {
  return { sourceRange: exit.range, sourceText: exit.sourceText }
}

function isControlBlockStatement(statement: PendingStatement): boolean {
  return (
    statement.kind === 'conditional' || statement.kind === 'while' || statement.kind === 'for'
  )
}

function appendBody(
  statements: PendingStatement[],
  output: RapidExecutableInstruction[],
  ctx: ControlFlowContext,
  back?: number,
): boolean {
  let trailingBlock = false
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]
    const isLast = index === statements.length - 1
    trailingBlock = isLast && back !== undefined && isControlBlockStatement(statement)
    appendStatement(statement, output, ctx, trailingBlock ? back : undefined)
  }
  return trailingBlock
}

function collectExitdos(
  output: RapidExecutableInstruction[],
  start: number,
  end: number,
  target: number,
): void {
  for (let index = start; index < end; index += 1) {
    const instruction = output[index]
    if (instruction && instruction.kind === 'exitdo' && instruction.target === -1) {
      instruction.target = target
    }
  }
}

function appendWhile(
  loop: PendingWhile,
  output: RapidExecutableInstruction[],
  ctx: ControlFlowContext,
  outerBack?: number,
): void {
  if (loop.condition === null) return
  const expressionKind = scalarExpressionType(ctx.scalarContext, loop.condition)
  if (expressionKind && expressionKind !== 'bool') {
    ctx.diagnostics.push({
      code: 'invalid-data',
      severity: 'error',
      message: 'WHILE 条件必须是 bool',
      range: loop.condition.range,
    })
  }

  const headIndex = output.length
  output.push({
    kind: 'while',
    condition: loop.condition,
    trueTarget: 0,
    falseTarget: 0,
    sourceRange: loop.range,
    sourceText: loop.sourceText,
  })
  const bodyStart = output.length
  const trailingBlock = appendBody(loop.statements, output, ctx, headIndex)
  const bodyEnd = output.length
  if (!trailingBlock && bodyEnd > bodyStart) setBranchExit(output[bodyEnd - 1], headIndex)
  const afterLoop = output.length
  const whileHead = output[headIndex]
  if (whileHead && whileHead.kind === 'while') {
    whileHead.trueTarget = bodyEnd > bodyStart ? bodyStart : afterLoop
    whileHead.falseTarget = outerBack ?? afterLoop
  }
  collectExitdos(output, bodyStart, bodyEnd, outerBack ?? afterLoop)
}

function appendFor(
  loop: PendingFor,
  output: RapidExecutableInstruction[],
  ctx: ControlFlowContext,
  outerBack?: number,
): void {
  if (loop.fromExpr === null || loop.toExpr === null) return
  const headIndex = output.length
  output.push({
    kind: 'for',
    loopVar: {
      name: loop.loopVarToken.text,
      range: rangeFromToken(loop.loopVarToken, ctx.lineStarts),
    },
    fromExpr: loop.fromExpr,
    toExpr: loop.toExpr,
    stepExpr: loop.stepExpr,
    trueTarget: 0,
    falseTarget: 0,
    sourceRange: loop.range,
    sourceText: loop.sourceText,
  })
  const bodyStart = output.length
  const trailingBlock = appendBody(loop.statements, output, ctx, headIndex)
  const bodyEnd = output.length
  if (!trailingBlock && bodyEnd > bodyStart) setBranchExit(output[bodyEnd - 1], headIndex)
  const afterLoop = output.length
  const forHead = output[headIndex]
  if (forHead && forHead.kind === 'for') {
    forHead.trueTarget = bodyEnd > bodyStart ? bodyStart : afterLoop
    forHead.falseTarget = outerBack ?? afterLoop
  }
  collectExitdos(output, bodyStart, bodyEnd, outerBack ?? afterLoop)
}

/** 将 pending 控制语句展开为唯一的可执行指令序列。 */
export function appendPendingStatements(
  statements: PendingStatement[],
  output: RapidExecutableInstruction[],
  ctx: ControlFlowContext,
): void {
  for (const statement of statements) appendStatement(statement, output, ctx)
}
