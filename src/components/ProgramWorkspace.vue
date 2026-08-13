<script setup lang="ts">
import { nextTick, ref } from 'vue'
import ProgramControlPanel from './ProgramControlPanel.vue'
import ProgramDataPanel from './ProgramDataPanel.vue'
import type { ProgramControllerSnapshot } from '../application/program-control.ts'
import type { RapidEditCommand, RapidEditResult } from '../rapid/controlled-rapid-edit.ts'
import type {
  RapidExecutableInstruction,
  RapidMotionInsertionPoint,
  RapidProgramData,
  RapidSourceRange,
} from '../rapid/rapid-parser.ts'
import type { Pose } from '../robotics/types.ts'
import type { RapidScalarVariable } from '../rapid/rapid-types.ts'

interface Props {
  snapshot: ProgramControllerSnapshot
  source: string
  program: readonly RapidExecutableInstruction[]
  pendingClear: 'run' | 'step' | null
  /** 完整 Program Data 联合（六类运动数据、num/bool 标量与系统预定义项）。 */
  data: readonly RapidProgramData[]
  /** 当前活动/下一条指令下标，供 Program Data 面板高亮当前 Tool/WObj/Speed/Zone/目标。 */
  activeIndex: number | null
  canExecute: boolean
  insertionPoints: readonly RapidMotionInsertionPoint[]
  pose: Pose | null
  applyEdit: (command: RapidEditCommand) => RapidEditResult
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
      >RAPID</button>
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
      >Program Data</button>
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
          :snapshot="props.snapshot"
          :source="props.source"
          :program="props.program"
          :pending-clear="props.pendingClear"
          :focus-range="focusRange"
          :focus-request-id="focusRequestId"
          @source-change="emit('source-change', $event)"
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
          :data="props.data"
          :active-index="props.activeIndex"
          :can-execute="props.canExecute"
          :program="props.program"
          :insertion-points="props.insertionPoints"
          :pose="props.pose"
          :apply-edit="props.applyEdit"
          :runtime-values="props.runtimeValues"
          @view-reference="focusRapidReference"
        />
      </div>
    </div>

    <div class="program-workspace-actions">
      <ProgramControlPanel
        display="actions"
        :snapshot="props.snapshot"
        :source="props.source"
        :program="props.program"
        :pending-clear="props.pendingClear"
        @run="emit('run')"
        @step="emit('step')"
        @stop="emit('stop')"
        @pp="emit('pp')"
        @confirm-clear="emit('confirm-clear')"
        @cancel-clear="emit('cancel-clear')"
      />
    </div>
  </section>
</template>
