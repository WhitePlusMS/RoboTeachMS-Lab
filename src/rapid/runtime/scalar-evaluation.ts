import type { RapidScalarExpression } from '../language/index.ts'
import type { RapidScalarValue } from '../data/index.ts'
import type { ProgramExecutionContext } from './program-executor.ts'

/**
 * 标量表达式运行期求值；供 assign 叶子指令与控制流条件（IF/WHILE/FOR）共用同一份语义，
 * 避免两处各自实现一份运算符/类型规则。parser 侧的类型静态检查在
 * `language/parser/scalar-expression.ts`，两者独立但规则必须保持一致。
 */
export type ScalarEvaluationResult =
  { ok: true; value: RapidScalarValue } | { ok: false; message: string }

function runtimeError(message: string): ScalarEvaluationResult {
  return { ok: false, message }
}

export function evaluateScalarExpression(
  expression: RapidScalarExpression,
  context: ProgramExecutionContext,
): ScalarEvaluationResult {
  switch (expression.kind) {
    case 'num-literal':
      return { ok: true, value: expression.value }
    case 'bool-literal':
      return { ok: true, value: expression.value }
    case 'variable': {
      const variable = context.readVariable(expression.name)
      return variable
        ? { ok: true, value: variable.value }
        : runtimeError(`运行时不存在变量 ${expression.name}`)
    }
    case 'group':
      return evaluateScalarExpression(expression.expression, context)
    case 'unary': {
      const operand = evaluateScalarExpression(expression.operand, context)
      if (!operand.ok) return operand
      if (expression.operator === 'NOT') {
        if (typeof operand.value !== 'boolean') return runtimeError('NOT 运算的操作数必须是 bool')
        return { ok: true, value: !operand.value }
      }
      if (typeof operand.value !== 'number') {
        return runtimeError(`${expression.operator} 运算的操作数必须是 num`)
      }
      const value = expression.operator === '-' ? -operand.value : operand.value
      return Number.isFinite(value) ? { ok: true, value } : runtimeError('表达式结果不是有限数值')
    }
    case 'binary': {
      const left = evaluateScalarExpression(expression.left, context)
      if (!left.ok) return left
      const right = evaluateScalarExpression(expression.right, context)
      if (!right.ok) return right
      const operator = expression.operator
      if (operator === 'AND' || operator === 'OR') {
        if (typeof left.value !== 'boolean' || typeof right.value !== 'boolean') {
          return runtimeError(`${operator} 运算的两侧必须是 bool`)
        }
        return {
          ok: true,
          value: operator === 'AND' ? left.value && right.value : left.value || right.value,
        }
      }
      if (operator === '=' || operator === '<>') {
        if (typeof left.value !== typeof right.value)
          return runtimeError('比较运算的两侧类型不一致')
        const equal = left.value === right.value
        return { ok: true, value: operator === '=' ? equal : !equal }
      }
      if (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') {
        if (typeof left.value !== 'number' || typeof right.value !== 'number') {
          return runtimeError(`${operator} 比较的两侧必须是 num`)
        }
        if (operator === '<') return { ok: true, value: left.value < right.value }
        if (operator === '<=') return { ok: true, value: left.value <= right.value }
        if (operator === '>') return { ok: true, value: left.value > right.value }
        return { ok: true, value: left.value >= right.value }
      }
      if (typeof left.value !== 'number' || typeof right.value !== 'number') {
        return runtimeError(`${operator} 运算的两侧必须是 num`)
      }
      if (operator === '/' && right.value === 0) return runtimeError('表达式除数不能为 0')
      let value: number
      switch (operator) {
        case '+':
          value = left.value + right.value
          break
        case '-':
          value = left.value - right.value
          break
        case '*':
          value = left.value * right.value
          break
        case '/':
          value = left.value / right.value
          break
      }
      return Number.isFinite(value) ? { ok: true, value } : runtimeError('表达式结果不是有限数值')
    }
  }
}
