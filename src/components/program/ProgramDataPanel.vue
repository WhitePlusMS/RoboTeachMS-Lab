<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/editing/index.ts'
import type {
  RapidDataKind,
  RapidExecutableInstruction,
  RapidProgramData,
  RapidSourceRange,
} from '@/rapid/language/index.ts'
import { isRapidMotionInstruction } from '@/rapid/language/index.ts'
import type { RapidScalarVariable } from '@/rapid/data/index.ts'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import ProgramDataTargetList from './ProgramDataTargetList.vue'
import ProgramDataReadonlyList from './ProgramDataReadonlyList.vue'

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

/** 各 kind Tab 按钮引用（roving tabindex 键盘导航用）。 */
const kindTabRefs: Partial<Record<RapidDataKind, HTMLButtonElement | null>> = {}

function setKindTabRef(kind: RapidDataKind, el: Element | ComponentPublicInstance | null): void {
  kindTabRefs[kind] = el instanceof HTMLButtonElement ? el : null
}

function selectKind(kind: RapidDataKind): void {
  activeKind.value = kind
}

function focusActiveKindTab(): void {
  void nextTick(() => {
    kindTabRefs[activeKind.value]?.focus()
  })
}

/** Tab 列表方向键/Home/End 导航（与 JogControlTabs 一致：移动即激活并聚焦）。 */
function handleKindTabKeydown(event: KeyboardEvent, index: number): void {
  const last = KINDS.length - 1
  let next: number | null = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = index === last ? 0 : index + 1
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = index === 0 ? last : index - 1
  } else if (event.key === 'Home') {
    next = 0
  } else if (event.key === 'End') {
    next = last
  }
  if (next === null) return
  event.preventDefault()
  selectKind(KINDS[next].kind)
  focusActiveKindTab()
}

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

/** 只由 ProgramDataTargetList（唯一写路径）产生；顶部错误横幅仍由 shell 统一展示。 */
const editError = ref<string | null>(null)

// 跨 Tab 语义：离开 robtarget Tab 时，若仍有受控选中的点位，通知宿主清空
// （selectedTargetName 由 App 唯一持有）。editError 不在此处清空——与原实现一致，
// 错误横幅在切换数据类型 Tab 后仍保留，直到下一次 selectTarget/受控编辑发生。
watch(activeKind, (kind, prevKind) => {
  if (prevKind === 'robtarget' && kind !== 'robtarget' && props.selectedTargetName != null) {
    emit('select-target', null)
  }
})
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
        role="status"
      >
        {{ props.canExecute ? '就绪' : '含错误' }}
      </span>
    </div>

    <p v-if="!props.canExecute" class="program-data-hint">
      源程序存在错误：仅只读浏览，已禁用结构化编辑与运行。
    </p>
    <p v-if="editError" class="program-data-error" role="alert">{{ editError }}</p>

    <div class="program-data-kind-tabs" role="tablist" aria-label="数据类型">
      <button
        v-for="(kind, index) in KINDS"
        :id="`program-data-tab-${kind.kind}`"
        :key="kind.kind"
        :ref="(el) => setKindTabRef(kind.kind, el)"
        type="button"
        role="tab"
        class="program-data-kind-tab"
        :class="{
          active: activeKind === kind.kind,
          'has-system': kindHasSystem[kind.kind] === true,
        }"
        :aria-selected="activeKind === kind.kind"
        :aria-controls="`program-data-tabpanel-${kind.kind}`"
        :tabindex="activeKind === kind.kind ? 0 : -1"
        :title="`查看${kind.zh}数据（${kind.en}）`"
        @click="selectKind(kind.kind)"
        @keydown="handleKindTabKeydown($event, index)"
      >
        <span class="program-data-kind-zh">{{ kind.zh }}</span>
        <span class="program-data-kind-en">{{ kind.en }}</span>
      </button>
    </div>

    <!-- 当前指令高亮：目标/速度/zone/工具/工件 + fly-by 提示 -->
    <div
      v-if="activeInstruction"
      class="program-data-active"
      role="status"
      aria-label="当前指令操作数"
    >
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

    <ProgramDataTargetList
      v-if="activeKind === 'robtarget'"
      :data="props.data"
      :can-execute="props.canExecute"
      :pose="props.pose"
      :joints="props.joints"
      :apply-edit="props.applyEdit"
      :selected-target-name="props.selectedTargetName"
      :active-target-name="activeOperandNames.target"
      @view-reference="emit('view-reference', $event)"
      @select-target="emit('select-target', $event)"
      @edit-error="editError = $event"
    />
    <ProgramDataReadonlyList
      v-else
      :data="props.data"
      :active-kind="activeKind"
      :runtime-values="props.runtimeValues"
      :active-operand-names="activeOperandNames"
      @view-reference="emit('view-reference', $event)"
    />
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
  display: none;
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

/* 双行密度过高：英文标识仅 active Tab 显示（其余 Tab 可从 title 提示查看）。 */
.program-data-kind-tab.active .program-data-kind-en {
  display: block;
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

/* kind Tab 对应的列表面板容器（两个子组件的根元素）：Vue 规定子组件根节点同时受父组件与
   自身的 scoped CSS 影响，因此下面这条嵌入态覆盖规则对子组件渲染出的 .program-data-tabpanel
   根节点同样生效；基础样式（display: grid 等）已在两个子组件各自的 <style scoped> 里定义，
   这里不重复。 */
.program-workspace-tabpanel > .program-data-panel > .program-data-tabpanel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 9px;
  min-height: 0;
}
</style>
