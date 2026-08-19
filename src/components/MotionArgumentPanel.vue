<script setup lang="ts">
import { computed, ref } from 'vue'
import { makeTaughtTargetFromPose } from '@/rapid/controlled-rapid-edit.ts'
import type {
  RapidExecutableInstruction,
  RapidProgramDataTarget,
} from '@/rapid/rapid-parser.ts'
import { isRobtargetProgramData } from '@/rapid/rapid-parser.ts'
import type { ProgramPanelController } from '@/application/use-program-panel-controller.ts'

/**
 * FlexPendant 参数编辑器（3HAC050941 5.4.2「参数编辑」对齐）：
 * 由双击指令行或「编辑 → 更改选定内容」显式打开（光标点选只高亮，不弹本面板），
 * 展示绑定指令的结构化摘要，并提供目标点/速度/转弯区三个可点参数。
 * - 目标点：选择已有点位，或新建点位（以当前 TCP 记录，`*` 占位补全）；
 * - 速度/转弯区：选择用户声明或系统预定义数据；
 * - 修改位置：常驻在程序编辑器工具栏（FlexPendant 底部软按钮语义），不在本面板。
 * 全部操作经唯一受控编辑入口 applyEdit，失败消息在面板内展示。
 */
interface Props {
  controller: ProgramPanelController
  /** 面板绑定的指令及其在 instructions 中的下标；null 表示面板关闭。 */
  cursorInstruction: { index: number; instruction: RapidExecutableInstruction } | null
}

const props = defineProps<Props>()

const emit = defineEmits<{ close: [] }>()

const panelError = ref<string | null>(null)
const openOperand = ref<'target' | 'speed' | 'zone' | null>(null)

/** 光标指令是否为受控可编辑的运动指令（movej/movel）。 */
const motion = computed(() => {
  const target = props.cursorInstruction
  if (!target) return null
  const instruction = target.instruction
  if (instruction.kind !== 'movej' && instruction.kind !== 'movel') return null
  return { index: target.index, instruction }
})

const robtargets = computed<readonly RapidProgramDataTarget[]>(() =>
  props.controller.data.value.filter(isRobtargetProgramData),
)

/** 速度/转弯区候选：用户声明 + 系统预定义（两者都在 data 中，system 标记只读但可选用）。 */
const speedEntries = computed(() =>
  props.controller.data.value.filter((entry) => entry.kind === 'speeddata'),
)
const zoneEntries = computed(() =>
  props.controller.data.value.filter((entry) => entry.kind === 'zonedata'),
)

function chooseExistingTarget(name: string): void {
  const current = motion.value
  if (!current) return
  const result = props.controller.applyEdit({
    type: 'edit-motion-operand',
    index: current.index,
    operand: 'target',
    value: { source: 'existing', name },
  })
  panelError.value = result.ok ? null : result.error.message
  if (result.ok) openOperand.value = null
}

function chooseNewTarget(): void {
  const current = motion.value
  if (!current) return
  const pose = props.controller.pose.value
  if (!pose) {
    panelError.value = '当前姿态不可用，无法新建点位'
    return
  }
  const result = props.controller.applyEdit({
    type: 'edit-motion-operand',
    index: current.index,
    operand: 'target',
    value: { source: 'new', target: makeTaughtTargetFromPose(pose) },
  })
  panelError.value = result.ok ? null : result.error.message
  if (result.ok) openOperand.value = null
}

function chooseDataOperand(operand: 'speed' | 'zone', name: string): void {
  const current = motion.value
  if (!current) return
  const result = props.controller.applyEdit({
    type: 'edit-motion-operand',
    index: current.index,
    operand,
    value: { name },
  })
  panelError.value = result.ok ? null : result.error.message
  if (result.ok) openOperand.value = null
}
</script>

<template>
  <section
    v-if="motion"
    class="motion-argument-panel"
    aria-label="指令参数"
  >
    <header class="motion-argument-head">
      <span class="motion-argument-kind">{{
        motion.instruction.kind === 'movej' ? 'MoveJ' : 'MoveL'
      }}</span>
      <span class="motion-argument-summary">
        <span
          class="motion-argument-operand"
          :class="{ 'not-taught': motion.instruction.operands.target === '*' }"
          role="button"
          tabindex="0"
          :aria-label="`目标点参数：${motion.instruction.operands.target}`"
          @click="openOperand = openOperand === 'target' ? null : 'target'"
          @keydown.enter="openOperand = openOperand === 'target' ? null : 'target'"
        >
          {{ motion.instruction.operands.target === '*' ? '未示教 *' : motion.instruction.operands.target }}
        </span>
        <span
          class="motion-argument-operand"
          role="button"
          tabindex="0"
          :aria-label="`速度参数：${motion.instruction.operands.speed}`"
          @click="openOperand = openOperand === 'speed' ? null : 'speed'"
          @keydown.enter="openOperand = openOperand === 'speed' ? null : 'speed'"
        >
          {{ motion.instruction.operands.speed }}
        </span>
        <span
          class="motion-argument-operand"
          role="button"
          tabindex="0"
          :aria-label="`转弯区参数：${motion.instruction.operands.zone}`"
          @click="openOperand = openOperand === 'zone' ? null : 'zone'"
          @keydown.enter="openOperand = openOperand === 'zone' ? null : 'zone'"
        >
          {{ motion.instruction.operands.zone }}
        </span>
        <span class="motion-argument-operand motion-argument-tool">tool {{ motion.instruction.operands.tool }}</span>
        <span v-if="motion.instruction.operands.wobj" class="motion-argument-operand motion-argument-tool">
          WObj {{ motion.instruction.operands.wobj }}
        </span>
      </span>
      <button
        type="button"
        class="motion-argument-close"
        aria-label="关闭参数面板"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <!-- 目标点选择器 -->
    <div v-if="openOperand === 'target'" class="motion-argument-selector">
      <p class="motion-argument-selector-title">选择目标点 robtarget</p>
      <button
        v-for="target in robtargets"
        :key="target.name"
        type="button"
        class="motion-argument-option"
        :aria-pressed="motion.instruction.operands.target.toLocaleLowerCase('en-US') === target.name.toLocaleLowerCase('en-US')"
        @click="chooseExistingTarget(target.name)"
      >
        <span class="motion-argument-option-name">{{ target.name }}</span>
        <span class="motion-argument-option-detail">[{{ target.target.trans.map((v) => (Number.isFinite(v) ? v.toFixed(1) : '—')).join(', ') }}]</span>
      </button>
      <button
        v-if="controller.pose.value"
        type="button"
        class="motion-argument-option motion-argument-option-new"
        @click="chooseNewTarget"
      >
        <span class="motion-argument-option-name">新建点位（记录当前位置）</span>
        <span class="motion-argument-option-detail">自动命名 p10 起</span>
      </button>
      <p v-if="robtargets.length === 0 && !controller.pose.value" class="motion-argument-empty">
        尚无 robtarget，且当前姿态不可用。
      </p>
    </div>

    <!-- 速度选择器 -->
    <div v-else-if="openOperand === 'speed'" class="motion-argument-selector">
      <p class="motion-argument-selector-title">选择速度 speeddata</p>
      <button
        v-for="entry in speedEntries"
        :key="entry.name"
        type="button"
        class="motion-argument-option"
        :class="{ 'motion-argument-option-system': entry.system }"
        :aria-pressed="motion.instruction.operands.speed.toLocaleLowerCase('en-US') === entry.name.toLocaleLowerCase('en-US')"
        @click="chooseDataOperand('speed', entry.name)"
      >
        <span class="motion-argument-option-name">{{ entry.name }}</span>
        <span v-if="entry.system" class="motion-argument-option-badge">系统</span>
        <span class="motion-argument-option-detail">
          {{ entry.value.v_tcp.toFixed(0) }} mm/s
        </span>
      </button>
      <p v-if="speedEntries.length === 0" class="motion-argument-empty">尚无 speeddata。</p>
    </div>

    <!-- 转弯区选择器 -->
    <div v-else-if="openOperand === 'zone'" class="motion-argument-selector">
      <p class="motion-argument-selector-title">选择转弯区 zonedata</p>
      <button
        v-for="entry in zoneEntries"
        :key="entry.name"
        type="button"
        class="motion-argument-option"
        :class="{ 'motion-argument-option-system': entry.system }"
        :aria-pressed="motion.instruction.operands.zone.toLocaleLowerCase('en-US') === entry.name.toLocaleLowerCase('en-US')"
        @click="chooseDataOperand('zone', entry.name)"
      >
        <span class="motion-argument-option-name">{{ entry.name }}</span>
        <span v-if="entry.system" class="motion-argument-option-badge">系统</span>
        <span class="motion-argument-option-detail">
          {{ entry.value.finep ? 'fine' : `${entry.value.pzoneTcp.toFixed(0)} mm` }}
        </span>
      </button>
      <p v-if="zoneEntries.length === 0" class="motion-argument-empty">尚无 zonedata。</p>
    </div>

    <div v-if="motion.instruction.operands.target === '*'" class="motion-argument-actions">
      <span class="motion-argument-note">
        目标未示教：请选择或新建点位，否则程序不能运行。
      </span>
    </div>

    <p v-if="panelError" class="motion-argument-error">{{ panelError }}</p>
  </section>
</template>

<style scoped>
.motion-argument-panel {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-left: 2px solid var(--color-brand);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.motion-argument-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
}

.motion-argument-close {
  margin-left: auto;
  padding: 0 6px;
  border: 0;
  color: var(--color-text-faint);
  background: transparent;
  font-size: var(--text-2xl);
  line-height: 1.4;
  cursor: pointer;
}

.motion-argument-close:hover,
.motion-argument-close:focus-visible {
  color: var(--color-text-strong);
  outline: none;
}

.motion-argument-kind {
  color: var(--color-text-strong);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  font-weight: 700;
}

.motion-argument-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-family: var(--font-mono);
  font-size: var(--text-md);
}

.motion-argument-operand {
  padding: 2px 7px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-xs);
  color: var(--color-text);
  background: var(--color-editor);
  cursor: pointer;
}

.motion-argument-operand:hover,
.motion-argument-operand:focus-visible {
  border-color: var(--color-brand-strong);
  outline: none;
}

.motion-argument-operand.not-taught {
  border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
  color: var(--color-danger-soft);
}

.motion-argument-tool {
  cursor: default;
  color: var(--color-text-faint);
}

.motion-argument-tool:hover {
  border-color: var(--color-border-soft);
}

.motion-argument-selector {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow: hidden auto;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-raised);
  scrollbar-gutter: stable;
}

.motion-argument-selector-title {
  margin: 0 2px 2px;
  color: var(--color-text-faint);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.03em;
}

.motion-argument-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--radius-xs);
  color: var(--color-text);
  background: transparent;
  font-size: var(--text-md);
  text-align: left;
  cursor: pointer;
}

.motion-argument-option:hover,
.motion-argument-option:focus-visible {
  background: color-mix(in srgb, var(--color-brand) 18%, transparent);
  outline: none;
}

.motion-argument-option-name {
  font-family: var(--font-mono);
  color: var(--color-text-strong);
  font-weight: 600;
}

.motion-argument-option-detail {
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.motion-argument-option-badge {
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 55%, transparent);
  border-radius: var(--radius-pill);
  color: var(--color-warning-soft);
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
  font-size: var(--text-xs);
}

.motion-argument-option-system .motion-argument-option-name {
  color: var(--color-warning-soft);
}

.motion-argument-option-new .motion-argument-option-name {
  color: var(--color-brand-soft);
}

.motion-argument-empty {
  margin: 0;
  padding: 6px 2px;
  color: var(--color-text-faint);
  font-size: var(--text-md);
}

.motion-argument-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.motion-argument-note {
  color: var(--color-warning-soft);
  font-size: var(--text-md);
}

.motion-argument-error {
  margin: 0;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
  border-radius: var(--radius-sm);
  color: var(--color-danger-soft);
  background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  font-size: var(--text-md);
}
</style>
