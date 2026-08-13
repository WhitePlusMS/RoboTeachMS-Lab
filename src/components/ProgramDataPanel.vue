<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { makeEmptyTaughtTarget, type RapidEditCommand, type RapidEditResult } from '../rapid/controlled-rapid-edit.ts'
import type {
  RapidDataKind,
  RapidExecutableInstruction,
  RapidMotionInsertionPoint,
  RapidProgramData,
  RapidSourceRange,
} from '../rapid/rapid-parser.ts'
import { isRapidMotionInstruction, isRobtargetProgramData } from '../rapid/rapid-parser.ts'
import type { RapidScalarVariable, RobTarget, ToolData, WobjData, SpeedData, ZoneData, LoadData } from '../rapid/rapid-types.ts'
import type { Pose } from '../robotics/types.ts'
import { rotationMatrixToQuaternion } from '../robotics/math/rotation3d.ts'
import { internalQuatToRapid } from '../rapid/plan-shared.ts'

interface Props {
  /** 完整 Program Data 联合（六类运动数据、num/bool 标量与系统预定义项）。 */
  data: readonly RapidProgramData[]
  /** 当前活动/下一条指令下标；用于高亮当前使用的 Tool/WObj/Speed/Zone/目标。非 null 时指向 program。 */
  activeIndex: number | null
  /** 源程序是否干净可执行；存在 error 时 Program Data 只读浏览、禁用结构化编辑与运行。 */
  canExecute: boolean
  /** 当前 main 中可用的运动插入位置。 */
  insertionPoints: readonly RapidMotionInsertionPoint[]
  /** 当前已解析运动，用于把插入位置显示成可理解的教学标签，也用于高亮当前指令。 */
  program: readonly RapidExecutableInstruction[]
  /** 当前活动 tool0 TCP（ABB 基座坐标），用于示教新目标值。 */
  pose: Pose | null
  /** 来自 ProgramExecutor 快照的标量当前值；缺少条目时回退到声明初值。 */
  runtimeValues?: ReadonlyMap<string, RapidScalarVariable>
  /** 唯一受控编辑入口；返回结果以展示结构化拒绝原因。 */
  applyEdit: (command: RapidEditCommand) => RapidEditResult
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'view-reference': [range: RapidSourceRange]
}>()

/** 可浏览的数据种类（按 ABB 示教器习惯）；loaddata 作为工具负载数据随 tooldata 展示，不单列 Tab。 */
const KINDS: ReadonlyArray<{ kind: RapidDataKind; label: string }> = [
  { kind: 'robtarget', label: 'robtarget' },
  { kind: 'tooldata', label: 'tooldata' },
  { kind: 'wobjdata', label: 'wobjdata' },
  { kind: 'speeddata', label: 'speeddata' },
  { kind: 'zonedata', label: 'zonedata' },
  { kind: 'num', label: 'num' },
  { kind: 'bool', label: 'bool' },
]
const activeKind = ref<RapidDataKind>('robtarget')

/** 当前指令的高亮信息：使用的 target/speed/zone/tool/wobj 名称（原始拼写），及其 zone 是否 fly-by。 */
const activeInstruction = computed(() =>
  props.activeIndex === null || props.activeIndex === undefined ? null : (props.program[props.activeIndex] ?? null),
)
const activeOperandNames = computed(() => {
  const instruction = activeInstruction.value
  if (!instruction || !isRapidMotionInstruction(instruction)) return { target: '', speed: '', zone: '', tool: '', wobj: '' }
  return instruction.operands
})
const activeZoneFlyBy = computed(() => {
  const instruction = activeInstruction.value
  return !!instruction && isRapidMotionInstruction(instruction) && !instruction.zone.finep
})

// —— robtarget（点位示教）专用视图状态 ——
type PanelView = 'list' | 'detail'
const panelView = ref<PanelView>('list')
const filterQuery = ref('')
const selectedName = ref<string | null>(null)
const selectionExpanded = ref(false)
const newTargetName = ref('')
const renaming = ref(false)
const renameValue = ref('')
const editError = ref<string | null>(null)
const insertionIndex = ref<number | null>(null)

const robtargetEntries = computed(() => props.data.filter(isRobtargetProgramData))

const filteredTargets = computed(() => {
  const query = filterQuery.value.trim().toLocaleLowerCase()
  if (!query) return robtargetEntries.value
  return robtargetEntries.value.filter((target) => target.name.toLocaleLowerCase().includes(query))
})

const selectedTarget = computed(() => {
  if (!selectedName.value) return null
  const normalized = selectedName.value.toLocaleLowerCase()
  return robtargetEntries.value.find((target) => target.name.toLocaleLowerCase() === normalized) ?? null
})

const selectedInsertionIndex = computed(() => {
  const points = props.insertionPoints
  if (points.length === 0) return 0
  if (insertionIndex.value !== null && points.some((point) => point.index === insertionIndex.value)) {
    return insertionIndex.value
  }
  return points[points.length - 1].index
})

const insertionSelection = computed({
  get: () => selectedInsertionIndex.value,
  set: (value: number | string) => {
    insertionIndex.value = Number(value)
  },
})

/** 把当前 ABB 基座 tool0 TCP 转为 RAPID robtarget；MVP 明确使用零 robconf。 */
const taughtRobTarget = computed<RobTarget | null>(() => {
  if (!props.pose) return null
  const quat = rotationMatrixToQuaternion(props.pose.rotation)
  return makeEmptyTaughtTarget(
    [props.pose.position[0], props.pose.position[1], props.pose.position[2]],
    internalQuatToRapid(quat),
  )
})

watch(
  () => props.data,
  (data) => {
    if (selectedName.value && !data.some((d) => d.name.toLocaleLowerCase() === selectedName.value?.toLocaleLowerCase())) {
      selectedName.value = null
      panelView.value = 'list'
    }
  },
)

watch(filterQuery, (query) => {
  if (!selectedName.value) return
  const normalized = selectedName.value.toLocaleLowerCase()
  if (query.trim() && !filteredTargets.value.some((target) => target.name.toLocaleLowerCase() === normalized)) {
    selectedName.value = null
    panelView.value = 'list'
  }
})

function formatCoord(value: readonly number[]): string {
  return value.map((entry) => (Number.isFinite(entry) ? entry.toFixed(1) : '—')).join(', ')
}

function formatRotation(rot: readonly number[]): string {
  return rot.map((entry) => entry.toFixed(3)).join(', ')
}

function formatNum(value: number): string {
  return Number.isFinite(value) ? String(value) : '—'
}

/** 标量 Program Data 的声明初值展示；运行当前值从 ProgramExecutor 快照读取。 */
function scalarValueLabel(entry: RapidProgramData): string {
  if (entry.kind === 'num') return formatNum(entry.value)
  if (entry.kind === 'bool') return entry.value ? 'TRUE' : 'FALSE'
  return ''
}

function currentScalarValueLabel(entry: RapidProgramData): string {
  if (entry.kind !== 'num' && entry.kind !== 'bool') return ''
  const current = props.runtimeValues?.get(entry.name.toLocaleLowerCase('en-US'))
  if (!current || current.kind !== entry.kind) return scalarValueLabel(entry)
  return current.kind === 'num' ? formatNum(current.value) : (current.value ? 'TRUE' : 'FALSE')
}

function referenceLabel(references: readonly RapidSourceRange[]): string {
  if (references.length === 0) return '未被引用'
  if (references.length === 1) return '1 处引用'
  return `${references.length} 处引用`
}

function selectTarget(name: string): void {
  selectedName.value = name
  selectionExpanded.value = true
  panelView.value = 'list'
  renaming.value = false
  editError.value = null
}

function openDetails(): void {
  if (!selectedTarget.value) return
  panelView.value = 'detail'
  editError.value = null
}

function runEdit(command: RapidEditCommand): void {
  const result = props.applyEdit(command)
  editError.value = result.ok ? null : result.error.message
}

function createTarget(): void {
  if (!taughtRobTarget.value) {
    editError.value = '当前姿态不可用，无法示教点位'
    return
  }
  const name = newTargetName.value.trim()
  if (!name) {
    editError.value = '请输入新点位名称'
    return
  }
  runEdit({ type: 'create-target', name, target: taughtRobTarget.value })
  if (!editError.value) newTargetName.value = ''
}

function modifyPosition(): void {
  const target = selectedTarget.value
  if (!target) return
  if (!taughtRobTarget.value) {
    editError.value = '当前姿态不可用，无法更新点位'
    return
  }
  runEdit({ type: 'modify-position', name: target.name, target: taughtRobTarget.value })
}

function startRename(): void {
  const target = selectedTarget.value
  if (!target) return
  renaming.value = true
  renameValue.value = target.name
  editError.value = null
}

function commitRename(): void {
  const target = selectedTarget.value
  if (!target) return
  runEdit({ type: 'rename-target', name: target.name, newName: renameValue.value.trim() })
  if (!editError.value) {
    selectedName.value = renameValue.value.trim()
    renaming.value = false
  }
}

function deleteTarget(): void {
  const target = selectedTarget.value
  if (!target) return
  runEdit({ type: 'delete-target', name: target.name })
}

function insertMotion(kind: 'movej' | 'movel'): void {
  const target = selectedTarget.value
  if (!target) return
  runEdit({ type: 'insert-motion', name: target.name, kind, insertionIndex: selectedInsertionIndex.value })
}

function insertionLabel(point: RapidMotionInsertionPoint): string {
  if (point.index >= props.program.length) return '程序末尾'
  const instruction = props.program[point.index]
  const label = isRapidMotionInstruction(instruction)
    ? (instruction.kind === 'movej' ? 'MoveJ' : 'MoveL')
    : '赋值'
  return `第 ${point.index + 1} 条之前 · ${label} · 行 ${point.line}`
}

// —— 非 robtarget 只读浏览 ——
const readonlyEntries = computed(() => props.data.filter((d) => d.kind === activeKind.value && d.kind !== 'robtarget'))
const selectedReadonlyName = ref<string | null>(null)
const selectedReadonly = computed(() => {
  if (!selectedReadonlyName.value) return null
  const query = selectedReadonlyName.value.toLocaleLowerCase()
  return readonlyEntries.value.find((entry) => entry.name.toLocaleLowerCase() === query) ?? null
})
watch(readonlyEntries, (entries) => {
  if (selectedReadonlyName.value && !entries.some((e) => e.name.toLocaleLowerCase() === selectedReadonlyName.value?.toLocaleLowerCase())) {
    selectedReadonlyName.value = null
  }
})

/** 某个数据种类对应的当前指令操作数名称（用于高亮）。 */
function activeOperandForKind(kind: RapidDataKind): string {
  switch (kind) {
    case 'tooldata': return activeOperandNames.value.tool
    case 'wobjdata': return activeOperandNames.value.wobj
    case 'speeddata': return activeOperandNames.value.speed
    case 'zonedata': return activeOperandNames.value.zone
    default: return ''
  }
}

/** 是否高亮该名称（当前指令使用它）。 */
function isActiveName(expected: string, actual: string): boolean {
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
    ['tload.ix/iy/iz', `${formatNum(tool.tload.ix)} / ${formatNum(tool.tload.iy)} / ${formatNum(tool.tload.iz)}`],
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

/** 只读条目的字段表（按 kind）。 */
function readonlyFields(entry: RapidProgramData): Array<[string, string]> {
  if (activeKind.value !== entry.kind) return []
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
      return [['初值', scalarValueLabel(entry)], ['当前值', currentScalarValueLabel(entry)]]
    case 'robtarget':
      return []
  }
}
</script>

<template>
  <section class="program-data-panel" aria-labelledby="program-data-title">
    <div class="panel-title-row">
      <div>
        <p class="panel-kicker">PROGRAM DATA</p>
        <h2 id="program-data-title">程序数据</h2>
      </div>
      <span class="control-status" :class="props.canExecute ? 'program-state-idle' : 'program-state-error'">
        {{ props.canExecute ? '就绪' : '含错误' }}
      </span>
    </div>

    <p class="program-data-hint">
      {{ props.canExecute ? 'RAPID 模块 · 按数据类型浏览运动数据' : '源程序存在错误：仅只读浏览，已禁用结构化编辑与运行。' }}
    </p>
    <p v-if="editError" class="program-data-error">{{ editError }}</p>
    <p v-if="selectedReadonly" class="program-data-hint">非 robtarget 数据只读展示，避免产生第二份隐藏数据。</p>

    <div class="program-data-kind-tabs" role="tablist" aria-label="数据类型">
      <button
        v-for="kind in KINDS"
        :key="kind.kind"
        type="button"
        role="tab"
        class="program-data-kind-tab"
        :class="{ active: activeKind === kind.kind }"
        :aria-selected="activeKind === kind.kind"
        @click="activeKind = kind.kind"
      >{{ kind.label }}</button>
    </div>

    <!-- 当前指令高亮：目标/速度/zone/工具/工件 + fly-by 提示 -->
    <div v-if="activeInstruction" class="program-data-active" aria-label="当前指令操作数">
      <span class="program-data-active-kind">{{ activeInstruction.kind === 'movej' ? 'MoveJ' : 'MoveL' }}</span>
      <span>目标 {{ activeOperandNames.target || '—' }}</span>
      <span>速度 {{ activeOperandNames.speed || '—' }}</span>
      <span>zone {{ activeOperandNames.zone || '—' }}</span>
      <span>工具 {{ activeOperandNames.tool || '—' }}</span>
      <span v-if="activeOperandNames.wobj">工件 {{ activeOperandNames.wobj }}</span>
      <span v-if="activeZoneFlyBy" class="program-data-flyby-hint">fly-by：MVP 未模拟路径融合</span>
    </div>

    <!-- robtarget：点位示教（含写操作） -->
    <template v-if="activeKind === 'robtarget'">
      <template v-if="panelView === 'list'">
        <div class="program-data-toolbar">
          <span class="program-data-type-count">robtarget · {{ robtargetEntries.length }} 项</span>
          <input
            v-model="filterQuery"
            class="program-data-filter"
            type="search"
            aria-label="按名称筛选点位"
            placeholder="按名称筛选"
            spellcheck="false"
          />
        </div>

        <div v-if="props.canExecute" class="program-data-teach">
          <div class="program-data-teach-heading">
            <p class="program-data-teach-title">从当前 TCP 新建点位</p>
            <span class="program-data-teach-preview">{{ taughtRobTarget ? formatCoord(taughtRobTarget.trans) : '当前 TCP 不可用' }}</span>
          </div>
          <div class="program-data-teach-row">
            <input
              v-model="newTargetName"
              class="program-data-name-input"
              aria-label="新点位名称"
              placeholder="如 pPick"
              spellcheck="false"
              @keyup.enter="createTarget"
            />
            <button type="button" class="primary-action" @click="createTarget">新建点位</button>
          </div>
        </div>

        <ul v-if="filteredTargets.length > 0" class="program-data-list" aria-label="robtarget 点位列表">
          <li
            v-for="target in filteredTargets"
            :key="`${target.nameRange.start.offset}-${target.name}`"
            class="program-data-item"
            :class="{
              selected: selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase(),
              active: isActiveName(target.name, activeOperandNames.target),
            }"
          >
            <button
              type="button"
              class="program-data-row"
              :aria-label="`选择点位 ${target.name}`"
              :aria-pressed="selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase()"
              @click="selectTarget(target.name)"
            >
              <span class="program-data-row-name">{{ target.name }}</span>
              <span class="program-data-label program-data-storage">{{ target.storage }}</span>
              <span class="program-data-row-coord">[{{ formatCoord(target.target.trans) }}]</span>
              <span class="program-data-label program-data-references">{{ referenceLabel(target.referenceRanges) }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="program-data-empty">
          {{ robtargetEntries.length === 0 ? '源码中尚未声明 robtarget，或未识别到命名点位。' : '没有匹配的点位。' }}
        </p>

        <div v-if="selectedTarget" class="program-data-selection" aria-label="选中点位操作">
          <div class="program-data-selection-heading">
            <div>
              <span class="panel-kicker">SELECTED TARGET</span>
              <strong>{{ selectedTarget.name }}</strong>
            </div>
            <div class="program-data-selection-heading-actions">
              <span class="program-data-references-text">{{ referenceLabel(selectedTarget.referenceRanges) }}</span>
              <button
                type="button"
                class="program-data-selection-toggle"
                :aria-expanded="selectionExpanded"
                @click="selectionExpanded = !selectionExpanded"
              >{{ selectionExpanded ? '收起' : '展开' }}</button>
            </div>
          </div>
          <template v-if="selectionExpanded">
            <p v-if="selectedTarget.referenceRanges.length > 0" class="program-data-share-warning">
              共享目标：示教将影响 {{ selectedTarget.referenceRanges.length }} 处引用
            </p>
            <div v-if="selectedTarget.referenceRanges.length > 0" class="program-data-reference-links">
              <button
                v-for="(range, index) in selectedTarget.referenceRanges"
                :key="`${range.start.offset}-${index}`"
                type="button"
                class="program-data-reference-link"
                @click="emit('view-reference', range)"
              >查看引用 · 行 {{ range.start.line }}</button>
            </div>
            <div v-if="props.canExecute" class="program-data-actions">
              <button type="button" class="secondary-action" @click="modifyPosition">Modify Position（更新位置）</button>
              <button type="button" class="secondary-action" @click="openDetails">编辑数据</button>
              <label class="program-data-insert-position">
                插入位置
                <select v-model="insertionSelection" aria-label="插入位置">
                  <option v-for="point in props.insertionPoints" :key="point.index" :value="point.index">
                    {{ insertionLabel(point) }}
                  </option>
                </select>
              </label>
              <button type="button" class="secondary-action" @click="insertMotion('movej')">插入 MoveJ</button>
              <button type="button" class="secondary-action" @click="insertMotion('movel')">插入 MoveL</button>
            </div>
          </template>
        </div>
      </template>

      <template v-else-if="selectedTarget">
        <div class="program-data-detail-heading">
          <button type="button" class="secondary-action" @click="panelView = 'list'">返回列表</button>
          <div>
            <span class="panel-kicker">ROBTARGET DETAIL</span>
            <h3>{{ selectedTarget.name }}</h3>
          </div>
        </div>

        <div class="program-data-detail" aria-label="点位详情">
          <dl class="program-data-fields">
            <div><dt>存储</dt><dd>{{ selectedTarget.storage }}</dd></div>
            <div><dt>位置</dt><dd>{{ formatCoord(selectedTarget.target.trans) }}</dd></div>
            <div><dt>姿态</dt><dd>{{ formatRotation(selectedTarget.target.rot) }}</dd></div>
            <div><dt>robconf</dt><dd>{{ formatCoord(selectedTarget.target.robconf) }}（当前 MVP 未模拟构型控制）</dd></div>
            <div><dt>外轴</dt><dd>{{ formatCoord(selectedTarget.target.extax) }}</dd></div>
            <div><dt>引用</dt><dd>{{ referenceLabel(selectedTarget.referenceRanges) }}</dd></div>
          </dl>

          <div v-if="selectedTarget.referenceRanges.length > 0" class="program-data-reference-links">
            <button
              v-for="(range, index) in selectedTarget.referenceRanges"
              :key="`${range.start.offset}-${index}`"
              type="button"
              class="program-data-reference-link"
              @click="emit('view-reference', range)"
            >定位 RAPID 引用 · 行 {{ range.start.line }}</button>
          </div>

          <div v-if="props.canExecute" class="program-data-detail-actions">
            <button type="button" class="secondary-action" @click="modifyPosition">Modify Position（更新位置）</button>
            <template v-if="renaming">
              <input
                v-model="renameValue"
                class="program-data-name-input program-data-rename-input"
                aria-label="重命名点位"
                spellcheck="false"
                @keyup.enter="commitRename"
                @keyup.esc="renaming = false"
              />
              <button type="button" class="secondary-action" @click="commitRename">确认重命名</button>
              <button type="button" class="secondary-action" @click="renaming = false">取消</button>
            </template>
            <button v-else type="button" class="secondary-action" @click="startRename">重命名</button>
            <button type="button" class="danger-action" @click="deleteTarget">删除</button>
          </div>
        </div>
      </template>
    </template>

    <!-- 非 robtarget：只读列表 + 详情 -->
    <template v-else>
      <div class="program-data-toolbar">
        <span class="program-data-type-count">{{ activeKind }} · {{ readonlyEntries.length }} 项</span>
      </div>

      <ul v-if="readonlyEntries.length > 0" class="program-data-list" :aria-label="`${activeKind} 数据列表`">
        <li
          v-for="entry in readonlyEntries"
          :key="`${entry.kind}-${entry.name}`"
          class="program-data-item"
          :class="{ selected: selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase(), active: isActiveName(entry.name, activeOperandForKind(entry.kind)) }"
        >
          <button
            type="button"
            class="program-data-row"
            :aria-label="`选择 ${activeKind} ${entry.name}`"
            :aria-pressed="selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()"
            @click="selectedReadonlyName = entry.name"
          >
            <span class="program-data-row-name">{{ entry.name }}</span>
            <span v-if="entry.system" class="program-data-label program-data-system">系统只读</span>
            <span class="program-data-label program-data-storage">{{ entry.storage }}</span>
            <span v-if="entry.kind === 'num' || entry.kind === 'bool'" class="program-data-row-coord">初值 {{ scalarValueLabel(entry) }} · 当前 {{ currentScalarValueLabel(entry) }}</span>
            <span class="program-data-label program-data-references">{{ referenceLabel(entry.referenceRanges) }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="program-data-empty">源码/系统中尚未声明 {{ activeKind }}。</p>

      <div v-if="selectedReadonly" class="program-data-detail" :aria-label="`${activeKind} 详情`">
        <div class="program-data-detail-heading">
          <div>
            <span class="panel-kicker">{{ activeKind.toUpperCase() }} DETAIL</span>
            <h3>{{ selectedReadonly.name }}</h3>
          </div>
          <span v-if="selectedReadonly.system" class="program-data-label program-data-system">系统预定义 · 只读</span>
        </div>
        <dl class="program-data-fields">
          <div v-if="selectedReadonly.kind === 'num' || selectedReadonly.kind === 'bool'"><dt>类型</dt><dd>{{ selectedReadonly.kind }}</dd></div>
          <div><dt>存储</dt><dd>{{ selectedReadonly.storage }}</dd></div>
          <div v-for="[field, value] in readonlyFields(selectedReadonly)" :key="field">
            <dt>{{ field }}</dt><dd>{{ value }}</dd>
          </div>
          <div><dt>引用</dt><dd>{{ referenceLabel(selectedReadonly.referenceRanges) }}</dd></div>
        </dl>
        <div v-if="selectedReadonly.referenceRanges.length > 0" class="program-data-reference-links">
          <button
            v-for="(range, index) in selectedReadonly.referenceRanges"
            :key="`${range.start.offset}-${index}`"
            type="button"
            class="program-data-reference-link"
            @click="emit('view-reference', range)"
          >定位 RAPID 引用 · 行 {{ range.start.line }}</button>
        </div>
      </div>
    </template>
  </section>
</template>
