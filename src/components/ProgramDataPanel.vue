<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_ROBTARGET,
  makeTaughtTargetFromPose,
  type RapidEditCommand,
  type RapidEditResult,
} from '@/rapid/editing/index.ts'
import type {
  RapidDataKind,
  RapidExecutableInstruction,
  RapidProgramData,
  RapidSourceRange,
} from '@/rapid/language/index.ts'
import { isRapidMotionInstruction, isRobtargetProgramData } from '@/rapid/language/index.ts'
import type {
  RapidScalarVariable,
  RobTarget,
  ToolData,
  WobjData,
  SpeedData,
  ZoneData,
  LoadData,
} from '@/rapid/data/index.ts'
import type { JointAngles, Pose } from '@/robot-geometry/model/index.ts'

interface Props {
  /** 完整 Program Data 联合（六类运动数据、num/bool 标量与系统预定义项）。 */
  data: readonly RapidProgramData[]
  /** 当前活动/下一条指令下标；用于高亮当前使用的 Tool/WObj/Speed/Zone/目标。非 null 时指向 program。 */
  activeIndex: number | null
  /** 源程序是否干净可执行；存在 error 时 Program Data 只读浏览、禁用结构化编辑与运行。 */
  canExecute: boolean
  /** 当前已解析运动，用于把插入位置显示成可理解的教学标签，也用于高亮当前指令。 */
  program: readonly RapidExecutableInstruction[]
  /** 当前活动 tool0 TCP（ABB 基座坐标），用于示教新目标值。 */
  pose: Pose | null
  joints?: JointAngles
  /** 来自 ProgramExecutor 快照的标量当前值；缺少条目时回退到声明初值。 */
  runtimeValues?: ReadonlyMap<string, RapidScalarVariable>
  /** 唯一受控编辑入口；返回结果以展示结构化拒绝原因。 */
  applyEdit: (command: RapidEditCommand) => RapidEditResult
  /** 受控：当前选中的 robtarget 名称；由 App 唯一持有。 */
  selectedTargetName?: string | null
  /** dock 内 content 模式不渲染自带标题行（dock 头部已显示「程序数据」）。 */
  display?: 'all' | 'content'
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'view-reference': [range: RapidSourceRange]
  'select-target': [name: string | null]
}>()

const display = computed(() => props.display ?? 'all')

/**
 * 可浏览的数据种类（按 ABB 示教器习惯）；loaddata 作为工具负载数据随 tooldata 展示，不单列 Tab。
 * 顺序按「是否含系统预定义项」分组：先纯程序变量类（robtarget/num/bool），后含系统项的运动配置类
 * （tooldata/wobjdata/speeddata/zonedata），同类聚拢便于辨认。
 */
const KINDS: ReadonlyArray<{ kind: RapidDataKind; zh: string; en: string }> = [
  { kind: 'robtarget', zh: '目标点', en: 'robtarget' },
  { kind: 'num', zh: '数字', en: 'num' },
  { kind: 'bool', zh: '布尔', en: 'bool' },
  { kind: 'tooldata', zh: '工具数据', en: 'tooldata' },
  { kind: 'wobjdata', zh: '工件坐标', en: 'wobjdata' },
  { kind: 'speeddata', zh: '速度数据', en: 'speeddata' },
  { kind: 'zonedata', zh: '转弯区', en: 'zonedata' },
]
const activeKind = ref<RapidDataKind>('robtarget')

/** 每种数据是否含系统预定义项：含系统项的 Tab 用黄色系配色区分于纯程序变量 Tab。 */
const kindHasSystem = computed<Record<string, boolean>>(() => {
  const has: Record<string, boolean> = {}
  for (const entry of props.data) {
    if (entry.system) has[entry.kind] = true
  }
  return has
})

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
const filterQuery = ref('')
const newTargetName = ref('')
const renaming = ref(false)
const renameValue = ref('')
const editError = ref<string | null>(null)

// 编辑位置二级展开：草稿与当前正在编辑的目标名称。
const editingPosition = ref(false)
const editTransDraft = ref<{ x: string; y: string; z: string }>({ x: '', y: '', z: '' })

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

const robtargetEntries = computed(() => props.data.filter(isRobtargetProgramData))

const filteredTargets = computed(() => {
  const query = filterQuery.value.trim().toLocaleLowerCase()
  if (!query) return robtargetEntries.value
  return robtargetEntries.value.filter((target) => target.name.toLocaleLowerCase().includes(query))
})

const effectiveSelectedName = computed(() => props.selectedTargetName ?? null)

const selectedTarget = computed(() => {
  const name = effectiveSelectedName.value
  if (!name) return null
  const normalized = name.toLocaleLowerCase()
  return (
    robtargetEntries.value.find((target) => target.name.toLocaleLowerCase() === normalized) ?? null
  )
})

watch([() => effectiveSelectedName.value, activeKind], disarmDelete)

watch(activeKind, (kind, prevKind) => {
  if (prevKind === 'robtarget' && kind !== 'robtarget' && effectiveSelectedName.value !== null) {
    emit('select-target', null)
  }
})

/** 把当前 ABB 基座 tool0 TCP 转为 RAPID robtarget；教学语义统一入口。 */
const taughtRobTarget = computed<RobTarget | null>(() => {
  if (!props.pose) return null
  return makeTaughtTargetFromPose(props.pose, props.joints)
})

watch(
  () => props.data,
  (data) => {
    const name = effectiveSelectedName.value
    if (name && !data.some((d) => d.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      emit('select-target', null)
    }
  },
)

watch(filterQuery, (query) => {
  const name = effectiveSelectedName.value
  if (!name) return
  const normalized = name.toLocaleLowerCase()
  if (
    query.trim() &&
    !filteredTargets.value.some((target) => target.name.toLocaleLowerCase() === normalized)
  ) {
    emit('select-target', null)
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
  const current = effectiveSelectedName.value
  if (current?.toLocaleLowerCase() === name.toLocaleLowerCase()) {
    editingPosition.value = false
    renaming.value = false
    emit('select-target', null)
  } else {
    editingPosition.value = false
    renaming.value = false
    editError.value = null
    emit('select-target', name)
  }
}

function runEdit(command: RapidEditCommand): void {
  const result = props.applyEdit(command)
  editError.value = result.ok ? null : result.error.message
}

function createTarget(): void {
  const name = newTargetName.value.trim()
  if (!name) {
    editError.value = '请输入新点位名称'
    return
  }
  // FlexPendant Program Data「New」：以类型默认值创建，位置后续用 Modify Position 录入。
  runEdit({ type: 'create-target', name, target: DEFAULT_ROBTARGET })
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

function startEditPosition(): void {
  const target = selectedTarget.value
  if (!target) return
  editingPosition.value = true
  editTransDraft.value = {
    x: String(target.target.trans[0]),
    y: String(target.target.trans[1]),
    z: String(target.target.trans[2]),
  }
  editError.value = null
}

function commitEditPosition(): void {
  const target = selectedTarget.value
  if (!target) return
  const raw = [
    editTransDraft.value.x.trim(),
    editTransDraft.value.y.trim(),
    editTransDraft.value.z.trim(),
  ]
  if (raw.some((value) => value === '')) {
    editError.value = 'X/Y/Z 不能为空'
    return
  }
  const values = raw.map((value) => Number(value))
  if (values.some((value) => !Number.isFinite(value))) {
    editError.value = 'X/Y/Z 必须均为有限数字'
    return
  }
  runEdit({
    type: 'modify-position',
    name: target.name,
    target: {
      trans: values as [number, number, number],
      rot: target.target.rot,
      robconf: target.target.robconf,
      extax: target.target.extax,
    },
  })
  if (!editError.value) editingPosition.value = false
}

function cancelEditPosition(): void {
  editingPosition.value = false
  editError.value = null
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
  const trimmed = renameValue.value.trim()
  runEdit({ type: 'rename-target', name: target.name, newName: trimmed })
  if (!editError.value) {
    renaming.value = false
    emit('select-target', trimmed)
  }
}

function cancelRename(): void {
  renaming.value = false
}

function deleteTarget(): void {
  const target = selectedTarget.value
  if (!target) return
  if (!deleteArmed.value) {
    armDelete()
    return
  }
  disarmDelete()
  runEdit({ type: 'delete-target', name: target.name })
  if (!editError.value) {
    emit('select-target', null)
  }
}

// —— 非 robtarget 只读浏览 ——
const readonlyEntries = computed(() =>
  props.data.filter((d) => d.kind === activeKind.value && d.kind !== 'robtarget'),
)
/** 系统预定义只读项（tool0/wobj0/load0/官方 speed/zone）：与程序声明的变量分开分组展示。 */
const systemEntries = computed(() => readonlyEntries.value.filter((entry) => entry.system))
/** 程序声明的变量（非系统）：可被源码重定义/受控编辑的对象。 */
const programEntries = computed(() => readonlyEntries.value.filter((entry) => !entry.system))
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

function selectReadonly(name: string): void {
  if (selectedReadonlyName.value?.toLocaleLowerCase() === name.toLocaleLowerCase()) {
    selectedReadonlyName.value = null
  } else {
    selectedReadonlyName.value = name
  }
}

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

/** 列表行右侧摘要：按数据类型显示关键字段。 */
function rowSummary(entry: RapidProgramData): string {
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
      return `初值 ${scalarValueLabel(entry)} · 当前 ${currentScalarValueLabel(entry)}`
    default:
      return ''
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

    <div class="program-data-kind-tabs" role="tablist" aria-label="数据类型">
      <button
        v-for="kind in KINDS"
        :key="kind.kind"
        type="button"
        role="tab"
        class="program-data-kind-tab"
        :class="{
          active: activeKind === kind.kind,
          'has-system': kindHasSystem[kind.kind] === true,
        }"
        :aria-selected="activeKind === kind.kind"
        :title="`查看${kind.zh}数据（${kind.en}）`"
        @click="activeKind = kind.kind"
      >
        <span class="program-data-kind-zh">{{ kind.zh }}</span>
        <span class="program-data-kind-en">{{ kind.en }}</span>
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
          <p class="program-data-teach-title">新建点位</p>
          <span class="program-data-teach-preview">以默认值创建，位置用 Modify Position 录入</span>
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
          <button
            type="button"
            class="primary-action"
            title="用输入的名称新建一个 robtarget 点位"
            @click="createTarget"
          >
            新建点位
          </button>
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
            selected: selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase(),
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
            :title="`选择点位 ${target.name}`"
            @click="selectTarget(target.name)"
          >
            <span class="program-data-row-name">{{ target.name }}</span>
            <span class="program-data-label program-data-storage">{{ target.storage }}</span>
            <span class="program-data-row-coord">[{{ formatCoord(target.target.trans) }}]</span>
            <span class="program-data-label program-data-references">{{
              referenceLabel(target.referenceRanges)
            }}</span>
          </button>

          <div
            v-if="selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase()"
            class="program-data-inline-detail"
            aria-label="选中点位详情"
          >
            <p v-if="target.referenceRanges.length > 0" class="program-data-share-warning">
              共享目标：示教将影响 {{ target.referenceRanges.length }} 处引用
            </p>
            <div v-if="target.referenceRanges.length > 0" class="program-data-reference-links">
              <button
                v-for="(range, index) in target.referenceRanges"
                :key="`${range.start.offset}-${index}`"
                type="button"
                class="program-data-reference-link"
                :title="`在源码中定位该引用（行 ${range.start.line}）`"
                @click="emit('view-reference', range)"
              >
                查看引用 · 行 {{ range.start.line }}
              </button>
            </div>

            <dl class="program-data-fields">
              <div>
                <dt>存储</dt>
                <dd>{{ target.storage }}</dd>
              </div>
              <div>
                <dt>位置</dt>
                <dd>{{ formatCoord(target.target.trans) }}</dd>
              </div>
              <div>
                <dt>姿态</dt>
                <dd>{{ formatRotation(target.target.rot) }}</dd>
              </div>
              <div>
                <dt>robconf</dt>
                <dd>{{ formatCoord(target.target.robconf) }}（当前 MVP 未模拟构型控制）</dd>
              </div>
              <div>
                <dt>外轴</dt>
                <dd>{{ formatCoord(target.target.extax) }}</dd>
              </div>
              <div>
                <dt>引用</dt>
                <dd>{{ referenceLabel(target.referenceRanges) }}</dd>
              </div>
            </dl>

            <div v-if="props.canExecute" class="program-data-inline-actions">
              <button
                type="button"
                class="secondary-action"
                title="将本点位位置更新为当前 TCP 位姿"
                @click="modifyPosition"
              >
                Modify Position（更新位置）
              </button>
              <template v-if="editingPosition">
                <div class="program-data-edit-position">
                  <label>
                    X
                    <input v-model="editTransDraft.x" type="text" aria-label="X" />
                  </label>
                  <label>
                    Y
                    <input v-model="editTransDraft.y" type="text" aria-label="Y" />
                  </label>
                  <label>
                    Z
                    <input v-model="editTransDraft.z" type="text" aria-label="Z" />
                  </label>
                </div>
                <button
                  type="button"
                  class="secondary-action"
                  title="确认修改本点位位置"
                  @click="commitEditPosition"
                >
                  确认
                </button>
                <button
                  type="button"
                  class="secondary-action"
                  title="取消位置修改"
                  @click="cancelEditPosition"
                >
                  取消
                </button>
              </template>
              <button
                v-else
                type="button"
                class="secondary-action"
                title="手动输入本点位的新位置"
                @click="startEditPosition"
              >
                编辑位置
              </button>
              <template v-if="renaming">
                <input
                  v-model="renameValue"
                  class="program-data-name-input program-data-rename-input"
                  aria-label="重命名点位"
                  spellcheck="false"
                  @keyup.enter="commitRename"
                  @keyup.esc="cancelRename"
                />
                <button
                  type="button"
                  class="secondary-action"
                  title="确认重命名本点位"
                  @click="commitRename"
                >
                  确认重命名
                </button>
                <button
                  type="button"
                  class="secondary-action"
                  title="取消重命名"
                  @click="cancelRename"
                >
                  取消
                </button>
              </template>
              <button
                v-else
                type="button"
                class="secondary-action"
                title="重命名本点位"
                @click="startRename"
              >
                重命名
              </button>
              <button
                type="button"
                class="danger-action"
                :class="{ 'delete-armed': deleteArmed }"
                :title="deleteArmed ? '再次点击确认删除本点位' : '删除本点位（需二次确认）'"
                @click="deleteTarget"
              >
                {{ deleteArmed ? '确认删除？' : '删除' }}
              </button>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="program-data-empty">
        {{
          robtargetEntries.length === 0
            ? '源码中尚未声明 robtarget，或未识别到命名点位。'
            : '没有匹配的点位。'
        }}
      </p>
    </template>

    <!-- 非 robtarget：只读列表 + 原地展开（系统预定义项与程序变量分节展示） -->
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
        <!-- 程序声明的变量分节头：品牌色，可被源码重定义/受控编辑。 -->
        <li v-if="programEntries.length > 0" class="program-data-group-head">
          <span class="program-data-group-dot" aria-hidden="true"></span>程序声明的变量
        </li>
        <li
          v-for="entry in programEntries"
          :key="`prog-${entry.kind}-${entry.name}`"
          class="program-data-item"
          :class="{
            selected:
              selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase(),
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
            :title="`选择 ${activeKind} 数据 ${entry.name}`"
            @click="selectReadonly(entry.name)"
          >
            <span class="program-data-row-name">{{ entry.name }}</span>
            <span class="program-data-label program-data-storage">{{ entry.storage }}</span>
            <span class="program-data-row-coord">{{ rowSummary(entry) }}</span>
            <span class="program-data-label program-data-references">{{
              referenceLabel(entry.referenceRanges)
            }}</span>
          </button>

          <div
            v-if="selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()"
            class="program-data-inline-detail"
            :aria-label="`${activeKind} 详情`"
          >
            <dl class="program-data-fields">
              <div v-if="entry.kind === 'num' || entry.kind === 'bool'">
                <dt>类型</dt>
                <dd>{{ entry.kind }}</dd>
              </div>
              <div>
                <dt>存储</dt>
                <dd>{{ entry.storage }}</dd>
              </div>
              <div v-for="[field, value] in readonlyFields(entry)" :key="field">
                <dt>{{ field }}</dt>
                <dd>{{ value }}</dd>
              </div>
              <div>
                <dt>引用</dt>
                <dd>{{ referenceLabel(entry.referenceRanges) }}</dd>
              </div>
            </dl>
            <div v-if="entry.referenceRanges.length > 0" class="program-data-reference-links">
              <button
                v-for="(range, index) in entry.referenceRanges"
                :key="`${range.start.offset}-${index}`"
                type="button"
                class="program-data-reference-link"
                :title="`在源码中定位该引用（行 ${range.start.line}）`"
                @click="emit('view-reference', range)"
              >
                查看引用 · 行 {{ range.start.line }}
              </button>
            </div>
          </div>
        </li>

        <!-- 系统预定义只读项分节头：黄色，表示 tool0/wobj0/load0/官方 speed/zone。 -->
        <li v-if="systemEntries.length > 0" class="program-data-group-head program-data-group-system">
          <span class="program-data-group-dot" aria-hidden="true"></span>系统预定义 · 只读
        </li>
        <li
          v-for="entry in systemEntries"
          :key="`sys-${entry.kind}-${entry.name}`"
          class="program-data-item program-data-item-system"
          :class="{
            selected:
              selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase(),
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
            :title="`选择 ${activeKind} 数据 ${entry.name}`"
            @click="selectReadonly(entry.name)"
          >
            <span class="program-data-row-name">{{ entry.name }}</span>
            <span class="program-data-label program-data-system">系统只读</span>
            <span class="program-data-label program-data-storage">{{ entry.storage }}</span>
            <span class="program-data-row-coord">{{ rowSummary(entry) }}</span>
            <span class="program-data-label program-data-references">{{
              referenceLabel(entry.referenceRanges)
            }}</span>
          </button>

          <div
            v-if="selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()"
            class="program-data-inline-detail"
            :aria-label="`${activeKind} 详情`"
          >
            <div class="program-data-system-badge">系统预定义 · 只读</div>
            <dl class="program-data-fields">
              <div>
                <dt>存储</dt>
                <dd>{{ entry.storage }}</dd>
              </div>
              <div v-for="[field, value] in readonlyFields(entry)" :key="field">
                <dt>{{ field }}</dt>
                <dd>{{ value }}</dd>
              </div>
              <div>
                <dt>引用</dt>
                <dd>{{ referenceLabel(entry.referenceRanges) }}</dd>
              </div>
            </dl>
            <div v-if="entry.referenceRanges.length > 0" class="program-data-reference-links">
              <button
                v-for="(range, index) in entry.referenceRanges"
                :key="`${range.start.offset}-${index}`"
                type="button"
                class="program-data-reference-link"
                :title="`在源码中定位该引用（行 ${range.start.line}）`"
                @click="emit('view-reference', range)"
              >
                查看引用 · 行 {{ range.start.line }}
              </button>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="program-data-empty">源码/系统中尚未声明 {{ activeKind }}。</p>
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
  font-size: var(--text-2xl);
  letter-spacing: -0.01em;
}

.program-data-hint {
  margin: -4px 0 0;
  color: var(--color-text-faint);
  font-size: var(--text-md);
  line-height: 1.5;
}

.program-data-error {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
  border-radius: var(--radius-sm);
  color: var(--color-danger-soft);
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  font-size: var(--text-md);
  line-height: 1.5;
}

.program-data-kind-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 2px 0 8px;
}

.program-data-kind-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 4px 10px 5px;
  border: 1px solid var(--color-border-kind);
  border-radius: var(--radius-sm);
  color: var(--color-text-faint);
  background: var(--color-surface-raised);
  cursor: pointer;
  line-height: 1.15;
}

.program-data-kind-zh {
  font-family: var(--font-sans);
  font-size: var(--text-md);
}

.program-data-kind-en {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-dim);
  letter-spacing: 0.02em;
}

.program-data-kind-tab:hover .program-data-kind-zh,
.program-data-kind-tab.active .program-data-kind-zh {
  color: currentColor;
}

.program-data-kind-tab:hover {
  border-color: var(--color-brand);
  color: var(--color-text-strong);
}

/* 含系统预定义项的 Tab：黄色弱化描边 + 淡黄底，区分于纯程序变量 Tab。 */
.program-data-kind-tab.has-system {
  border-color: color-mix(in srgb, var(--color-warning) 42%, transparent);
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
}

.program-data-kind-tab.has-system:hover {
  border-color: var(--color-warning);
  color: var(--color-warning-soft);
}

.program-data-kind-tab.active {
  border-color: var(--color-brand);
  color: var(--color-brand-soft);
  background: var(--color-brand-dim);
}

.program-data-kind-tab.active .program-data-kind-en {
  color: var(--color-brand-soft);
}

.program-data-active {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-left: 2px solid var(--color-brand);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: var(--text-md);
  margin-bottom: 8px;
}

.program-data-active-kind {
  font-weight: 700;
  color: var(--color-text-strong);
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
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-md);
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
  font-size: var(--text-md);
}

.program-data-filter:focus {
  border-color: var(--color-brand-strong);
  outline: 2px solid color-mix(in srgb, var(--color-brand) 18%, transparent);
  outline-offset: 1px;
}

.program-data-teach {
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--color-border);
  border-left: 2px solid var(--color-brand);
  border-radius: var(--radius-md);
  background: var(--color-surface);
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
  font-size: var(--text-md);
  font-weight: 700;
}

.program-data-teach-preview {
  margin: 0;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
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
  font-size: var(--text-lg);
  font-family: var(--font-mono);
}

.program-data-name-input:focus {
  outline: 2px solid color-mix(in srgb, var(--color-brand) 55%, transparent);
  outline-offset: 1px;
}

.program-data-list {
  display: grid;
  align-content: start;
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
  align-content: start;
  align-self: start;
  gap: 8px;
  padding: 0;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
}

.program-data-item.selected {
  border-color: color-mix(in srgb, var(--color-brand) 70%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-brand) 16%, transparent);
}

.program-data-item.active,
.program-data-item.active:hover {
  border-color: color-mix(in srgb, var(--color-warning) 65%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-warning) 22%, transparent);
  background: color-mix(in srgb, var(--color-warning) 5%, transparent);
}

.program-data-row {
  display: flex;
  flex-wrap: nowrap;
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
  background: color-mix(in srgb, var(--color-brand) 20%, transparent);
  outline: none;
}

.program-data-row-name {
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-strong);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.program-data-row-coord {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.program-data-label {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-pill);
  color: var(--color-text-faint);
  font-size: var(--text-md);
  white-space: nowrap;
}

/* 存储标签（const/pers/var）更紧凑：收窄字距，使系统预定义行（含「系统只读」+「const」两枚药丸）可在一行内放下。 */
.program-data-storage {
  padding-inline: 5px;
}

.program-data-system-badge {
  align-self: flex-start;
  padding: 2px 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-pill);
  color: var(--color-text-faint);
  font-size: var(--text-md);
  white-space: nowrap;
}

/* —— 系统预定义 vs 程序变量 分组 —— */

/* 列表内的分节头行（li）：纯展示，不带条目边框/点击态。 */
.program-data-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0;
  padding: 2px 4px;
  border: 0;
  border-radius: 0;
  list-style: none;
  color: var(--color-text-faint);
  background: transparent;
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.02em;
}

.program-data-group-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--color-brand);
}

/* 系统预定义组：黄色点 + 黄色文字，与「程序声明的变量」区分。 */
.program-data-group-system .program-data-group-dot {
  background: var(--color-warning);
}

.program-data-group-system {
  color: var(--color-warning-soft);
}

/* 系统条目：中性灰弱化，表达只读/底层；与亮色的程序变量形成简单对比。 */
.program-data-item-system {
  opacity: 0.82;
  border-color: var(--color-border);
  background: color-mix(in srgb, var(--color-text-dim) 6%, transparent);
}

.program-data-item-system:hover {
  background: color-mix(in srgb, var(--color-text-dim) 12%, transparent);
}

.program-data-item-system.system-selected {
  opacity: 1;
  border-color: var(--color-warning);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-warning) 25%, transparent);
}

/* 「系统只读」徽章：黄色表示只读系统项，是系统的唯一强调色。 */
.program-data-system {
  border-color: color-mix(in srgb, var(--color-warning) 55%, transparent);
  color: var(--color-warning-soft);
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
}

.program-data-empty {
  margin: 0;
  padding: 12px;
  border: 1px dashed var(--color-border-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text-faint);
  font-size: var(--text-lg);
  list-style: none;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.program-data-inline-detail {
  display: grid;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid var(--color-border);
}

.program-data-share-warning {
  flex-basis: 100%;
  margin: 0;
  color: var(--color-warning);
  font-size: var(--text-md);
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
  color: var(--color-text-faint);
  background: var(--color-surface);
  cursor: pointer;
  font-size: var(--text-md);
}

.program-data-reference-link:hover,
.program-data-reference-link:focus-visible {
  border-color: var(--color-brand-strong);
  outline: none;
}

.program-data-inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding-top: 7px;
  border-top: 1px solid var(--color-border-strong);
}

.program-data-edit-position {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex-basis: 100%;
  align-items: center;
}

.program-data-edit-position label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-faint);
  font-size: var(--text-md);
}

.program-data-edit-position input {
  width: 90px;
  padding: 5px 7px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-xs);
  color: var(--color-text);
  background: var(--color-editor);
  font-size: var(--text-md);
  font-family: var(--font-mono);
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
  color: var(--color-text-faint);
  font-size: var(--text-sm);
}

.program-data-fields dd {
  margin: 0;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  overflow-wrap: anywhere;
}

/* 删除二次确认：armed 态高亮警示。 */
.danger-action.delete-armed {
  border-color: var(--color-danger-strong);
  color: var(--color-text-strong);
  background: var(--color-danger-hover-bg);
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
