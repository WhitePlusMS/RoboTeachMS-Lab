import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
  type StringStream,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'

/**
 * RAPID 语法高亮（CodeMirror 视图层）。
 *
 * 这是「分词与配色分离」的编辑器视图实现，不属于解析/执行路径：
 * 用 CodeMirror 的 StreamLanguage 二次切分源码以产出高亮 token，
 * 再把 token 类别映射到 ABB 官方浅色配色（关键词蓝、注释绿、字符串/常量粉、
 * 数字青、类型紫；文字黑由 --color-text 继承）。配色值一律引用主题 token
 * （src/theme/tokens.ts 的 --hl-*），与页面单一数据源一致。
 *
 * 注意：本模块是高亮用的轻量词法器，与 rapid-parser 的 rapid-lexer 职责不同
 * （后者做结构化解析）。不在此维护点位/符号表，也不建平行解析。
 */

/** RAPID 结构化关键字（限定符蓝）。大小写不敏感，命中时归一化比较。 */
const RAPID_KEYWORDS = new Set([
  'module',
  'endmodule',
  'proc',
  'endproc',
  'func',
  'endfunc',
  'trap',
  'endtrap',
  'record',
  'endrecord',
  'local',
  'const',
  'var',
  'pers',
  'if',
  'then',
  'elseif',
  'else',
  'endif',
  'while',
  'endwhile',
  'for',
  'endfor',
  'to',
  'do',
  'return',
  'goto',
  'test',
  'case',
  'default',
  'endtest',
  'exitdo',
  'broken',
  'break',
  'exit',
  'wait',
  'inpos',
  'stop',
  'abort',
  'bypass',
  'trigger',
  'error',
  'undo',
  'recover',
  'trynext',
])

/** RAPID 数据类型名（类型紫）。含本项目已支持与未支持的真实 RAPID 类型。 */
const RAPID_TYPES = new Set([
  'num',
  'bool',
  'robtarget',
  'tooldata',
  'wobjdata',
  'loaddata',
  'speeddata',
  'zonedata',
  'pos',
  'orientation',
  'pose',
  'jointtarget',
  'string',
  'int',
  'intnum',
  'dnum',
  'byte',
  'word',
  'clock',
  'errstr',
  'signalai',
  'signaldi',
  'signalao',
  'signaldo',
  'signalgi',
  'signalgo',
  'shapedata',
  'identno',
  'tracemem',
])

/** RAPID 特殊常量（常量粉）：布尔/空字面量按 RAPID 官方归为常量高亮。 */
const RAPID_CONSTANTS = new Set(['true', 'false', 'null'])

/** 数字字面量：整数/小数与科学计数法（不吞前置正负号，保持表达式词法同解析器一致）。 */
const NUMBER_START = /[0-9]/
const NUMBER_REST = /^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/

/** 字符串字面量：`"` 到下一个 `"`（与 rapid-lexer 相同的单行语义）。 */
function tokenString(stream: StringStream): string | null {
  stream.next() // 开引号
  stream.eatWhile((ch) => ch !== '"')
  if (!stream.eol()) stream.next() // 闭引号
  return 'string'
}

/**
 * RAPID StreamLanguage 词法：逐 token 返回高亮类别名。该类别名会挂到
 * 标准 highlight tag（keyword / comment / string / number / typeName / constant / operator / punctuation）。
 */
const rapidParser: StreamParser<Record<string, never>> = {
  name: 'rapid',
  token(stream) {
    stream.eatSpace()
    if (stream.eol()) return null

    const ch = stream.peek()
    // 行注释：`!` 到行尾。
    if (ch === '!') {
      stream.skipToEnd()
      return 'lineComment'
    }
    // 字符串字面量。
    if (ch === '"') return tokenString(stream)

    // 数字字面量（以数字或小数点开头）。
    if (ch && NUMBER_START.test(ch)) {
      if (stream.match(NUMBER_REST, true)) return 'number'
    }

    // 标识符 → 关键字 / 类型 / 常量 / 普通名。
    if (ch && /[A-Za-z_]/.test(ch)) {
      if (stream.match(IDENTIFIER, true)) {
        const text = stream.current().toLocaleLowerCase('en-US')
        if (RAPID_KEYWORDS.has(text)) return 'keyword'
        if (RAPID_TYPES.has(text)) return 'typeName'
        if (RAPID_CONSTANTS.has(text)) return 'constant'
        return 'variableName'
      }
    }

    // 复合/单字符运算符与标点。
    if (stream.match(/:=/, true)) return 'operator'
    if (stream.match(/<>|<=|>=|==|<|>|=|\+|-|\*|\/|\\/, true)) return 'operator'
    if (stream.match(/[\](){};:,.[]/, true)) return 'punctuation'
    if (stream.match(/\\[A-Za-z]+/, true)) return 'operator'

    // 兜底：吞掉一个字符避免死循环。
    stream.next()
    return null
  },
}

/** RAPID 语言：StreamLanguage 实例（含分词）。 */
export const rapidLanguage = StreamLanguage.define(rapidParser)

/**
 * ABB 官方浅色语法配色。颜色引用主题 token（--hl-*），保证与页面单一数据源一致、
 * 浅编辑背景上对比度达标。普通标识符/变量与运算符不发色（继承 --color-text）。
 */
export const rapidHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--hl-keyword)' },
  { tag: [tags.comment, tags.lineComment], color: 'var(--hl-comment)' },
  { tag: [tags.string, tags.character], color: 'var(--hl-string)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--hl-number)' },
  { tag: [tags.typeName, tags.className], color: 'var(--hl-type)' },
  { tag: [tags.constant(tags.name), tags.bool], color: 'var(--hl-constant)' },
])

/** 把 RAPID 分词附着到编辑器的语法高亮扩展。 */
export const rapidHighlighting = syntaxHighlighting(rapidHighlightStyle)

/** 便捷组合：RAPID 语言 + 高亮，作为 CodeMirror extensions 直接传入。 */
export const rapid = [rapidLanguage, rapidHighlighting]
