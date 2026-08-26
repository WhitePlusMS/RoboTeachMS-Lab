import { NO_EXTERNAL_AXIS, type RobTarget } from '../data/index.ts'

/** FlexPendant 新建目标使用的初始 robtarget。 */
export const DEFAULT_ROBTARGET: RobTarget = {
  trans: [0, 0, 0],
  rot: [1, 0, 0, 0],
  robconf: [0, 0, 0, 0],
  extax: [...NO_EXTERNAL_AXIS],
}

function formatNumber(value: number): string {
  if (value === 9e9) return '9E9'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(6).replace(/\.?0+$/, '')
}

/** 把结构化 robtarget 格式化为 ABB 字面量。 */
export function formatRobTarget(target: RobTarget): string {
  return `[[${target.trans.map(formatNumber).join(',')}],[${target.rot.map(formatNumber).join(',')}],[${target.robconf
    .map(formatNumber)
    .join(',')}],[${target.extax.map(formatNumber).join(',')}]]`
}

/** 新建声明使用固定 ABB 风格，只规范新生成片段。 */
export function formatTargetDeclaration(name: string, target: RobTarget): string {
  return `CONST robtarget ${name} := ${formatRobTarget(target)};`
}
