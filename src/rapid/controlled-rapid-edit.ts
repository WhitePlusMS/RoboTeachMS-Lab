import {
  isRobtargetProgramData,
  parseRapidProgram,
  type RapidProgramDataTarget,
} from './rapid-parser.ts'
import { NO_EXTERNAL_AXIS, type RobTarget } from './rapid-types.ts'
import { rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'
import { internalQuatToRapid } from './plan-shared.ts'
import type { Pose } from '@/robotics/types.ts'

/**
 * RAPID 受控源码编辑深模块：把一次语义化的 Program Data 命令应用到源程序，
 * 只做符号级最小文本替换，未涉及的注释、空格、大小写和换行逐字保留。
 *
 * 调用方只提交语义命令与业务数据，不读取或计算 offset；源码范围、文本替换顺序、
 * 换行检测与插入点选择全部隐藏在本模块。源程序存在任何 error 时禁止结构化编辑。
 */

/** 运动指令目标来源：已有点位或由当前 TCP 一次性示教生成。 */
export type MotionTargetSelection =
  { source: 'existing'; name: string } | { source: 'current'; target: RobTarget }

/** 一次只执行一条的结构化编辑命令。 */
export type RapidEditCommand =
  | { type: 'create-target'; name: string; target: RobTarget }
  | { type: 'modify-position'; name: string; target: RobTarget }
  | { type: 'rename-target'; name: string; newName: string }
  | { type: 'delete-target'; name: string }
  | {
      type: 'insert-motion'
      kind: 'movej' | 'movel'
      insertionIndex: number
      target: MotionTargetSelection
    }

export type RapidEditErrorCode =
  | 'source-error'
  | 'invalid-name'
  | 'duplicate-name'
  | 'undefined-target'
  | 'target-referenced'
  | 'invalid-insertion-position'

export interface RapidEditError {
  code: RapidEditErrorCode
  message: string
}

export interface RapidEditSuccess {
  /** 应用命令后的完整新源文本。 */
  source: string
  /** 仅插入运动时返回的指令下标位移，供停止态 PP 保留原下一条指令。 */
  programIndexShift?: { at: number; delta: 1 }
}

export type RapidEditResult =
  { ok: true; result: RapidEditSuccess } | { ok: false; error: RapidEditError }

/** RAPID 标识符：字母/下划线开头，后续字母数字下划线；长度非空。 */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 名称匹配遵循 RAPID 大小写不敏感规则。 */
function normalizeName(text: string): string {
  return text.toLocaleLowerCase('en-US')
}

/** 检测源文件换行符，新生成片段必须与源文件保持一致。 */
function detectLineEnding(source: string): '\r\n' | '\n' {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

/** 返回 offset 所在行的起始（含行首缩进）与行首空白；用于让新生成的语句沿用邻居缩进、形成独立行。 */
function lineStartAt(
  source: string,
  offset: number,
  eol: string,
): { start: number; indent: string } {
  const prevEol = source.lastIndexOf(eol, offset - 1)
  const start = prevEol === -1 ? 0 : prevEol + eol.length
  let indentEnd = start
  while (indentEnd < source.length) {
    const ch = source[indentEnd]
    if (ch !== ' ' && ch !== '\t') break
    indentEnd += 1
  }
  return { start, indent: source.slice(start, indentEnd) }
}

/** 数值格式化：整型去小数点，非整型去尾零；ABB 未使用外部轴常量 9E9 保持 ABB 惯用写法。 */
function formatNumber(value: number): string {
  if (value === 9e9) return '9E9'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(6).replace(/\.?0+$/, '')
}

/** 把结构化 robtarget 格式化为 ABB 字面量 `[[trans],[rot],[robconf],[extax]]`。 */
export function formatRobTarget(target: RobTarget): string {
  return `[[${target.trans.map(formatNumber).join(',')}],[${target.rot.map(formatNumber).join(',')}],[${target.robconf
    .map(formatNumber)
    .join(',')}],[${target.extax.map(formatNumber).join(',')}]]`
}

/** 新建声明使用固定 ABB 风格，只规范新生成片段。 */
export function formatTargetDeclaration(name: string, target: RobTarget): string {
  return `CONST robtarget ${name} := ${formatRobTarget(target)};`
}

/** 新建运动指令使用固定受支持参数 v100,fine,tool0。 */
function formatMotion(kind: 'movej' | 'movel', name: string): string {
  const keyword = kind === 'movej' ? 'MoveJ' : 'MoveL'
  return `${keyword} ${name},v100,fine,tool0;`
}

/** 从 p10 开始每次加 10，返回第一个在当前全名称空间中未占用的名称。 */
function findAvailableTargetName(parsed: ReturnType<typeof parseRapidProgram>): string {
  const existing = allSymbolNames(parsed)
  let candidate = 10
  while (existing.has(normalizeName(`p${candidate}`))) {
    candidate += 10
  }
  return `p${candidate}`
}

/** 全名称空间：所有模块级数据名称（含用户声明与系统预定义），用于查重。 */
function allSymbolNames(parsed: ReturnType<typeof parseRapidProgram>): Map<string, unknown> {
  return new Map(parsed.data.map((d) => [normalizeName(d.name), d]))
}

/** 校验名称是否合法 RAPID 标识符且在当前符号表中不冲突（大小写不敏感）。 */
function validateNewName(
  name: string,
  existing: ReadonlyMap<string, unknown>,
  excludeKey?: string,
): RapidEditError | null {
  if (!IDENTIFIER_PATTERN.test(name)) {
    return { code: 'invalid-name', message: `“${name}” 不是合法的 RAPID 标识符` }
  }
  const key = normalizeName(name)
  if (key !== excludeKey && existing.has(key)) {
    return { code: 'duplicate-name', message: `RAPID 名称 ${name} 已存在` }
  }
  return null
}

/** 预检：源程序存在 error 时禁止任何结构化编辑。 */
function guardExecutable(parsed: ReturnType<typeof parseRapidProgram>): RapidEditError | null {
  if (!parsed.canExecute) {
    return { code: 'source-error', message: '源程序存在错误，禁止结构化编辑' }
  }
  return null
}

/**
 * 对源程序应用一条结构化编辑命令。成功返回新源文本与编辑范围；失败返回结构化拒绝原因，
 * 源文本逐字不变（不做任何部分修改）。
 */
export function applyRapidEdit(source: string, command: RapidEditCommand): RapidEditResult {
  const parsed = parseRapidProgram(source)
  const preflight = guardExecutable(parsed)
  if (preflight) return { ok: false, error: preflight }

  switch (command.type) {
    case 'create-target':
      return createTarget(source, parsed, command.name, command.target)
    case 'modify-position':
      return modifyPosition(source, parsed, command.name, command.target)
    case 'rename-target':
      return renameTarget(source, parsed, command.name, command.newName)
    case 'delete-target':
      return deleteTarget(source, parsed, command.name)
    case 'insert-motion':
      return insertMotion(source, parsed, command.kind, command.insertionIndex, command.target)
  }
}

function createTarget(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  name: string,
  target: RobTarget,
): RapidEditResult {
  const existing = allSymbolNames(parsed)
  const nameError = validateNewName(name, existing)
  if (nameError) return { ok: false, error: nameError }

  const declaration = formatTargetDeclaration(name, target)
  const insertAt = parsed.dataInsertOffset
  const eol = detectLineEnding(source)
  const newText = `${eol}    ${declaration}`
  const nextSource = source.slice(0, insertAt) + newText + source.slice(insertAt)
  return {
    ok: true,
    result: {
      source: nextSource,
    },
  }
}

function findTarget(
  parsed: ReturnType<typeof parseRapidProgram>,
  name: string,
): RapidProgramDataTarget | null {
  const key = normalizeName(name)
  return (
    parsed.data.find(
      (entry): entry is RapidProgramDataTarget =>
        isRobtargetProgramData(entry) && normalizeName(entry.name) === key,
    ) ?? null
  )
}

function modifyPosition(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  name: string,
  target: RobTarget,
): RapidEditResult {
  const entry = findTarget(parsed, name)
  if (!entry)
    return { ok: false, error: { code: 'undefined-target', message: `未定义 robtarget ${name}` } }

  const start = entry.valueRange.start.offset
  const end = entry.valueRange.end.offset
  const replacement = formatRobTarget(target)
  const nextSource = source.slice(0, start) + replacement + source.slice(end)
  return { ok: true, result: { source: nextSource } }
}

function renameTarget(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  name: string,
  newName: string,
): RapidEditResult {
  const entry = findTarget(parsed, name)
  if (!entry)
    return { ok: false, error: { code: 'undefined-target', message: `未定义 robtarget ${name}` } }

  const existing = allSymbolNames(parsed)
  const nameError = validateNewName(newName, existing, normalizeName(name))
  if (nameError) return { ok: false, error: nameError }

  // 声明名 + 所有已解析引用：从后往前替换，避免 offset 位移影响后续。
  const spans: Array<{ start: number; end: number }> = [
    { start: entry.nameRange.start.offset, end: entry.nameRange.end.offset },
    ...entry.referenceRanges.map((range) => ({ start: range.start.offset, end: range.end.offset })),
  ].sort((a, b) => b.start - a.start)

  let nextSource = source
  for (const span of spans) {
    nextSource = nextSource.slice(0, span.start) + newName + nextSource.slice(span.end)
  }
  return { ok: true, result: { source: nextSource } }
}

function deleteTarget(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  name: string,
): RapidEditResult {
  const entry = findTarget(parsed, name)
  if (!entry)
    return { ok: false, error: { code: 'undefined-target', message: `未定义 robtarget ${name}` } }
  if (entry.referenceRanges.length > 0) {
    return {
      ok: false,
      error: {
        code: 'target-referenced',
        message: `robtarget ${entry.name} 仍有 ${entry.referenceRanges.length} 处引用，不能删除`,
      },
    }
  }

  // 删除声明所在整行（含行首缩进与行尾换行），避免残留空行。
  const eol = detectLineEnding(source)
  const previousEol = source.lastIndexOf(eol, entry.declarationRange.start.offset - 1)
  const lineStart = previousEol === -1 ? 0 : previousEol + eol.length
  const lineEnd = source.indexOf(eol, entry.declarationRange.end.offset)
  const removeEnd = lineEnd === -1 ? source.length : lineEnd + eol.length
  const nextSource = source.slice(0, lineStart) + source.slice(removeEnd)
  return { ok: true, result: { source: nextSource } }
}

function insertMotion(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  kind: 'movej' | 'movel',
  insertionIndex: number,
  targetSelection: MotionTargetSelection,
): RapidEditResult {
  const insertionPoint = parsed.motionInsertionPoints.find(
    (point) => point.index === insertionIndex,
  )
  if (!insertionPoint) {
    return {
      ok: false,
      error: {
        code: 'invalid-insertion-position',
        message: `插入位置 ${insertionIndex} 不在 main 的合法运动位置中`,
      },
    }
  }

  let targetName: string
  let declarationInsert: { offset: number; text: string } | null = null

  if (targetSelection.source === 'existing') {
    const entry = findTarget(parsed, targetSelection.name)
    if (!entry)
      return {
        ok: false,
        error: { code: 'undefined-target', message: `未定义 robtarget ${targetSelection.name}` },
      }
    targetName = entry.name
  } else {
    const existing = allSymbolNames(parsed)
    const autoName = findAvailableTargetName(parsed)
    const nameError = validateNewName(autoName, existing)
    if (nameError) return { ok: false, error: nameError }
    targetName = autoName
    const eol = detectLineEnding(source)
    // 新 robtarget 声明插到 main PROC 之前，作为独立声明行，缩进沿用 PROC 行（模块级）缩进，
    // 行尾补换行，避免与后续 PROC main() 粘到同一行。
    const procLine = lineStartAt(source, parsed.dataInsertOffset, eol)
    declarationInsert = {
      offset: procLine.start,
      text: `${procLine.indent}${formatTargetDeclaration(targetName, targetSelection.target)}${eol}`,
    }
  }

  const motionText = formatMotion(kind, targetName)
  const eol = detectLineEnding(source)
  // 新运动语句插到锚点所在行行首，缩进沿用该行行首缩进（自动匹配 WHILE/IF 等嵌套层级），
  // 该行自身缩进保留给后续原语句，避免叠加硬编码空格造成错位。
  const anchorLine = lineStartAt(source, insertionPoint.offset, eol)
  const motionInsert = {
    offset: anchorLine.start,
    text: `${anchorLine.indent}${motionText}${eol}`,
  }

  // 所有替换按 offset 从大到小应用，避免前面插入影响后面位置。
  const replacements = declarationInsert ? [motionInsert, declarationInsert] : [motionInsert]
  replacements.sort((a, b) => b.offset - a.offset)

  let nextSource = source
  for (const replacement of replacements) {
    nextSource =
      nextSource.slice(0, replacement.offset) +
      replacement.text +
      nextSource.slice(replacement.offset)
  }

  return {
    ok: true,
    result: {
      source: nextSource,
      programIndexShift: { at: insertionIndex, delta: 1 },
    },
  }
}

/** 新建目标的默认值工厂：使用 ISO 教学语义（tool0 TCP、零 robconf、未使用外部轴）。 */
export function makeEmptyTaughtTarget(
  trans: [number, number, number],
  rot: [number, number, number, number],
): RobTarget {
  return { trans, rot, robconf: [0, 0, 0, 0], extax: [...NO_EXTERNAL_AXIS] }
}

/** 把当前 ABB 基座 tool0 TCP Pose 转换为 RAPID robtarget；教学语义统一入口。 */
export function makeTaughtTargetFromPose(pose: Pose): RobTarget {
  const internalQuat = rotationMatrixToQuaternion(pose.rotation)
  const rapidQuat = internalQuatToRapid(internalQuat)
  return makeEmptyTaughtTarget([pose.position[0], pose.position[1], pose.position[2]], rapidQuat)
}
