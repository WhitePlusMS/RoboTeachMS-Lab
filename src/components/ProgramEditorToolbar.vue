<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RapidEditCommand } from '@/rapid/controlled-rapid-edit.ts'
import { makeTaughtTargetFromPose } from '@/rapid/controlled-rapid-edit.ts'
import type {
  RapidExecutableInstruction,
  RapidMotionInsertionPoint,
} from '@/rapid/rapid-parser.ts'
import { isRobtargetProgramData } from '@/rapid/rapid-parser.ts'
import type { ProgramPanelController } from '@/application/use-program-panel-controller.ts'

/**
 * FlexPendant 程序编辑器工具栏（3HAC050941 5.3.4 对齐）：
 * - 「添加指令」：弹出 Common 类指令列表（MoveJ/MoveL），新指令为 `*,v1000,z50,tool0;`
 *   未示教占位形态，插在光标行之后（光标未知时回退到 PP 之后）；
 * - 「编辑」：更改选定内容（打开参数面板）/注释/取消注释/Change to MoveJ-MoveL，粒度为光标所在指令行；
 *   剪切/复制/粘贴不提供——网页版编辑器直接用系统剪贴板（Ctrl+X/C/V），语义与真机指令级操作等价；
 * - 撤销/重做：最多 3 步受控编辑历史。
 */
interface Props {
  controller: ProgramPanelController
  /** 源码编辑器光标行（1 起始）；null 表示尚未与编辑器交互。 */
  cursorLine: number | null
  /** 光标所在指令及其在 instructions 中的下标；null 表示光标不在任何指令上。 */
  cursorInstruction: { index: number; instruction: RapidExecutableInstruction } | null
  /** 光标所在源码行文本（用于注释/取消注释判定）；null 表示无光标。 */
  cursorLineText: string | null
}

const props = defineProps<Props>()

/** 插入成功后上报新指令所在源码行，让连续示教逐条向下追加。 */
const emit = defineEmits<{
  inserted: [line: number]
  /** 「编辑 → 更改选定内容」：请求打开光标指令的参数面板（FlexPendant Change Selected）。 */
  'open-arguments': []
}>()

const toolbarError = ref<string | null>(null)
const addOpen = ref(false)
const editOpen = ref(false)

const running = computed(() => props.controller.snapshot.value.state === 'running')

/**
 * 光标行解析：取光标行之后最近的合法锚点（锚点 line 为其前方指令/ENDPROC 所在行，
 * line > cursorLine 即"插在光标行之后"）。光标位于/超过最后一个锚点行（如 ENDPROC
 * 或程序末尾）时回退到程序末尾锚点——"我这一行之后"即追加到 main 末尾，而非误判"不在 main 内"。
 */
const resolvedPoint = computed<RapidMotionInsertionPoint | null>(() => {
  const points = props.controller.insertionPoints.value
  if (points.length === 0) return null
  if (props.cursorLine !== null) {
    const after = points.find((point) => point.line > (props.cursorLine as number))
    // 无严格在光标行之后的锚点：光标在/超过最后一个锚点行 → 追加到 main 末尾。
    return after ?? points[points.length - 1]
  }
  const afterPP = points.find(
    (point) => point.index > props.controller.snapshot.value.programPointer,
  )
  return afterPP ?? points[points.length - 1]
})

const canAdd = computed(() => !running.value && resolvedPoint.value !== null)

const cursorMotionKind = computed<'movej' | 'movel' | null>(() => {
  const instruction = props.cursorInstruction?.instruction
  if (!instruction) return null
  return instruction.kind === 'movej' || instruction.kind === 'movel' ? instruction.kind : null
})

/**
 * 光标指令的目标操作数是否为已命名 robtarget（`*` 占位与 Offs/RelTool 表达式不算）。
 * 决定常驻「修改位置」软按钮的可用态（FlexPendant 底部 Modify Position 对齐）。
 */
const namedTarget = computed(() => {
  if (cursorMotionKind.value === null) return null
  const current = props.cursorInstruction?.instruction
  if (!current || (current.kind !== 'movej' && current.kind !== 'movel')) return null
  const name = current.operands.target
  if (!name || name === '*') return null
  const normalized = name.toLocaleLowerCase('en-US')
  return (
    props.controller.data.value
      .filter(isRobtargetProgramData)
      .find((entry) => entry.name.toLocaleLowerCase('en-US') === normalized) ?? null
  )
})

const canModifyPosition = computed(
  () => !running.value && namedTarget.value !== null && props.controller.editable.value,
)

/** Modify Position：用当前 TCP 覆盖光标指令绑定的点位（与 Program Data 面板同一命令、同一教学语义）。 */
function modifyPosition(): void {
  const target = namedTarget.value
  if (!target) return
  const pose = props.controller.pose.value
  if (!pose) {
    toolbarError.value = '当前姿态不可用，无法更新点位'
    return
  }
  report(
    props.controller.applyEdit({
      type: 'modify-position',
      name: target.name,
      target: makeTaughtTargetFromPose(pose),
    }),
  )
}

function openArguments(): void {
  if (cursorMotionKind.value === null) return
  toolbarError.value = null
  editOpen.value = false
  emit('open-arguments')
}

/** 光标行是注释行（行首空白后跟 `!`）：可取消注释。 */
const cursorLineCommented = computed(
  () => props.cursorLineText !== null && /^\s*!/.test(props.cursorLineText),
)

function report(result: { ok: boolean } & { error?: { message: string } }): boolean {
  toolbarError.value = result.ok ? null : (result.error?.message ?? '操作失败')
  return result.ok
}

function addMotion(kind: 'movej' | 'movel'): void {
  toolbarError.value = null
  const point = resolvedPoint.value
  if (!point) {
    toolbarError.value = '当前无法插入指令'
    return
  }
  const command: RapidEditCommand = { type: 'insert-motion', kind, insertionIndex: point.index }
  if (!report(props.controller.applyEdit(command))) return
  addOpen.value = false
  // 新指令占用锚点原所在行；上报后下一次添加自动跟到新指令之后。
  emit('inserted', point.line)
}

function commentInstruction(): void {
  const target = props.cursorInstruction
  if (!target) return
  const result = props.controller.applyEdit({
    type: 'comment-instructions',
    indices: [target.index],
  })
  if (!report(result)) return
  editOpen.value = false
}

function uncommentLine(): void {
  if (props.cursorLine === null) return
  const result = props.controller.applyEdit({
    type: 'uncomment-lines',
    lines: [props.cursorLine],
  })
  if (!report(result)) return
  editOpen.value = false
}

function changeMotionKind(): void {
  const target = props.cursorInstruction
  if (!target) return
  const result = props.controller.applyEdit({ type: 'change-motion-kind', index: target.index })
  if (!report(result)) return
  editOpen.value = false
}

function undo(): void {
  toolbarError.value = null
  props.controller.undo()
}

function redo(): void {
  toolbarError.value = null
  props.controller.redo()
}
</script>

<template>
  <section class="program-editor-toolbar" aria-label="程序编辑器操作">
    <div class="program-editor-actions">
      <div class="program-editor-menu">
        <button
          type="button"
          class="secondary-action"
          :disabled="!canAdd"
          aria-label="添加指令"
          :aria-expanded="addOpen"
          @click="addOpen = !addOpen"
        >
          添加指令 ▾
        </button>
        <div v-if="addOpen" class="program-editor-menu-list" role="menu" aria-label="Common 指令列表">
          <p class="program-editor-menu-category">Common</p>
          <button type="button" role="menuitem" @click="addMotion('movej')">MoveJ</button>
          <button type="button" role="menuitem" @click="addMotion('movel')">MoveL</button>
        </div>
      </div>

      <div class="program-editor-menu">
        <button
          type="button"
          class="secondary-action"
          :disabled="running"
          aria-label="编辑"
          :aria-expanded="editOpen"
          @click="editOpen = !editOpen"
        >
          编辑 ▾
        </button>
        <div v-if="editOpen" class="program-editor-menu-list" role="menu" aria-label="编辑操作列表">
          <button
            type="button"
            role="menuitem"
            :disabled="cursorMotionKind === null"
            @click="openArguments"
          >
            更改选定内容
          </button>
          <button
            type="button"
            role="menuitem"
            :disabled="cursorInstruction === null"
            @click="commentInstruction"
          >
            注释
          </button>
          <button
            type="button"
            role="menuitem"
            :disabled="!cursorLineCommented"
            @click="uncommentLine"
          >
            取消注释
          </button>
          <button
            v-if="cursorMotionKind !== null"
            type="button"
            role="menuitem"
            @click="changeMotionKind"
          >
            {{ cursorMotionKind === 'movej' ? 'Change to MoveL' : 'Change to MoveJ' }}
          </button>
        </div>
      </div>

      <button
        type="button"
        class="secondary-action"
        :disabled="!canModifyPosition"
        aria-label="修改位置"
        @click="modifyPosition"
      >
        修改位置
      </button>
      <button
        type="button"
        class="secondary-action"
        :disabled="running || !controller.canUndo.value"
        aria-label="撤销"
        @click="undo"
      >
        ↩ 撤销
      </button>
      <button
        type="button"
        class="secondary-action"
        :disabled="running || !controller.canRedo.value"
        aria-label="重做"
        @click="redo"
      >
        ↪ 重做
      </button>
    </div>
    <p v-if="toolbarError" class="program-editor-toolbar-error">{{ toolbarError }}</p>
  </section>
</template>

<style scoped>
/* 外壳（边框/底色/内边距）由 ProgramWorkspace 的固定工具条统一提供，本组件只是行内一组控件。 */
.program-editor-toolbar {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
}

/* 所有按钮固定一行排列，不换行。 */
.program-editor-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 8px;
  align-items: center;
}

.program-editor-menu {
  position: relative;
}

/* FlexPendant 式指令/操作列表：下拉浮层，右对齐锚定按钮。 */
.program-editor-menu-list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-raised);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.program-editor-menu-category {
  margin: 2px 8px 4px;
  color: var(--color-text-faint);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.program-editor-menu-list [role='menuitem'] {
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: transparent;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.program-editor-menu-list [role='menuitem']:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.program-editor-menu-list [role='menuitem']:disabled {
  color: var(--color-text-faint);
  cursor: not-allowed;
}

.program-editor-toolbar-error {
  flex-basis: 100%;
  margin: 0;
  padding: 7px 9px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  border-radius: var(--radius-sm);
  color: var(--color-danger-soft);
  background: rgba(127, 29, 29, 0.2);
  font-size: 12px;
}
</style>
