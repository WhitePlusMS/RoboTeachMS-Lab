import type {
  LoadData,
  RapidScalarKind,
  RobTarget,
  SpeedData,
  ToolData,
  WobjData,
  ZoneData,
} from '../data/index.ts'
import {
  SYSTEM_LOADDATA,
  SYSTEM_SPEED,
  SYSTEM_TOOLDATA,
  SYSTEM_WOBJDATA,
  SYSTEM_ZONE,
} from '../data/index.ts'
import type { RapidSourceRange, Token } from './rapid-lexer.ts'

/**
 * 符号表与操作数角色：模块级 Program Data 符号条目，以及运动操作数
 * （target/speed/zone/tool/wobj）各自的命名空间与类型校验映射。
 * 只包含纯数据与无状态的查找/字符串工具；不持有任何解析游标或诊断栈。
 */

/** Program Data 数据种类：六类 ABB 运动数据记录与首期 num/bool 标量。 */
export type RapidDataKind =
  'robtarget' | 'tooldata' | 'wobjdata' | 'loaddata' | 'speeddata' | 'zonedata' | RapidScalarKind

/** 运动操作数角色；引用结算与未定义诊断按角色分发到对应的符号命名空间。 */
export type OperandKind = 'target' | 'speed' | 'zone' | 'tool' | 'wobj'

export interface OperandSlotResult {
  token: Token | null
  separatorConsumed: boolean
}

export interface SymbolEntry {
  kind: RapidDataKind
  /** 已解析的声明值；robtarget 用 target，其余用 value。 */
  value:
    | { kind: 'robtarget'; value: RobTarget }
    | { kind: 'tooldata'; value: ToolData }
    | { kind: 'wobjdata'; value: WobjData }
    | { kind: 'loaddata'; value: LoadData }
    | { kind: 'speeddata'; value: SpeedData }
    | { kind: 'zonedata'; value: ZoneData }
    | { kind: 'num'; value: number }
    | { kind: 'bool'; value: boolean }
  /** 声明的名称范围。 */
  range: RapidSourceRange
  /** 完整声明语句范围（自存储关键字到分号）。 */
  declarationRange: RapidSourceRange
  /** 声明值字面量范围。 */
  valueRange: RapidSourceRange
  storage: 'const' | 'pers' | 'var'
  /** 各条运动指令操作数中引用该名称的源码范围。 */
  references: RapidSourceRange[]
}

export function normalizeName(text: string): string {
  return text.toLocaleLowerCase('en-US')
}

export function isSymbol(token: Token | undefined, text: string): boolean {
  return token?.kind === 'symbol' && token.text === text
}

export function isKeyword(token: Token | undefined, text: string): boolean {
  return token?.kind === 'identifier' && normalizeName(token.text) === normalizeName(text)
}

/**
 * 真实 RAPID 数据类型中本项目尚未支持的类型名。用于区分“漏写数据类型”
 * （后面跟的是名称）与“使用了已知但不支持的类型”。
 * 六类已支持的运动数据类型与首期 num/bool 标量不在此列。
 */
export const KNOWN_UNSUPPORTED_TYPES = new Set([
  'pos',
  'shapedata',
  'string',
  'int',
  'intnum',
  'dnum',
  'byte',
  'word',
  'clock',
  'errstr',
  'jointtarget',
  'signalai',
  'signaldi',
  'signalao',
  'signaldo',
  'signalgi',
  'signalgo',
])

/** 已支持的数据种类名 → kind，用于模块级声明分发。 */
export const SUPPORTED_DATA_KINDS: Record<string, RapidDataKind> = {
  robtarget: 'robtarget',
  tooldata: 'tooldata',
  wobjdata: 'wobjdata',
  loaddata: 'loaddata',
  speeddata: 'speeddata',
  zonedata: 'zonedata',
  num: 'num',
  bool: 'bool',
}

/** 系统预定义只读名称集合（tool0/wobj0/load0/官方 speed/zone）；源码不能重定义这些名称。 */
export const SYSTEM_NAMES = new Set<string>([
  ...Object.keys(SYSTEM_TOOLDATA),
  ...Object.keys(SYSTEM_WOBJDATA),
  ...Object.keys(SYSTEM_LOADDATA),
  ...Object.keys(SYSTEM_SPEED),
  ...Object.keys(SYSTEM_ZONE),
])

/** 模块级结构化关键字；出现在 MODULE 后而不是模块名称位置时，表示模块名称缺失。 */
export const MODULE_NAME_KEYWORDS = new Set([
  'proc',
  'func',
  'trap',
  'record',
  'const',
  'pers',
  'var',
  'module',
  'endmodule',
])

/** 操作数角色的人类可读描述（用于诊断文案）。 */
export function operandDescription(kind: OperandKind): string {
  switch (kind) {
    case 'target':
      return 'robtarget'
    case 'speed':
      return '速度'
    case 'zone':
      return 'zone'
    case 'tool':
      return '工具'
    case 'wobj':
      return '工件坐标'
  }
}

/** 操作数角色要求的用户符号数据种类；用于引用结算时的类型匹配校验。 */
export const OPERAND_KIND_SYMBOL_KIND: Record<OperandKind, RapidDataKind> = {
  target: 'robtarget',
  speed: 'speeddata',
  zone: 'zonedata',
  tool: 'tooldata',
  wobj: 'wobjdata',
}

/** 该操作数角色对应的系统预定义命名空间。 */
export function systemNamespace(kind: OperandKind): Record<string, unknown> {
  switch (kind) {
    case 'speed':
      return SYSTEM_SPEED
    case 'zone':
      return SYSTEM_ZONE
    case 'tool':
      return SYSTEM_TOOLDATA
    case 'wobj':
      return SYSTEM_WOBJDATA
    case 'target':
      return {}
  }
}
