import type { RapidDataKind, RapidProgramData, RapidSourceRange } from '@/rapid/language/index.ts'
import type { LoadData, RapidScalarVariable, SpeedData, ToolData, WobjData, ZoneData } from '@/rapid/data/index.ts'

/**
 * ProgramDataPanel 两个子视图（可编辑 robtarget 列表 / 只读浏览列表）共用的纯格式化与
 * 详情字段构建函数；不持有任何状态，Vue props/ref 全部改为显式参数传入。
 */

export function formatCoord(value: readonly number[]): string {
  return value.map((entry) => (Number.isFinite(entry) ? entry.toFixed(1) : '—')).join(', ')
}

export function formatRotation(rot: readonly number[]): string {
  return rot.map((entry) => entry.toFixed(3)).join(', ')
}

export function formatNum(value: number): string {
  return Number.isFinite(value) ? String(value) : '—'
}

/** 标量 Program Data 的声明初值展示；运行当前值从 ProgramExecutor 快照读取。 */
export function scalarValueLabel(entry: RapidProgramData): string {
  if (entry.kind === 'num') return formatNum(entry.value)
  if (entry.kind === 'bool') return entry.value ? 'TRUE' : 'FALSE'
  return ''
}

export function currentScalarValueLabel(
  entry: RapidProgramData,
  runtimeValues?: ReadonlyMap<string, RapidScalarVariable>,
): string {
  if (entry.kind !== 'num' && entry.kind !== 'bool') return ''
  const current = runtimeValues?.get(entry.name.toLocaleLowerCase('en-US'))
  if (!current || current.kind !== entry.kind) return scalarValueLabel(entry)
  return current.kind === 'num' ? formatNum(current.value) : current.value ? 'TRUE' : 'FALSE'
}

export function referenceLabel(references: readonly RapidSourceRange[]): string {
  if (references.length === 0) return '未被引用'
  if (references.length === 1) return '1 处引用'
  return `${references.length} 处引用`
}

/** 是否高亮该名称（当前指令使用它）。两个子视图都需要（robtarget/其余五类）。 */
export function isActiveName(expected: string, actual: string): boolean {
  return actual.toLocaleLowerCase() === expected.toLocaleLowerCase()
}

function toolDetail(tool: ToolData): Array<[string, string]> {
  return [
    ['robhold', tool.robhold ? 'TRUE' : 'FALSE'],
    ['tframe.trans', formatCoord(tool.tframe.trans)],
    ['tframe.rot', formatRotation(tool.tframe.rot)],
    ['tload.mass', formatNum(tool.tload.mass)],
    ['tload.cog', formatCoord(tool.tload.cog)],
    ['tload.aom', formatRotation(tool.tload.aom)],
    [
      'tload.ix/iy/iz',
      `${formatNum(tool.tload.ix)} / ${formatNum(tool.tload.iy)} / ${formatNum(tool.tload.iz)}`,
    ],
  ]
}

function wobjDetail(wobj: WobjData): Array<[string, string]> {
  return [
    ['robhold', wobj.robhold ? 'TRUE' : 'FALSE'],
    ['ufprog', wobj.ufprog ? 'TRUE' : 'FALSE'],
    ['ufmec', wobj.ufmec || '(空)'],
    ['uframe.trans', formatCoord(wobj.uframe.trans)],
    ['uframe.rot', formatRotation(wobj.uframe.rot)],
    ['oframe.trans', formatCoord(wobj.oframe.trans)],
    ['oframe.rot', formatRotation(wobj.oframe.rot)],
  ]
}

function speedDetail(speed: SpeedData): Array<[string, string]> {
  return [
    ['v_tcp', `${formatNum(speed.v_tcp)} mm/s`],
    ['v_ori', `${formatNum(speed.v_ori)} °/s`],
    ['v_leax', `${formatNum(speed.v_leax)} mm/s`],
    ['v_reax', `${formatNum(speed.v_reax)} °/s`],
  ]
}

function zoneDetail(zone: ZoneData): Array<[string, string]> {
  return [
    ['finep', zone.finep ? 'TRUE' : 'FALSE'],
    ['pzone_tcp', `${formatNum(zone.pzoneTcp)} mm`],
    ['pzone_ori', `${formatNum(zone.pzoneOri)} mm`],
    ['pzone_eax', `${formatNum(zone.pzoneEax)} mm`],
    ['zone_ori', `${formatNum(zone.zoneOri)} °`],
    ['zone_leax', `${formatNum(zone.zoneLeax)} mm`],
    ['zone_reax', `${formatNum(zone.zoneReax)} °`],
  ]
}

function loadDetail(load: LoadData): Array<[string, string]> {
  return [
    ['mass', `${formatNum(load.mass)} kg`],
    ['cog', formatCoord(load.cog)],
    ['aom', formatRotation(load.aom)],
    ['ix/iy/iz', `${formatNum(load.ix)} / ${formatNum(load.iy)} / ${formatNum(load.iz)}`],
  ]
}

/** 只读条目的字段表（按 kind）；只在只读浏览视图使用。 */
export function readonlyFields(
  entry: RapidProgramData,
  activeKind: RapidDataKind,
  runtimeValues?: ReadonlyMap<string, RapidScalarVariable>,
): Array<[string, string]> {
  if (activeKind !== entry.kind) return []
  switch (entry.kind) {
    case 'tooldata':
      return toolDetail(entry.value)
    case 'wobjdata':
      return wobjDetail(entry.value)
    case 'speeddata':
      return speedDetail(entry.value)
    case 'zonedata':
      return zoneDetail(entry.value)
    case 'loaddata':
      return loadDetail(entry.value)
    case 'num':
    case 'bool':
      return [
        ['初值', scalarValueLabel(entry)],
        ['当前值', currentScalarValueLabel(entry, runtimeValues)],
      ]
    case 'robtarget':
      return []
  }
}

/** 列表行右侧摘要：按数据类型显示关键字段；只在只读浏览视图使用。 */
export function rowSummary(
  entry: RapidProgramData,
  runtimeValues?: ReadonlyMap<string, RapidScalarVariable>,
): string {
  switch (entry.kind) {
    case 'robtarget':
      return formatCoord(entry.target.trans)
    case 'tooldata':
      return formatCoord(entry.value.tframe.trans)
    case 'wobjdata':
      return formatCoord(entry.value.uframe.trans)
    case 'speeddata':
      return `${formatNum(entry.value.v_tcp)} mm/s`
    case 'zonedata':
      return entry.value.finep ? 'fine' : `${formatNum(entry.value.pzoneTcp)} mm`
    case 'num':
    case 'bool':
      return `初值 ${scalarValueLabel(entry)} · 当前 ${currentScalarValueLabel(entry, runtimeValues)}`
    default:
      return ''
  }
}
