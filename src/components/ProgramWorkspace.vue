<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import ProgramControlPanel from './ProgramControlPanel.vue'
import ProgramDataPanel from './ProgramDataPanel.vue'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'
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

interface Props {
  snapshot?: ProgramControllerSnapshot
  source?: string
  program?: readonly RapidExecutableInstruction[]
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
}

const props = defineProps<Props>()

const emit = defineEmits<{
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

/**
 * 共享控制器：App provide 时直接使用；独立挂载（测试）时回退到本地 props + 转发事件。
 * 真实应用里右侧 ProgramWorkspace 无需再接收一长串 props/emits。
 */
const controller: ProgramPanelController =
  injectProgramPanelController() ??
  {
    snapshot: computed(() => props.snapshot ?? EMPTY_SNAPSHOT),
    source: computed(() => props.source ?? ''),
    program: computed(() => props.program ?? []),
    pendingClear: computed(() => props.pendingClear ?? null),
    data: computed(() => props.data ?? []),
    activeIndex: computed(() => props.activeIndex ?? null),
    canExecute: computed(() => props.canExecute ?? true),
    insertionPoints: computed(() => props.insertionPoints ?? []),
    pose: computed(() => props.pose ?? null),
    runtimeValues: computed(() => props.runtimeValues ?? new Map()),
    applyEdit: props.applyEdit ?? noopEdit,
    run: () => emit('run'),
    step: () => emit('step'),
    stop: () => emit('stop'),
    ppToMain: () => emit('pp'),
    confirmClearToNext: () => emit('confirm-clear'),
    cancelClearToNext: () => emit('cancel-clear'),
    setSource: (source) => emit('source-change', source),
  }

type ProgramTab = 'rapid' | 'data'
const activeTab = ref<ProgramTab>('rapid')
const focusRange = ref<RapidSourceRange | null>(null)
const focusRequestId = ref(0)
const rapidTabButton = ref<HTMLButtonElement | null>(null)
const dataTabButton = ref<HTMLButtonElement | null>(null)

function selectTab(tab: ProgramTab): void {
  activeTab.value = tab
}

function focusActiveTab(): void {
  void nextTick(() => {
    const button = activeTab.value === 'rapid' ? rapidTabButton.value : dataTabButton.value
    button?.focus()
  })
}

function focusRapidReference(range: RapidSourceRange): void {
  focusRange.value = range
  focusRequestId.value += 1
  activeTab.value = 'rapid'
}

function handleTabKeydown(event: KeyboardEvent, tab: ProgramTab): void {
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    selectTab(tab === 'rapid' ? 'data' : 'rapid')
    focusActiveTab()
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    selectTab(tab === 'data' ? 'rapid' : 'data')
    focusActiveTab()
  } else if (event.key === 'Home') {
    event.preventDefault()
    selectTab('rapid')
    focusActiveTab()
  } else if (event.key === 'End') {
    event.preventDefault()
    selectTab('data')
    focusActiveTab()
  }
}
</script>

<template>
  <section class="program-workspace" aria-label="RAPID 与程序数据工作区">
    <div class="workbench-tabs program-workspace-tabs" role="tablist" aria-label="程序工作区">
      <button
        id="program-tab-rapid"
        ref="rapidTabButton"
        type="button"
        role="tab"
        class="workbench-tab"
        :class="{ active: activeTab === 'rapid' }"
        :aria-selected="activeTab === 'rapid'"
        aria-controls="program-panel-rapid"
        :tabindex="activeTab === 'rapid' ? 0 : -1"
        @click="selectTab('rapid')"
        @keydown="handleTabKeydown($event, 'rapid')"
      >
        RAPID
      </button>
      <button
        id="program-tab-data"
        ref="dataTabButton"
        type="button"
        role="tab"
        class="workbench-tab"
        :class="{ active: activeTab === 'data' }"
        :aria-selected="activeTab === 'data'"
        aria-controls="program-panel-data"
        :tabindex="activeTab === 'data' ? 0 : -1"
        @click="selectTab('data')"
        @keydown="handleTabKeydown($event, 'data')"
      >
        Program Data
      </button>
    </div>

    <div class="program-workspace-content">
      <div
        id="program-panel-rapid"
        class="program-workspace-tabpanel"
        role="tabpanel"
        aria-labelledby="program-tab-rapid"
        :hidden="activeTab !== 'rapid'"
      >
        <ProgramControlPanel
          display="content"
          :snapshot="controller.snapshot.value"
          :source="controller.source.value"
          :program="controller.program.value"
          :pending-clear="controller.pendingClear.value"
          :focus-range="focusRange"
          :focus-request-id="focusRequestId"
          @source-change="controller.setSource"
        />
      </div>
      <div
        id="program-panel-data"
        class="program-workspace-tabpanel"
        role="tabpanel"
        aria-labelledby="program-tab-data"
        :hidden="activeTab !== 'data'"
      >
        <ProgramDataPanel
          :data="controller.data.value"
          :active-index="controller.activeIndex.value"
          :can-execute="controller.canExecute.value"
          :program="controller.program.value"
          :insertion-points="controller.insertionPoints.value"
          :pose="controller.pose.value"
          :apply-edit="controller.applyEdit"
          :runtime-values="controller.runtimeValues.value"
          @view-reference="focusRapidReference"
        />
      </div>
    </div>

    <div class="program-workspace-actions">
      <ProgramControlPanel
        display="actions"
        :snapshot="controller.snapshot.value"
        :source="controller.source.value"
        :program="controller.program.value"
        :pending-clear="controller.pendingClear.value"
        @run="controller.run"
        @step="controller.step"
        @stop="controller.stop"
        @pp="controller.ppToMain"
        @confirm-clear="controller.confirmClearToNext"
        @cancel-clear="controller.cancelClearToNext"
      />
    </div>
  </section>
</template>

<style scoped>
.program-workspace {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  gap: 8px;
  overflow: hidden;
}

.program-workspace-tabs {
  flex: 0 0 auto;
}

.program-workspace-content {
  min-height: 0;
  overflow: hidden;
}

.program-workspace-tabpanel {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  scrollbar-gutter: stable;
}

.program-workspace-actions {
  min-height: 0;
  border-top: 1px solid var(--color-border);
  background: rgba(11, 18, 32, 0.94);
}

.program-workspace-tabpanel > .program-data-panel {
  min-height: 100%;
}
</style>
