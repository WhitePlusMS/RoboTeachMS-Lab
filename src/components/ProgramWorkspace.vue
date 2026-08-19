<script setup lang="ts">
import { computed, ref } from 'vue'
import ProgramControlPanel from './ProgramControlPanel.vue'
import ProgramDataPanel from './ProgramDataPanel.vue'
import ProgramEditorToolbar from './ProgramEditorToolbar.vue'
import MotionArgumentPanel from './MotionArgumentPanel.vue'
import RapidPresetSelector from './RapidPresetSelector.vue'
import type { RapidPresetProgram } from '@/application/preset-programs.ts'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'
import type { RapidProgramDataTarget } from '@/rapid/rapid-parser.ts'
import { isRobtargetProgramData } from '@/rapid/rapid-parser.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/controlled-rapid-edit.ts'
import type {
  RapidExecutableInstruction,
  RapidMotionInsertionPoint,
  RapidProgramData,
  RapidSourceRange,
} from '@/rapid/rapid-parser.ts'
import type { Pose } from '@/robotics/types.ts'
import type { RapidScalarVariable } from '@/rapid/rapid-types.ts'
import {
  injectProgramPanelController,
  type ProgramPanelController,
} from '@/application/use-program-panel-controller.ts'

/** 工作区视图：由右侧窄图标边栏驱动（受控），RAPID 与 Program Data 二选一。 */
type WorkspaceView = 'rapid' | 'data'

interface Props {
  /** 当前视图（受控）；从 Program Data 查看引用时通过 update:view 请求切回 RAPID。 */
  view?: WorkspaceView
  snapshot?: ProgramControllerSnapshot
  source?: string
  program?: readonly RapidExecutableInstruction[]
  /** 全部已解析指令（含 `*` 占位运动）；独立挂载时由父级透传，供光标指令解析与参数编辑。 */
  instructions?: readonly RapidExecutableInstruction[]
  pendingClear?: 'run' | 'step' | null
  /** 完整 Program Data 联合（六类运动数据、num/bool 标量与系统预定义项）。 */
  data?: readonly RapidProgramData[]
  /** 当前活动/下一条指令下标，供 Program Data 面板高亮当前 Tool/WObj/Speed/Zone/目标。 */
  activeIndex?: number | null
  canExecute?: boolean
  insertionPoints?: readonly RapidMotionInsertionPoint[]
  pose?: Pose | null
  applyEdit?: (command: RapidEditCommand) => RapidEditResult
  /** ProgramExecutor 的标量当前值快照。 */
  runtimeValues?: ReadonlyMap<string, RapidScalarVariable>
  /** 受控：当前选中的 robtarget 名称；独立挂载时回退到本地状态。 */
  selectedTargetName?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:view': [view: WorkspaceView]
  run: []
  step: []
  stop: []
  pp: []
  'source-change': [source: string]
  'confirm-clear': []
  'cancel-clear': []
}>()

const EMPTY_SNAPSHOT: ProgramControllerSnapshot = {
  state: 'idle',
  programPointer: 0,
  motionPointer: null,
  stopReason: null,
  error: null,
  variables: new Map(),
  diagnostics: [],
  needsPPtoMain: false,
  offPath: false,
}

const noopEdit: (command: RapidEditCommand) => RapidEditResult = () => ({
  ok: false,
  error: { code: 'source-error', message: '面板未注入程序控制器' },
})

const activeView = computed(() => props.view ?? 'rapid')
const focusRange = ref<RapidSourceRange | null>(null)
const focusRequestId = ref(0)
/** 源码编辑器光标行（1 起始）；null 表示用户尚未与编辑器交互，工具栏回退到 PP 之后插入。 */
const cursorLine = ref<number | null>(null)
/** 独立挂载时的本地选中态回退；真实应用通过 provide 使用 App 的状态。 */
const fallbackSelectedTargetName = ref<string | null>(props.selectedTargetName ?? null)

function normalizeName(name: string): string {
  return name.toLocaleLowerCase('en-US')
}

function isValidTargetName(name: string | null, data: readonly RapidProgramData[]): boolean {
  if (name === null) return true
  return data.some(
    (entry): entry is RapidProgramDataTarget =>
      isRobtargetProgramData(entry) && normalizeName(entry.name) === normalizeName(name),
  )
}

function updateSelectedTarget(name: string | null): void {
  fallbackSelectedTargetName.value = name
}

/**
 * 共享控制器：App provide 时直接使用；独立挂载（测试）时回退到本地 props + 转发事件。
 * 真实应用里右侧 ProgramWorkspace 无需再接收一长串 props/emits。
 */
const injected = injectProgramPanelController()
const controller: ProgramPanelController = injected ?? {
  snapshot: computed(() => props.snapshot ?? EMPTY_SNAPSHOT),
  source: computed(() => props.source ?? ''),
  program: computed(() => props.program ?? []),
  instructions: computed(() => props.instructions ?? []),
  pendingClear: computed(() => props.pendingClear ?? null),
  data: computed(() => props.data ?? []),
  activeIndex: computed(() => props.activeIndex ?? null),
  canExecute: computed(() => props.canExecute ?? true),
  editable: computed(() => props.canExecute ?? true),
  insertionPoints: computed(() => props.insertionPoints ?? []),
  pose: computed(() => props.pose ?? null),
  runtimeValues: computed(() => props.runtimeValues ?? new Map()),
  selectedTargetName: computed(() =>
    isValidTargetName(fallbackSelectedTargetName.value, props.data ?? [])
      ? fallbackSelectedTargetName.value
      : null,
  ),
  applyEdit: props.applyEdit ?? noopEdit,
  run: () => emit('run'),
  step: () => emit('step'),
  stop: () => emit('stop'),
  ppToMain: () => emit('pp'),
  confirmClearToNext: () => emit('confirm-clear'),
  cancelClearToNext: () => emit('cancel-clear'),
  setSource: (source) => emit('source-change', source),
  selectTarget: updateSelectedTarget,
  undo: () => {},
  redo: () => {},
  canUndo: computed(() => false),
  canRedo: computed(() => false),
}

/** Program Data 查看引用：定位源码编辑器并请求父级切回 RAPID 视图。 */
function focusRapidReference(range: RapidSourceRange): void {
  focusRange.value = range
  focusRequestId.value += 1
  emit('update:view', 'rapid')
}

/** 预设程序加载：整体替换源码（含运行中必为 false 的前提由选择器保证）。 */
function handlePresetLoad(preset: RapidPresetProgram): void {
  controller.setSource(preset.source)
}

/**
 * 光标所在指令：遍历全部已解析指令，取源码行范围覆盖光标行的最后一条（多行语句取内层）。
 * 用于工具栏（编辑/Change to）与参数面板（MotionArgumentPanel）的指令级操作。
 */
const cursorInstruction = computed<{
  index: number
  instruction: RapidExecutableInstruction
} | null>(() => {
  if (cursorLine.value === null) return null
  let result: { index: number; instruction: RapidExecutableInstruction } | null = null
  controller.instructions.value.forEach((instruction, index) => {
    if (
      instruction.sourceRange.start.line <= (cursorLine.value as number) &&
      (cursorLine.value as number) <= instruction.sourceRange.end.line
    ) {
      result = { index, instruction }
    }
  })
  return result
})

/** 光标所在源码行文本（行首空白后以 `!` 开头判为注释行），供工具栏取消注释可用态。 */
const cursorLineText = computed<string | null>(() => {
  if (cursorLine.value === null) return null
  const lines = controller.source.value.split(/\r\n|\n/)
  const line = lines[cursorLine.value - 1]
  return line === undefined ? null : line
})

/**
 * 参数面板绑定的指令下标（FlexPendant Change Selected 语义）：
 * 仅由双击指令行或「编辑 → 更改选定内容」显式打开，光标移动只高亮、不弹面板。
 */
const argumentTargetIndex = ref<number | null>(null)

/** 打开参数面板：仅当目标是运动指令时有效（与真机一致，赋值/控制流没有参数编辑页）。 */
function openArguments(target: { index: number; instruction: RapidExecutableInstruction } | null): void {
  if (!target) return
  if (target.instruction.kind !== 'movej' && target.instruction.kind !== 'movel') return
  argumentTargetIndex.value = target.index
}

/** 双击指令行 = Change Selected：先把光标行同步到双击行，再按该行指令打开。 */
function onLineActivate(line: number): void {
  cursorLine.value = line
  openArguments(cursorInstruction.value)
}

/** 参数面板当前绑定的指令；绑定下标失效或不再是运动指令时自动关闭。 */
const argumentInstruction = computed<{
  index: number
  instruction: RapidExecutableInstruction
} | null>(() => {
  if (argumentTargetIndex.value === null) return null
  const instruction = controller.instructions.value[argumentTargetIndex.value]
  if (!instruction) return null
  if (instruction.kind !== 'movej' && instruction.kind !== 'movel') return null
  return { index: argumentTargetIndex.value, instruction }
})
</script>

<template>
  <section class="program-workspace" aria-label="RAPID 与程序数据工作区">
    <div class="program-workspace-content">
      <div
        id="program-panel-rapid"
        class="program-workspace-tabpanel program-workspace-tabpanel-rapid"
        :hidden="activeView !== 'rapid'"
      >
        <div class="program-rapid-toolbar">
          <RapidPresetSelector
            :source="controller.source.value"
            :running="controller.snapshot.value.state === 'running'"
            :initial-source="controller.source.value"
            @load="handlePresetLoad"
          />
          <ProgramEditorToolbar
            :controller="controller"
            :cursor-line="cursorLine"
            :cursor-instruction="cursorInstruction"
            :cursor-line-text="cursorLineText"
            @inserted="cursorLine = $event"
            @open-arguments="openArguments(cursorInstruction)"
          />
          <MotionArgumentPanel
            :controller="controller"
            :cursor-instruction="argumentInstruction"
            @close="argumentTargetIndex = null"
          />
        </div>
        <div class="program-rapid-scroll">
          <ProgramControlPanel
            display="content"
            :snapshot="controller.snapshot.value"
            :source="controller.source.value"
            :program="controller.program.value"
            :pending-clear="controller.pendingClear.value"
            :focus-range="focusRange"
            :focus-request-id="focusRequestId"
            :cursor-line="cursorLine"
            @source-change="controller.setSource"
            @cursor-line-change="cursorLine = $event"
            @line-activate="onLineActivate"
          />
        </div>
      </div>
      <div
        id="program-panel-data"
        class="program-workspace-tabpanel"
        :hidden="activeView !== 'data'"
      >
        <ProgramDataPanel
          display="content"
          :data="controller.data.value"
          :active-index="controller.activeIndex.value"
          :can-execute="controller.canExecute.value"
          :program="controller.program.value"
          :pose="controller.pose.value"
          :apply-edit="controller.applyEdit"
          :runtime-values="controller.runtimeValues.value"
          :selected-target-name="controller.selectedTargetName.value"
          @view-reference="focusRapidReference"
          @select-target="controller.selectTarget"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.program-workspace {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.program-workspace-content {
  min-height: 0;
  overflow: hidden;
}

.program-workspace-tabpanel {
  height: 100%;
  min-height: 0;
  overflow: hidden auto;
  scrollbar-gutter: stable;
}

/* 面板切换依赖 [hidden]，必须覆盖 rapid 面板的 display:grid 才能正确隐藏。 */
.program-workspace-tabpanel[hidden] {
  display: none;
}

/* RAPID 面板：预设/添加指令工具条固定在顶部不滚动，仅下方编辑区滚动。 */
.program-workspace-tabpanel-rapid {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.program-rapid-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-raised);
}

.program-rapid-scroll {
  min-height: 0;
  overflow: hidden auto;
  scrollbar-gutter: stable;
}

/* 内容填满右列：编辑器吃满剩余高度，摘要条钉在列底（VS Code 式布局）。
   必须用 height（确定高度）而非 min-height：否则面板高度被内容撑大，
   flex:1 失去约束，长代码时外层会出现第二条滚动条。 */
.program-rapid-scroll > .program-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0; /* 编辑器与面板融为一体，不再套卡片（覆盖 .program-panel-content 的内边距） */
}

.program-workspace-tabpanel > .program-data-panel {
  min-height: 100%;
}
</style>
