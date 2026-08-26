import {
  isRobtargetProgramData,
  parseRapidProgram,
  type RapidProgramDataTarget,
} from '../language/index.ts'
import { NO_EXTERNAL_AXIS, type RobTarget } from '../data/index.ts'
import { rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'
import { internalQuatToRapid } from '../data/pose-transform.ts'
import type { JointAngles, Pose } from '@/robotics/model/index.ts'
import { abbConfigurationFromJoints } from '@/robot-models/abb-irb1200/index.ts'
import { formatRobTarget, formatTargetDeclaration } from './formatting.ts'
import type {
  RapidEditCommand,
  RapidEditError,
  RapidEditResult,
} from './types.ts'

/**
 * RAPID 受控源码编辑深模块：把一次语义化的 Program Data / 程序编辑器命令应用到源程序，
 * 只做符号级最小文本替换，未涉及的注释、空格、大小写和换行逐字保留。
 *
 * 调用方只提交语义命令与业务数据，不读取或计算 offset；源码范围、文本替换顺序、
 * 换行检测与插入点选择全部隐藏在本模块。
 *
 * 可编辑性守卫（对齐 FlexPendant）：源程序存在 error 时禁止结构化编辑；
 * 唯一例外是 missing-target（FlexPendant 式 `*` 未示教占位）——真机上程序带着 `*` 仍可
 * 继续编辑指令与参数（只是不能运行），因此当全部诊断都是 missing-target 时所有命令放行。
 */

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

/** 返回 offset 所在行的起始位置与行首缩进。 */
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

/** FlexPendant 新插入的运动指令：`*` 未示教目标 + 默认 v1000,z50,tool0（3HAC050941 5.3.5）。 */
function formatMotion(kind: 'movej' | 'movel'): string {
  const keyword = kind === 'movej' ? 'MoveJ' : 'MoveL'
  return `${keyword} *,v1000,z50,tool0;`
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

/** 诊断是否全部是 missing-target：唯一允许继续结构化编辑的 error 形态（见模块头注释）。 */
function onlyMissingTarget(parsed: ReturnType<typeof parseRapidProgram>): boolean {
  return (
    parsed.diagnostics.length > 0 &&
    parsed.diagnostics.every((diagnostic) => diagnostic.code === 'missing-target')
  )
}

/** 预检：源程序存在 error（除 missing-target 外）时禁止任何结构化编辑。 */
function guardEditable(parsed: ReturnType<typeof parseRapidProgram>): RapidEditError | null {
  if (parsed.canExecute) return null
  if (onlyMissingTarget(parsed)) return null
  return { code: 'source-error', message: '源程序存在错误，禁止结构化编辑' }
}

/**
 * 编辑后校验：delete/comment/uncomment 这类文本级命令可能破坏程序结构，
 * 应用前先用候选源码整体解析，结果必须可执行或仅剩 missing-target，否则整体拒绝。
 */
function guardEditedSource(nextSource: string): RapidEditError | null {
  const next = parseRapidProgram(nextSource)
  if (next.canExecute) return null
  if (onlyMissingTarget(next)) return null
  return { code: 'source-error', message: '编辑后源程序将存在错误，已取消本次修改' }
}

/** 取 parsed.instructions 的第 index 条；越界时给出结构化错误。 */
function instructionAt(
  parsed: ReturnType<typeof parseRapidProgram>,
  index: number,
): RapidEditError | null {
  if (index < 0 || index >= parsed.instructions.length) {
    return { code: 'invalid-instruction', message: `指令下标 ${index} 不存在` }
  }
  return null
}

/** 对候选源码应用一组文本替换；替换按 offset 从大到小应用，避免前面插入影响后面位置。 */
function applyReplacements(
  source: string,
  replacements: Array<{ offset: number; endOffset?: number; text: string }>,
): string {
  const sorted = [...replacements].sort((a, b) => b.offset - a.offset)
  let nextSource = source
  for (const replacement of sorted) {
    const end = replacement.endOffset ?? replacement.offset
    nextSource =
      nextSource.slice(0, replacement.offset) + replacement.text + nextSource.slice(end)
  }
  return nextSource
}

/**
 * 对源程序应用一条结构化编辑命令。成功返回新源文本与编辑范围；失败返回结构化拒绝原因，
 * 源文本逐字不变（不做任何部分修改）。
 */
export function applyRapidEdit(source: string, command: RapidEditCommand): RapidEditResult {
  const parsed = parseRapidProgram(source)
  const preflight = guardEditable(parsed)
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
      return insertMotion(source, parsed, command.kind, command.insertionIndex)
    case 'edit-motion-operand':
      return editMotionOperand(source, parsed, command)
    case 'delete-instruction':
      return deleteInstruction(source, parsed, command.index)
    case 'comment-instructions':
      return commentInstructions(source, parsed, command.indices)
    case 'uncomment-lines':
      return uncommentLines(source, parsed, command.lines)
    case 'change-motion-kind':
      return changeMotionKind(source, parsed, command.index)
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

  // 新运动语句插到锚点所在行行首，缩进沿用该行行首缩进（自动匹配 WHILE/IF 等嵌套层级），
  // 该行自身缩进保留给后续原语句，避免叠加硬编码空格造成错位。
  const eol = detectLineEnding(source)
  const anchorLine = lineStartAt(source, insertionPoint.offset, eol)
  const nextSource =
    source.slice(0, anchorLine.start) +
    `${anchorLine.indent}${formatMotion(kind)}${eol}` +
    source.slice(anchorLine.start)

  return {
    ok: true,
    result: {
      source: nextSource,
      programRemap: { inserted: { at: insertionIndex, count: 1 } },
    },
  }
}

/** 模块级新 robtarget 声明的插入片段：插到 main PROC 行首，缩进沿用 PROC 行（模块级）缩进。 */
function declarationInsertion(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  name: string,
  target: RobTarget,
): { offset: number; text: string } {
  const eol = detectLineEnding(source)
  const procLine = lineStartAt(source, parsed.dataInsertOffset, eol)
  return {
    offset: procLine.start,
    text: `${procLine.indent}${formatTargetDeclaration(name, target)}${eol}`,
  }
}

function editMotionOperand(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  command: Extract<RapidEditCommand, { type: 'edit-motion-operand' }>,
): RapidEditResult {
  const indexError = instructionAt(parsed, command.index)
  if (indexError) return { ok: false, error: indexError }
  const instruction = parsed.instructions[command.index]
  if (instruction.kind !== 'movej' && instruction.kind !== 'movel') {
    return {
      ok: false,
      error: { code: 'invalid-instruction', message: `第 ${command.index + 1} 条指令不是运动指令` },
    }
  }

  const replacements: Array<{ offset: number; endOffset?: number; text: string }> = []

  if (command.operand === 'target') {
    const range = instruction.operandRanges.target
    if (command.value.source === 'existing') {
      const entry = findTarget(parsed, command.value.name)
      if (!entry) {
        return {
          ok: false,
          error: { code: 'undefined-target', message: `未定义 robtarget ${command.value.name}` },
        }
      }
      // 允许把 Offs/RelTool 表达式或 `*` 占位整体替换为命名点位。
      replacements.push({
        offset: range.start.offset,
        endOffset: range.end.offset,
        text: entry.name,
      })
    } else {
      const existing = allSymbolNames(parsed)
      const autoName = findAvailableTargetName(parsed)
      const nameError = validateNewName(autoName, existing)
      if (nameError) return { ok: false, error: nameError }
      // 原子两步：模块级新建声明（记录当前 TCP）+ 替换目标操作数。
      replacements.push({
        offset: range.start.offset,
        endOffset: range.end.offset,
        text: autoName,
      })
      replacements.push(declarationInsertion(source, parsed, autoName, command.value.target))
    }
  } else {
    const dataKind = command.operand === 'speed' ? 'speeddata' : 'zonedata'
    const key = normalizeName(command.value.name)
    const exists = parsed.data.some(
      (entry) => entry.kind === dataKind && normalizeName(entry.name) === key,
    )
    if (!exists) {
      return {
        ok: false,
        error: {
          code: 'undefined-operand',
          message: `未定义 ${dataKind} ${command.value.name}`,
        },
      }
    }
    const range =
      command.operand === 'speed' ? instruction.operandRanges.speed : instruction.operandRanges.zone
    // 用列表中的原始拼写替换（系统预定义名大小写与源码习惯一致）。
    const displayName =
      parsed.data.find((entry) => entry.kind === dataKind && normalizeName(entry.name) === key)
        ?.name ?? command.value.name
    replacements.push({ offset: range.start.offset, endOffset: range.end.offset, text: displayName })
  }

  return {
    ok: true,
    result: {
      source: applyReplacements(source, replacements),
      programTextChangedAt: command.index,
    },
  }
}

/** 指令必须只占一行：本项目的运动/赋值/控制流语句均为单行，多行暂不支持行级编辑。 */
function singleLineError(
  instruction: { sourceRange: { start: { line: number }; end: { line: number } } },
  index: number,
  action: string,
): RapidEditError | null {
  if (instruction.sourceRange.start.line !== instruction.sourceRange.end.line) {
    return {
      code: 'invalid-instruction',
      message: `第 ${index + 1} 条指令跨多行，暂不支持${action}`,
    }
  }
  return null
}

/** 指令所在整行的范围（含行首与行尾换行）。 */
function instructionLineSpan(
  source: string,
  instruction: { sourceRange: { start: { offset: number }; end: { offset: number } } },
): { start: number; end: number } {
  const eol = detectLineEnding(source)
  const previousEol = source.lastIndexOf(eol, instruction.sourceRange.start.offset - 1)
  const start = previousEol === -1 ? 0 : previousEol + eol.length
  const lineEnd = source.indexOf(eol, instruction.sourceRange.end.offset)
  const end = lineEnd === -1 ? source.length : lineEnd + eol.length
  return { start, end }
}

function deleteInstruction(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  index: number,
): RapidEditResult {
  const indexError = instructionAt(parsed, index)
  if (indexError) return { ok: false, error: indexError }
  const instruction = parsed.instructions[index]
  const multiLine = singleLineError(instruction, index, '整行删除')
  if (multiLine) return { ok: false, error: multiLine }

  const span = instructionLineSpan(source, instruction)
  const nextSource = source.slice(0, span.start) + source.slice(span.end)
  const guard = guardEditedSource(nextSource)
  if (guard) return { ok: false, error: guard }
  return {
    ok: true,
    result: { source: nextSource, programRemap: { removed: [index] } },
  }
}

function commentInstructions(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  indices: readonly number[],
): RapidEditResult {
  if (indices.length === 0) {
    return { ok: false, error: { code: 'invalid-instruction', message: '没有指定要注释的指令' } }
  }
  const replacements: Array<{ offset: number; text: string }> = []
  const seen = new Set<number>()
  for (const index of indices) {
    const indexError = instructionAt(parsed, index)
    if (indexError) return { ok: false, error: indexError }
    if (seen.has(index)) continue
    seen.add(index)
    const instruction = parsed.instructions[index]
    const multiLine = singleLineError(instruction, index, '注释')
    if (multiLine) return { ok: false, error: multiLine }
    // 行首插入 `!`：整行变为注释，缩进保留在注释文本内。
    replacements.push({ offset: instructionLineSpan(source, instruction).start, text: '!' })
  }

  const nextSource = applyReplacements(source, replacements)
  const guard = guardEditedSource(nextSource)
  if (guard) return { ok: false, error: guard }
  return {
    ok: true,
    result: { source: nextSource, programRemap: { removed: [...seen].sort((a, b) => a - b) } },
  }
}

/** 计算 1 起始行号的行起始 offset；行号越界返回 -1。 */
function lineStartOffsetOfLine(source: string, line: number): number {
  if (line < 1) return -1
  let offset = 0
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const next = source.indexOf('\n', offset)
    if (next === -1) return -1
    offset = next + 1
  }
  return offset
}

function uncommentLines(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  lines: readonly number[],
): RapidEditResult {
  if (lines.length === 0) {
    return { ok: false, error: { code: 'invalid-instruction', message: '没有指定要取消注释的行' } }
  }
  const replacements: Array<{ offset: number; endOffset: number; text: string }> = []
  const sortedOffsets: number[] = []
  for (const line of [...lines].sort((a, b) => a - b)) {
    const lineStart = lineStartOffsetOfLine(source, line)
    if (lineStart === -1) {
      return { ok: false, error: { code: 'invalid-instruction', message: `行 ${line} 不存在` } }
    }
    // 跳过行首空白后必须是 `!`，否则该行不是注释行。
    let cursorPos = lineStart
    while (source[cursorPos] === ' ' || source[cursorPos] === '\t') cursorPos += 1
    if (source[cursorPos] !== '!') {
      return {
        ok: false,
        error: { code: 'invalid-instruction', message: `第 ${line} 行不是注释行` },
      }
    }
    replacements.push({ offset: cursorPos, endOffset: cursorPos + 1, text: '' })
    sortedOffsets.push(lineStart)
  }

  const nextSource = applyReplacements(source, replacements)
  const guard = guardEditedSource(nextSource)
  if (guard) return { ok: false, error: guard }

  // PP 重映射：取消注释引入的指令数与位置由重新解析得出（注释行不一定是可执行指令）。
  const next = parseRapidProgram(nextSource)
  const firstOffset = sortedOffsets[0]
  const at = next.instructions.filter(
    (instruction) => instruction.sourceRange.start.offset < firstOffset,
  ).length
  const count = next.instructions.length - parsed.instructions.length
  return {
    ok: true,
    result: {
      source: nextSource,
      programRemap: count > 0 ? { inserted: { at, count } } : undefined,
    },
  }
}

function changeMotionKind(
  source: string,
  parsed: ReturnType<typeof parseRapidProgram>,
  index: number,
): RapidEditResult {
  const indexError = instructionAt(parsed, index)
  if (indexError) return { ok: false, error: indexError }
  const instruction = parsed.instructions[index]
  if (instruction.kind !== 'movej' && instruction.kind !== 'movel') {
    return {
      ok: false,
      error: { code: 'invalid-instruction', message: `第 ${index + 1} 条指令不是运动指令` },
    }
  }
  const start = instruction.sourceRange.start.offset
  const keyword = instruction.kind === 'movej' ? 'MoveL' : 'MoveJ'
  // sourceRange 从关键字 token 开始；原关键字恰为 5 字符（MoveJ/MoveL）。
  const nextSource = source.slice(0, start) + keyword + source.slice(start + 5)
  return {
    ok: true,
    result: { source: nextSource, programTextChangedAt: index },
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
export function makeTaughtTargetFromPose(pose: Pose, currentJoints?: JointAngles): RobTarget {
  const internalQuat = rotationMatrixToQuaternion(pose.rotation)
  const rapidQuat = internalQuatToRapid(internalQuat)
  const taught = makeEmptyTaughtTarget([pose.position[0], pose.position[1], pose.position[2]], rapidQuat)
  const configuration = currentJoints ? abbConfigurationFromJoints(currentJoints) : null
  if (configuration) taught.robconf = [...configuration]
  return taught
}
