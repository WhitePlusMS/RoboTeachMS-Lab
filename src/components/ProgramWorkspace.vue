<script setup lang="ts">
import { computed, ref } from 'vue'
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

/** 工作区视图：由右侧窄图标边栏驱动（受控），RAPID 与 Program Data 二选一。 */
type WorkspaceView = 'rapid' | 'data'

interface Props {
  /** 当前视图（受控）；从 Program Data 查看引用时通过 update:view 请求切回 RAPID。 */
  view?: WorkspaceView
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

const activeView = computed(() => props.view ?? 'rapid')
const focusRange = ref<RapidSourceRange | null>(null)
const focusRequestId = ref(0)

/** Program Data 查看引用：定位源码编辑器并请求父级切回 RAPID 视图。 */
function focusRapidReference(range: RapidSourceRange): void {
  focusRange.value = range
  focusRequestId.value += 1
  emit('update:view', 'rapid')
}
</script>

<template>
  <section class="program-workspace" aria-label="RAPID 与程序数据工作区">
    <div class="program-workspace-content">
      <div
        id="program-panel-rapid"
        class="program-workspace-tabpanel"
        :hidden="activeView !== 'rapid'"
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
        :hidden="activeView !== 'data'"
      >
        <ProgramDataPanel
          display="content"
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

.program-workspace-tabpanel > .program-data-panel {
  min-height: 100%;
}
</style>
