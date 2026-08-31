<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RapidDataKind, RapidProgramData, RapidSourceRange } from '@/rapid/language/index.ts'
import type { RapidScalarVariable } from '@/rapid/data/index.ts'
import {
  isActiveName,
  readonlyFields,
  referenceLabel,
  rowSummary,
} from './program-data-format.ts'

interface Props {
  /** 完整 Program Data 联合；本组件自行按 activeKind 过滤出当前 Tab 的只读条目。 */
  data: readonly RapidProgramData[]
  /** 当前浏览的数据种类（非 robtarget）。 */
  activeKind: RapidDataKind
  /** 来自 ProgramExecutor 快照的标量当前值；缺少条目时回退到声明初值。 */
  runtimeValues?: ReadonlyMap<string, RapidScalarVariable>
  /** 当前指令对应各 kind 的操作数名称，用于高亮当前使用的 Tool/WObj/Speed/Zone。 */
  activeOperandNames: { target: string; speed: string; zone: string; tool: string; wobj: string }
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'view-reference': [range: RapidSourceRange]
}>()

// —— 非 robtarget 只读浏览 ——
const readonlyEntries = computed(() =>
  props.data.filter((d) => d.kind === props.activeKind && d.kind !== 'robtarget'),
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
      return props.activeOperandNames.tool
    case 'wobjdata':
      return props.activeOperandNames.wobj
    case 'speeddata':
      return props.activeOperandNames.speed
    case 'zonedata':
      return props.activeOperandNames.zone
    default:
      return ''
  }
}
</script>

<template>
  <!-- 非 robtarget：只读列表 + 原地展开（系统预定义项与程序变量分节展示） -->
  <div
    :id="`program-data-tabpanel-${activeKind}`"
    class="program-data-tabpanel"
    role="tabpanel"
    :aria-labelledby="`program-data-tab-${activeKind}`"
  >
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
          :title="`选择 ${activeKind} 数据 ${entry.name}`"
          @click="selectReadonly(entry.name)"
        >
          <span class="program-data-row-name">{{ entry.name }}</span>
          <span class="program-data-label program-data-storage">{{ entry.storage }}</span>
          <span class="program-data-row-coord">{{ rowSummary(entry, runtimeValues) }}</span>
          <span class="program-data-label program-data-references">{{
            referenceLabel(entry.referenceRanges)
          }}</span>
        </button>

        <div
          v-if="selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()"
          class="program-data-inline-detail"
          role="region"
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
            <div v-for="[field, value] in readonlyFields(entry, activeKind, runtimeValues)" :key="field">
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
      <li
        v-if="systemEntries.length > 0"
        class="program-data-group-head program-data-group-system"
      >
        <span class="program-data-group-dot" aria-hidden="true"></span>系统预定义 · 只读
      </li>
      <li
        v-for="entry in systemEntries"
        :key="`sys-${entry.kind}-${entry.name}`"
        class="program-data-item program-data-item-system"
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
          :title="`选择 ${activeKind} 数据 ${entry.name}`"
          @click="selectReadonly(entry.name)"
        >
          <span class="program-data-row-name">{{ entry.name }}</span>
          <span class="program-data-label program-data-system">系统只读</span>
          <span class="program-data-label program-data-storage">{{ entry.storage }}</span>
          <span class="program-data-row-coord">{{ rowSummary(entry, runtimeValues) }}</span>
          <span class="program-data-label program-data-references">{{
            referenceLabel(entry.referenceRanges)
          }}</span>
        </button>

        <div
          v-if="selectedReadonly?.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()"
          class="program-data-inline-detail"
          role="region"
          :aria-label="`${activeKind} 详情`"
        >
          <div class="program-data-system-badge">系统预定义 · 只读</div>
          <dl class="program-data-fields">
            <div>
              <dt>存储</dt>
              <dd>{{ entry.storage }}</dd>
            </div>
            <div v-for="[field, value] in readonlyFields(entry, activeKind, runtimeValues)" :key="field">
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
  </div>
</template>

<style scoped>
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
  font-variant-numeric: tabular-nums;
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
}

/* 键盘焦点：背景变化之外补 inset 焦点环，避免仅替换 outline 而不可辨。 */
.program-data-row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-brand);
}

.program-data-row-name {
  flex: 0 1 auto;
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
  font-variant-numeric: tabular-nums;
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

/* 系统条目：背景/边框降强调表达只读/底层，文字保持全不透明度（不用整卡 opacity，避免伤对比度）。 */
.program-data-item-system {
  border-color: var(--color-border);
  background: color-mix(in srgb, var(--color-text-dim) 6%, transparent);
}

.program-data-item-system:hover {
  background: color-mix(in srgb, var(--color-text-dim) 12%, transparent);
}

.program-data-item-system.system-selected {
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
}

/* 键盘焦点环与 .program-data-row 一致：inset box-shadow。 */
.program-data-reference-link:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-brand);
}

.program-data-fields {
  display: grid;
  gap: 5px;
  margin: 0;
}

/* dt 列放宽：装得下 tframe.trans 等英文标识；dt 字号不小于 dd。 */
.program-data-fields div {
  display: grid;
  grid-template-columns: minmax(72px, auto) 1fr;
  gap: 8px;
}

.program-data-fields dt {
  color: var(--color-text-faint);
  font-size: var(--text-md);
}

.program-data-fields dd {
  margin: 0;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.program-data-tabpanel {
  display: grid;
  align-content: start;
  gap: 12px;
}
</style>
