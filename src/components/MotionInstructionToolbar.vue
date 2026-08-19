<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProgramControllerSnapshot } from '@/application/program-control.ts'
import type { RapidEditCommand, RapidEditResult } from '@/rapid/controlled-rapid-edit.ts'
import type { RapidExecutableInstruction, RapidMotionInsertionPoint } from '@/rapid/rapid-parser.ts'
import { makeTaughtTargetFromPose } from '@/rapid/controlled-rapid-edit.ts'
import type { Pose } from '@/robotics/types.ts'

/**
 * FlexPendant 式「添加指令」工具栏：
 * - 插入位置跟随源码编辑器光标行，新指令插在光标行之后（光标未知时回退到 PP 之后）；
 * - 目标点固定为示教当前 TCP 位姿，由受控编辑自动新建 robtarget（p10、p20…）。
 */
interface Props {
  snapshot: ProgramControllerSnapshot
  program: readonly RapidExecutableInstruction[]
  insertionPoints: readonly RapidMotionInsertionPoint[]
  /** 源码编辑器光标行（1 起始）；null 表示尚未与编辑器交互。 */
  cursorLine: number | null
  pose: Pose | null
  applyEdit: (command: RapidEditCommand) => RapidEditResult
}

const props = defineProps<Props>()

/** 插入成功后上报新指令所在源码行，让连续示教逐条向下追加。 */
const emit = defineEmits<{ inserted: [line: number] }>()

const toolbarError = ref<string | null>(null)

/**
 * 光标行解析：取光标行之后最近的合法锚点（锚点 line 为其前方指令/ENDPROC 所在行，
 * line > cursorLine 即"插在光标行之后"）。光标位于/超过最后一个锚点行（如 ENDPROC
 * 或程序末尾）时回退到程序末尾锚点——"我这一行之后"即追加到 main 末尾，而非误判"不在 main 内"。
 */
const resolvedPoint = computed<RapidMotionInsertionPoint | null>(() => {
  const points = props.insertionPoints
  if (points.length === 0) return null
  if (props.cursorLine !== null) {
    const after = points.find((point) => point.line > (props.cursorLine as number))
    // 无严格在光标行之后的锚点：光标在/超过最后一个锚点行 → 追加到 main 末尾。
    return after ?? points[points.length - 1]
  }
  const afterPP = points.find((point) => point.index > props.snapshot.programPointer)
  return afterPP ?? points[points.length - 1]
})

const canAdd = computed(() => {
  if (props.snapshot.state === 'running') return false
  if (props.snapshot.diagnostics.length > 0) return false
  if (resolvedPoint.value === null) return false
  return props.pose !== null
})

const insertionHint = computed(() => {
  if (props.insertionPoints.length === 0) {
    return '无可插入位置：程序需要包含 PROC main。'
  }
  const point = resolvedPoint.value
  if (point === null) {
    return '光标不在 main 程序体内：请点击源码中 ENDPROC 之前的位置。'
  }
  const where =
    point.index >= props.program.length
      ? '程序末尾'
      : `第 ${point.index + 1} 条之前 · 行 ${point.line}`
  const anchor = props.cursorLine === null ? 'PP 之后' : '光标行之后'
  return `插入位置：${anchor} · ${where}`
})

function addMotion(kind: 'movej' | 'movel'): void {
  toolbarError.value = null
  const point = resolvedPoint.value
  if (!point || !props.pose) {
    toolbarError.value = '当前无法生成运动指令'
    return
  }
  const command: RapidEditCommand = {
    type: 'insert-motion',
    kind,
    insertionIndex: point.index,
    target: { source: 'current', target: makeTaughtTargetFromPose(props.pose) },
  }
  const result = props.applyEdit(command)
  if (!result.ok) {
    toolbarError.value = result.error.message
    return
  }
  // 新指令占用锚点原所在行；上报后下一次添加自动跟到新指令之后。
  emit('inserted', point.line)
}
</script>

<template>
  <section class="motion-instruction-toolbar" aria-label="添加运动指令">
    <p class="motion-instruction-hint">{{ insertionHint }}</p>
    <div class="motion-instruction-actions">
      <button
        type="button"
        class="secondary-action"
        :disabled="!canAdd"
        aria-label="添加 MoveJ"
        @click="addMotion('movej')"
      >
        添加 MoveJ
      </button>
      <button
        type="button"
        class="secondary-action"
        :disabled="!canAdd"
        aria-label="添加 MoveL"
        @click="addMotion('movel')"
      >
        添加 MoveL
      </button>
    </div>
    <p v-if="toolbarError" class="motion-instruction-toolbar-error">{{ toolbarError }}</p>
  </section>
</template>

<style scoped>
/* 外壳（边框/底色/内边距）由 ProgramWorkspace 的固定工具条统一提供，本组件只是行内一组控件。 */
.motion-instruction-toolbar {
  display: flex;
  flex: 1 1 320px;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.motion-instruction-hint {
  flex: 1 1 200px;
  min-width: 0;
  margin: 0;
  color: var(--color-text-faint);
  font-size: 12px;
}

/* 两个添加按钮作为整体换行：窄面板下要么同行、要么整体掉到下一行右对齐，不被拆开。 */
.motion-instruction-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 10px;
  align-items: center;
  margin-left: auto;
}

.motion-instruction-toolbar-error {
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
