<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  makeEmptyTaughtTarget,
  type RapidEditCommand,
  type RapidEditResult,
} from '@/rapid/controlled-rapid-edit.ts'
import type {
  RapidDataKind,
  RapidExecutableInstruction,
  RapidMotionInsertionPoint,
  RapidProgramData,
  RapidSourceRange,
} from '@/rapid/rapid-parser.ts'
import { isRapidMotionInstruction, isRobtargetProgramData } from '@/rapid/rapid-parser.ts'
import type {
  RapidScalarVariable,
  RobTarget,
  ToolData,
  WobjData,
  SpeedData,
  ZoneData,
  LoadData,
} from '@/rapid/rapid-types.ts'
import type { Pose } from '@/robotics/types.ts'
import { rotationMatrixToQuaternion } from '@/robotics/math/rotation3d.ts'
import { internalQuatToRapid } from '@/rapid/plan-shared.ts'

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
  /** dock 内 content 模式不渲染自带标题行（dock 头部已显示「程序数据」）。 */
  display?: 'all' | 'content'
}

const props = defineProps<Props>()

const display = computed(() => props.display ?? 'all')

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
  props.activeIndex === null || props.activeIndex === undefined
    ? null
    : (props.program[props.activeIndex] ?? null),
)
const activeOperandNames = computed(() => {
  const instruction = activeInstruction.value
  if (!instruction || !isRapidMotionInstruction(instruction))
    return { target: '', speed: '', zone: '', tool: '', wobj: '' }
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

/** 删除二次确认：armed 后 3 秒未确认或切换选中/视图即复原。 */
const deleteArmed = ref(false)
let deleteArmTimer: number | null = null

function disarmDelete(): void {
  deleteArmed.value = false
  if (deleteArmTimer !== null) {
    window.clearTimeout(deleteArmTimer)
    deleteArmTimer = null
  }
}

function armDelete(): void {
  disarmDelete()
  deleteArmed.value = true
  deleteArmTimer = window.setTimeout(() => {
    deleteArmed.value = false
    deleteArmTimer = null
  }, 3000)
}

watch([selectedName, panelView], disarmDelete)

const robtargetEntries = computed(() => props.data.filter(isRobtargetProgramData))

const filteredTargets = computed(() => {
  const query = filterQuery.value.trim().toLocaleLowerCase()
  if (!query) return robtargetEntries.value
  return robtargetEntries.value.filter((target) => target.name.toLocaleLowerCase().includes(query))
})

const selectedTarget = computed(() => {
  if (!selectedName.value) return null
  const normalized = selectedName.value.toLocaleLowerCase()
  return (
    robtargetEntries.value.find((target) => target.name.toLocaleLowerCase() === normalized) ?? null
  )
})

const selectedInsertionIndex = computed(() => {
  const points = props.insertionPoints
  if (points.length === 0) return 0
  if (
    insertionIndex.value !== null &&
    points.some((point) => point.index === insertionIndex.value)
  ) {
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
    if (
      selectedName.value &&
      !data.some((d) => d.name.toLocaleLowerCase() === selectedName.value?.toLocaleLowerCase())
    ) {
      selectedName.value = null
      panelView.value = 'list'
    }
  },
)

watch(filterQuery, (query) => {
  if (!selectedName.value) return
  const normalized = selectedName.value.toLocaleLowerCase()
  if (
    query.trim() &&
    !filteredTargets.value.some((target) => target.name.toLocaleLowerCase() === normalized)
  ) {
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
  return current.kind === 'num' ? formatNum(current.value) : current.value ? 'TRUE' : 'FALSE'
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
  // 二次确认：第一次点击进入确认态，再次点击才提交受控删除。
  if (!deleteArmed.value) {
    armDelete()
    return
  }
  disarmDelete()
  runEdit({ type: 'delete-target', name: target.name })
}

function insertMotion(kind: 'movej' | 'movel'): void {
  const target = selectedTarget.value
  if (!target) return
  runEdit({
    type: 'insert-motion',
    name: target.name,
    kind,
    insertionIndex: selectedInsertionIndex.value,
  })
}

function insertionLabel(point: RapidMotionInsertionPoint): string {
  if (point.index >= props.program.length) return '程序末尾'
  const instruction = props.program[point.index]
  const label = isRapidMotionInstruction(instruction)
    ? instruction.kind === 'movej'
      ? 'MoveJ'
      : 'MoveL'
    : '赋值'
  return `第 ${point.index + 1} 条之前 · ${label} · 行 ${point.line}`
}

// —— 非 robtarget 只读浏览 ——
const readonlyEntries = computed(() =>
  props.data.filter((d) => d.kind === activeKind.value && d.kind !== 'robtarget'),
)
const selectedReadonlyName = ref<string | null>(null)
const selectedReadonly = computed(() => {
  if (!selectedReadonlyName.value) return null
  const query = selectedReadonlyName.value.toLocaleLowerCase()
  return readonlyEntries.value.find((entry) => entry.name.toLocaleLowerCase() === query) ?? null
})
watch(readonlyEntries, (entries) => {
  if (
    selectedReadonlyName.value &&
    !entries.some(
      (e) => e.name.toLocaleLowerCase() === selectedReadonlyName.value?.toLocaleLowerCase(),
    )
  ) {
    selectedReadonlyName.value = null
  }
})

/** 某个数据种类对应的当前指令操作数名称（用于高亮）。 */
function activeOperandForKind(kind: RapidDataKind): string {
  switch (kind) {
    case 'tooldata':
      return activeOperandNames.value.tool
    case 'wobjdata':
      return activeOperandNames.value.wobj
    case 'speeddata':
      return activeOperandNames.value.speed
    case 'zonedata':
      return activeOperandNames.value.zone
    default:
      return ''
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
      return [
        ['初值', scalarValueLabel(entry)],
        ['当前值', currentScalarValueLabel(entry)],
      ]
    case 'robtarget':
      return []
  }
}
</script>

<template>
  <section
    class="program-data-panel"
    :aria-labelledby="display !== 'content' ? 'program-data-title' : undefined"
    :aria-label="display === 'content' ? '程序数据' : undefined"
  >
    <div v-if="display !== 'content'" class="panel-title-row">
      <div>
        <p class="panel-kicker">PROGRAM DATA</p>
        <h2 id="program-data-title">程序数据</h2>
      </div>
      <span
        class="control-status"
        :class="props.canExecute ? 'program-state-idle' : 'program-state-error'"
      >
        {{ props.canExecute ? '就绪' : '含错误' }}
      </span>
    </div>

    <p v-if="!props.canExecute" class="program-data-hint">
      源程序存在错误：仅只读浏览，已禁用结构化编辑与运行。
    </p>
    <p v-if="editError" class="program-data-error">{{ editError }}</p>
    <p v-if="selectedReadonly" class="program-data-hint">
      非 robtarget 数据只读展示，避免产生第二份隐藏数据。
    </p>

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
      >
        {{ kind.label }}
      </button>
    </div>

    <!-- 当前指令高亮：目标/速度/zone/工具/工件 + fly-by 提示 -->
    <div v-if="activeInstruction" class="program-data-active" aria-label="当前指令操作数">
      <span class="program-data-active-kind">{{
        activeInstruction.kind === 'movej' ? 'MoveJ' : 'MoveL'
      }}</span>
      <span>目标 {{ activeOperandNames.target || '—' }}</span>
      <span>速度 {{ activeOperandNames.speed || '—' }}</span>
      <span>转弯区 {{ activeOperandNames.zone || '—' }}</span>
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
            <span class="program-data-teach-preview">{{
              taughtRobTarget ? formatCoord(taughtRobTarget.trans) : '当前 TCP 不可用'
            }}</span>
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

        <ul
          v-if="filteredTargets.length > 0"
          class="program-data-list"
          aria-label="robtarget 点位列表"
        >
          <li
            v-for="target in filteredTargets"
            :key="`${target.nameRange.start.offset}-${target.name}`"
            class="program-data-item"
            :class="{
              selected:
                selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase(),
              active: isActiveName(target.name, activeOperandNames.target),
            }"
          >
            <button
              type="button"
              class="program-data-row"
              :aria-label="`选择点位 ${target.name}`"
              :aria-pressed="
                selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase()
              "
              @click="selectTarget(target.name)"
            >
              <span class="program-data-row-name">{{ target.name }}</span>
              <span class="program-data-label program-data-storage">{{ target.storage }}</span>
              <span class="program-data-row-coord">[{{ formatCoord(target.target.trans) }}]</span>
              <span class="program-data-label program-data-references">{{
                referenceLabel(target.referenceRanges)
              }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="program-data-empty">
          {{
            robtargetEntries.length === 0
              ? '源码中尚未声明 robtarget，或未识别到命名点位。'
              : '没有匹配的点位。'
          }}
        </p>

        <div v-if="selectedTarget" class="program-data-selection" aria-label="选中点位操作">
          <div class="program-data-selection-heading">
            <div>
              <span class="panel-kicker">SELECTED TARGET</span>
              <strong>{{ selectedTarget.name }}</strong>
            </div>
            <div class="program-data-selection-heading-actions">
              <span class="program-data-references-text">{{
                referenceLabel(selectedTarget.referenceRanges)
              }}</span>
              <button
                type="button"
                class="program-data-selection-toggle"
                :aria-expanded="selectionExpanded"
                @click="selectionExpanded = !selectionExpanded"
              >
                {{ selectionExpanded ? '收起' : '展开' }}
              </button>
            </div>
          </div>
          <template v-if="selectionExpanded">
            <p v-if="selectedTarget.referenceRanges.length > 0" class="program-data-share-warning">
              共享目标：示教将影响 {{ selectedTarget.referenceRanges.length }} 处引用
            </p>
            <div
              v-if="selectedTarget.referenceRanges.length > 0"
              class="program-data-reference-links"
            >
              <button
                v-for="(range, index) in selectedTarget.referenceRanges"
                :key="`${range.start.offset}-${index}`"
                type="button"
                class="program-data-reference-link"
                @click="emit('view-reference', range)"
              >
                查看引用 · 行 {{ range.start.line }}
              </button>
            </div>
            <div v-if="props.canExecute" class="program-data-actions">
              <button type="button" class="secondary-action" @click="modifyPosition">
                Modify Position（更新位置）
              </button>
              <button type="button" class="secondary-action" @click="openDetails">编辑数据</button>
              <label class="program-data-insert-position">
                插入位置
                <select v-model="insertionSelection" aria-label="插入位置">
                  <option
                    v-for="point in props.insertionPoints"
                    :key="point.index"
                    :value="point.index"
                  >
                    {{ insertionLabel(point) }}
                  </option>
                </select>
              </label>
              <button type="button" class="secondary-action" @click="insertMotion('movej')">
                插入 MoveJ
              </button>
              <button type="button" class="secondary-action" @click="insertMotion('movel')">
                插入 MoveL
              </button>
            </div>
          </template>
        </div>
      </template>

      <template v-else-if="selectedTarget">
        <div class="program-data-detail-heading">
          <button type="button" class="secondary-action" @click="panelView = 'list'">
            返回列表
          </button>
          <div>
            <span class="panel-kicker">ROBTARGET DETAIL</span>
            <h3>{{ selectedTarget.name }}</h3>
          </div>
        </div>

        <div class="program-data-detail" aria-label="点位详情">
          <dl class="program-data-fields">
            <div>
              <dt>存储</dt>
              <dd>{{ selectedTarget.storage }}</dd>
            </div>
            <div>
              <dt>位置</dt>
              <dd>{{ formatCoord(selectedTarget.target.trans) }}</dd>
            </div>
            <div>
              <dt>姿态</dt>
              <dd>{{ formatRotation(selectedTarget.target.rot) }}</dd>
            </div>
            <div>
              <dt>robconf</dt>
              <dd>{{ formatCoord(selectedTarget.target.robconf) }}（当前 MVP 未模拟构型控制）</dd>
            </div>
            <div>
              <dt>外轴</dt>
              <dd>{{ formatCoord(selectedTarget.target.extax) }}</dd>
            </div>
            <div>
              <dt>引用</dt>
              <dd>{{ referenceLabel(selectedTarget.referenceRanges) }}</dd>
            </div>
          </dl>

          <div
            v-if="selectedTarget.referenceRanges.length > 0"
            class="program-data-reference-links"
          >
            <button
              v-for="(range, index) in selectedTarget.referenceRanges"
              :key="`${range.start.offset}-${index}`"
              type="button"
              class="program-data-reference-link"
              @click="emit('view-reference', range)"
            >
              定位 RAPID 引用 · 行 {{ range.start.line }}
            </button>
          </div>

          <div v-if="props.canExecute" class="program-data-detail-actions">
            <button type="button" class="secondary-action" @click="modifyPosition">
              Modify Position（更新位置）
            </button>
            <template v-if="renaming">
              <input
                v-model="renameValue"
                class="program-data-name-input program-data-rename-input"
                aria-label="重命名点位"
                spellcheck="false"
                @keyup.enter="commitRename"
                @keyup.esc="renaming = false"
              />
              <button type="button" class="secondary-action" @click="commitRename">
                确认重命名
              </button>
              <button type="button" class="secondary-action" @click="renaming = false">取消</button>
            </template>
            <button v-else type="button" class="secondary-action" @click="startRename">
              重命名
            </button>
            <button
              type="button"
              class="danger-action"
              :class="{ 'delete-armed': deleteArmed }"
              @click="deleteTarget"
            >
              {{ deleteArmed ? '确认删除？' : '删除' }}
            </button>
          </div>
        </div>
      </template>
    </template>

    <!-- 非 robtarget：只读列表 + 详情 -->
    <template v-else>
      <div class="program-data-toolbar">
        <span class="program-data-type-count"
          >{{ activeKind }} · {{ readonlyEntries.length }} 项</span
        >
      </div>

      <ul
        v-if="readonlyEntries.length > 0"
        class="program-data-list"
        :aria-label="`${activeKind} 数据列表`"
      >
        <li
          v-for="entry in readonlyEntries"
          :key="`${entry.kind}-${entry.name}`"
          class="program-data-item"
          :class="{
            selected: selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase(),
            active: isActiveName(entry.name, activeOperandForKind(entry.kind)),
          }"
        >
          <button
            type="button"
            class="program-data-row"
            :aria-label="`选择 ${activeKind} ${entry.name}`"
            :aria-pressed="
              selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()
            "
            @click="selectedReadonlyName = entry.name"
          >
            <span class="program-data-row-name">{{ entry.name }}</span>
            <span v-if="entry.system" class="program-data-label program-data-system">系统只读</span>
            <span class="program-data-label program-data-storage">{{ entry.storage }}</span>
            <span
              v-if="entry.kind === 'num' || entry.kind === 'bool'"
              class="program-data-row-coord"
              >初值 {{ scalarValueLabel(entry) }} · 当前 {{ currentScalarValueLabel(entry) }}</span
            >
            <span class="program-data-label program-data-references">{{
              referenceLabel(entry.referenceRanges)
            }}</span>
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
          <span v-if="selectedReadonly.system" class="program-data-label program-data-system"
            >系统预定义 · 只读</span
          >
        </div>
        <dl class="program-data-fields">
          <div v-if="selectedReadonly.kind === 'num' || selectedReadonly.kind === 'bool'">
            <dt>类型</dt>
            <dd>{{ selectedReadonly.kind }}</dd>
          </div>
          <div>
            <dt>存储</dt>
            <dd>{{ selectedReadonly.storage }}</dd>
          </div>
          <div v-for="[field, value] in readonlyFields(selectedReadonly)" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ value }}</dd>
          </div>
          <div>
            <dt>引用</dt>
            <dd>{{ referenceLabel(selectedReadonly.referenceRanges) }}</dd>
          </div>
        </dl>
        <div
          v-if="selectedReadonly.referenceRanges.length > 0"
          class="program-data-reference-links"
        >
          <button
            v-for="(range, index) in selectedReadonly.referenceRanges"
            :key="`${range.start.offset}-${index}`"
            type="button"
            class="program-data-reference-link"
            @click="emit('view-reference', range)"
          >
            定位 RAPID 引用 · 行 {{ range.start.line }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.program-data-panel {
  display: grid;
  gap: 12px;
  padding: 14px 16px;
}

.program-data-panel h2 {
  color: var(--color-text-strong);
  font-size: 16px;
  letter-spacing: -0.03em;
}

.program-data-hint {
  margin: -4px 0 0;
  color: var(--color-text-faint);
  font-size: 12px;
  line-height: 1.5;
}

.program-data-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  border-radius: var(--radius-sm);
  color: var(--color-danger-soft);
  background: rgba(127, 29, 29, 0.2);
  font-size: 12px;
  line-height: 1.5;
}

.program-data-kind-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 2px 0 8px;
}

.program-data-kind-tab {
  padding: 5px 10px;
  border: 1px solid var(--color-border-kind);
  border-radius: var(--radius-sm);
  color: var(--color-text-faint);
  background: var(--color-surface-raised);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
}

.program-data-kind-tab:hover {
  border-color: var(--color-brand);
  color: var(--color-text-strong);
}

.program-data-kind-tab.active {
  border-color: var(--color-brand);
  color: var(--color-brand-soft);
  background: var(--color-brand-dim);
}

.program-data-active {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid rgba(255, 106, 26, 0.25);
  border-radius: var(--radius-md);
  background: rgba(255, 106, 26, 0.08);
  color: var(--color-text-muted);
  font-size: 12px;
  margin-bottom: 8px;
}

.program-data-active-kind {
  font-weight: 700;
  color: var(--color-brand-soft);
}

.program-data-flyby-hint {
  color: var(--color-warning);
  font-weight: 600;
}

.program-data-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.program-data-type-count {
  flex: 0 0 auto;
  color: var(--color-brand);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.program-data-filter {
  min-width: 0;
  flex: 1;
  padding: 7px 9px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-editor);
  font-size: 12px;
}

.program-data-filter:focus {
  border-color: var(--color-brand-strong);
  outline: 2px solid rgba(255, 106, 26, 0.18);
  outline-offset: 1px;
}

.program-data-teach {
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid rgba(255, 106, 26, 0.2);
  border-radius: var(--radius-md);
  background: rgba(255, 106, 26, 0.07);
}

.program-data-teach-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.program-data-teach-title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: 12px;
  font-weight: 700;
}

.program-data-teach-preview {
  margin: 0;
  color: var(--color-text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
}

.program-data-teach-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.program-data-name-input {
  flex: 1;
  min-width: 120px;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-editor);
  font: 13px var(--font-mono);
}

.program-data-name-input:focus {
  outline: 2px solid rgba(255, 106, 26, 0.55);
  outline-offset: 1px;
}

.program-data-list {
  display: grid;
  gap: 4px;
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden auto;
  scrollbar-gutter: stable;
}

.program-data-item {
  display: grid;
  gap: 8px;
  padding: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
}

.program-data-item.selected {
  border-color: rgba(255, 106, 26, 0.7);
  box-shadow: 0 0 0 1px rgba(255, 106, 26, 0.16);
}

.program-data-item.active,
.program-data-item.active:hover {
  border-color: rgba(245, 197, 66, 0.65);
  box-shadow: 0 0 0 1px rgba(245, 197, 66, 0.22);
  background: rgba(245, 197, 66, 0.05);
}

.program-data-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 8px;
  padding: 9px 10px;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.program-data-row:hover,
.program-data-row:focus-visible {
  background: rgba(255, 106, 26, 0.2);
  outline: none;
}

.program-data-row-name {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-strong);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.program-data-row-coord {
  min-width: 0;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.program-data-label {
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  white-space: nowrap;
}

.program-data-storage {
  color: var(--color-warning-soft);
  background: rgba(245, 197, 66, 0.1);
}

.program-data-references {
  color: var(--color-brand);
  background: var(--color-brand-dim);
}

.program-data-system {
  color: var(--color-warning-strong);
  border-color: rgba(245, 197, 66, 0.4);
}

.program-data-empty {
  margin: 0;
  padding: 12px;
  border: 1px dashed var(--color-border-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text-dim);
  font-size: 13px;
  list-style: none;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.program-data-selection,
.program-data-detail {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-md);
  background: rgba(20, 23, 28, 0.98);
  box-shadow: 0 -10px 24px rgba(2, 6, 23, 0.28);
}

.program-data-selection-heading,
.program-data-detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.program-data-selection-heading-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.program-data-selection-heading strong,
.program-data-detail-heading h3 {
  display: block;
  margin: 2px 0 0;
  color: var(--color-text-strong);
  font-family: var(--font-mono);
  font-size: 14px;
}

.program-data-references-text {
  color: var(--color-brand);
  font-size: 11px;
}

.program-data-selection-toggle {
  padding: 4px 8px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-xs);
  color: var(--color-text-faint);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 11px;
}

.program-data-selection-toggle:hover,
.program-data-selection-toggle:focus-visible {
  border-color: var(--color-brand-strong);
  color: var(--color-brand-soft);
  outline: none;
}

.program-data-reference-links {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.program-data-reference-link {
  padding: 5px 8px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-xs);
  color: var(--color-brand);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 11px;
}

.program-data-reference-link:hover,
.program-data-reference-link:focus-visible {
  border-color: var(--color-brand-strong);
  outline: none;
}

.program-data-detail-heading {
  justify-content: flex-start;
}

.program-data-detail-heading > div {
  min-width: 0;
}

.program-data-detail {
  position: static;
  box-shadow: none;
}

.program-data-selection {
  flex: 0 1 56%;
  min-height: 0;
  max-height: 56%;
  overflow-y: auto;
}

.program-data-detail .program-data-fields {
  gap: 7px;
}

.program-data-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding-top: 7px;
  border-top: 1px solid var(--color-border-strong);
}

.program-data-detail-actions .program-data-name-input {
  flex: 1 1 140px;
}

/* 删除二次确认：armed 态高亮警示。 */
.danger-action.delete-armed {
  border-color: var(--color-danger-strong);
  color: var(--color-text-strong);
  background: var(--color-danger-hover-bg);
}

.program-data-share-warning {
  flex-basis: 100%;
  margin: 0;
  color: var(--color-warning);
  font-size: 11px;
}

.program-data-insert-position {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-faint);
  font-size: 11px;
}

.program-data-insert-position select {
  max-width: 240px;
  padding: 6px 8px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-xs);
  color: var(--color-text);
  background: var(--color-editor);
  font-size: 12px;
}

.program-data-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding-top: 6px;
  border-top: 1px solid var(--color-border-strong);
}

.program-data-rename-input {
  flex: 1;
  min-width: 130px;
}

.program-data-fields {
  display: grid;
  gap: 5px;
  margin: 0;
}

.program-data-fields div {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 8px;
}

.program-data-fields dt {
  color: var(--color-text-dim);
  font-size: 11px;
}

.program-data-fields dd {
  margin: 0;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

/* Workspace embedding: become a transparent, full-height flex column. */
.program-workspace-tabpanel > .program-data-panel {
  display: flex;
  flex-direction: column;
  gap: 9px;
  height: 100%;
  min-height: 100%;
  padding: 10px 4px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
}
</style>
