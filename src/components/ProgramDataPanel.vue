<script setup lang="ts">
import { computed, ref } from 'vue'
import { makeEmptyTaughtTarget, type RapidEditCommand, type RapidEditResult } from '../rapid/controlled-rapid-edit.ts'
import type {
  RapidExecutableInstruction,
  RapidMotionInsertionPoint,
  RapidProgramDataTarget,
  RapidSourceRange,
} from '../rapid/rapid-parser.ts'
import type { RobTarget } from '../rapid/rapid-types.ts'
import type { Pose } from '../robotics/types.ts'
import { rotationMatrixToQuaternion } from '../robotics/math/rotation3d.ts'
import { internalQuatToRapid } from '../rapid/plan-shared.ts'

interface Props {
  targets: readonly RapidProgramDataTarget[]
  /** 源程序是否干净可执行；存在 error 时 Program Data 只读浏览、禁用结构化编辑与运行。 */
  canExecute: boolean
  /** 当前 main 中可用的运动插入位置。 */
  insertionPoints: readonly RapidMotionInsertionPoint[]
  /** 当前已解析运动，用于把插入位置显示成可理解的教学标签。 */
  program: readonly RapidExecutableInstruction[]
  /** 当前活动 tool0 TCP（ABB 基座坐标），用于示教新目标值。 */
  pose: Pose | null
  /** 唯一受控编辑入口；返回结果以展示结构化拒绝原因。 */
  applyEdit: (command: RapidEditCommand) => RapidEditResult
}

const props = defineProps<Props>()

/** 新建点位的名称输入与待重命名目标。 */
const newTargetName = ref('')
const renamingName = ref<string | null>(null)
const renameValue = ref('')
const editError = ref<string | null>(null)
const insertionIndex = ref<number | null>(null)

const selectedInsertionIndex = computed(() => {
  const points = props.insertionPoints
  if (points.length === 0) return 0
  if (insertionIndex.value !== null && points.some((point) => point.index === insertionIndex.value)) {
    return insertionIndex.value
  }
  return points[points.length - 1].index
})
const insertionSelection = computed({
  get: () => selectedInsertionIndex.value,
  set: (value: number | string) => {
    insertionIndex.value = Number(value)
  },
})

/** 把当前 ABB 基座 tool0 TCP（Pose）转换为 RAPID robtarget（q 标量在前顺序、零 robconf、未用外轴）。 */
const taughtRobTarget = computed<RobTarget | null>(() => {
  if (!props.pose) return null
  const quat = rotationMatrixToQuaternion(props.pose.rotation)
  const trans: [number, number, number] = [
    props.pose.position[0],
    props.pose.position[1],
    props.pose.position[2],
  ]
  return makeEmptyTaughtTarget(trans, internalQuatToRapid(quat))
})

function formatCoord(value: readonly number[]): string {
  return value.map((v) => (Number.isFinite(v) ? v.toFixed(1) : '—')).join(', ')
}

function formatRotation(rot: readonly number[]): string {
  return rot.map((v) => v.toFixed(3)).join(', ')
}

function referenceLabel(references: readonly RapidSourceRange[]): string {
  if (references.length === 0) return '未被引用'
  if (references.length === 1) return '1 处引用'
  return `${references.length} 处引用`
}

/** 执行一条受控编辑命令并把结构化拒绝原因展示给用户。 */
function runEdit(command: RapidEditCommand): void {
  const result = props.applyEdit(command)
  editError.value = result.ok ? null : result.error.message
}

function createTarget(): void {
  if (!taughtRobTarget.value) {
    editError.value = '当前姿态不可用，无法示教点位'
    return
  }
  const name = newTargetName.value.trim()
  if (!name) {
    editError.value = '请输入新点位名称'
    return
  }
  runEdit({ type: 'create-target', name, target: taughtRobTarget.value })
  if (!editError.value) newTargetName.value = ''
}

function modifyPosition(name: string): void {
  if (!taughtRobTarget.value) {
    editError.value = '当前姿态不可用，无法更新点位'
    return
  }
  runEdit({ type: 'modify-position', name, target: taughtRobTarget.value })
}

function startRename(name: string): void {
  renamingName.value = name
  renameValue.value = name
  editError.value = null
}

function commitRename(): void {
  if (renamingName.value === null) return
  runEdit({ type: 'rename-target', name: renamingName.value, newName: renameValue.value.trim() })
  renamingName.value = null
}

function deleteTarget(name: string): void {
  runEdit({ type: 'delete-target', name })
}

function insertMotion(name: string, kind: 'movej' | 'movel'): void {
  runEdit({ type: 'insert-motion', name, kind, insertionIndex: selectedInsertionIndex.value })
}

function insertionLabel(point: RapidMotionInsertionPoint): string {
  if (point.index >= props.program.length) return '程序末尾'
  const instruction = props.program[point.index]
  return `第 ${point.index + 1} 条之前 · ${instruction.kind === 'movej' ? 'MoveJ' : 'MoveL'} · 行 ${point.line}`
}
</script>

<template>
  <section class="program-data-panel" aria-labelledby="program-data-title">
    <div class="panel-title-row">
      <div>
        <p class="panel-kicker">PROGRAM DATA</p>
        <h2 id="program-data-title">点位数据</h2>
      </div>
      <span class="control-status" :class="canExecute ? 'program-state-idle' : 'program-state-error'">
        {{ canExecute ? '就绪' : '含错误' }}
      </span>
    </div>

    <p class="program-data-hint">
      {{ canExecute ? '由右侧 RAPID 源码实时派生，无独立点位存储。' : '源程序存在错误：仅只读浏览，已禁用结构化编辑与运行。' }}
    </p>

    <p v-if="editError" class="program-data-error">{{ editError }}</p>

    <div v-if="canExecute" class="program-data-teach">
      <p class="program-data-teach-title">从当前 TCP 示教</p>
      <div class="program-data-teach-row">
        <input
          v-model="newTargetName"
          class="program-data-name-input"
          aria-label="新点位名称"
          placeholder="如 pPick"
          spellcheck="false"
          @keyup.enter="createTarget"
        />
        <button type="button" class="primary-action" @click="createTarget">新建点位</button>
      </div>
      <p class="program-data-teach-preview">当前 TCP：{{ taughtRobTarget ? formatCoord(taughtRobTarget.trans) : '不可用' }}</p>
    </div>

    <ul v-if="props.targets.length === 0" class="program-data-empty">
      <li>源码中尚未声明 robtarget，或未识别到命名点位。</li>
    </ul>
    <ul v-else class="program-data-list">
      <li v-for="target in props.targets" :key="`${target.nameRange.start.offset}`" class="program-data-item">
        <div class="program-data-item-head">
          <template v-if="renamingName === target.name">
            <input
              v-model="renameValue"
              class="program-data-name-input program-data-rename-input"
              aria-label="重命名点位"
              spellcheck="false"
              @keyup.enter="commitRename"
              @keyup.esc="renamingName = null"
            />
            <button type="button" class="secondary-action" @click="commitRename">确认</button>
            <button type="button" class="secondary-action" @click="renamingName = null">取消</button>
          </template>
          <template v-else>
            <span class="program-data-name">{{ target.name }}</span>
            <span class="program-data-label program-data-storage">{{ target.storage }}</span>
            <span class="program-data-label program-data-references">{{ referenceLabel(target.referenceRanges) }}</span>
          </template>
        </div>
        <dl class="program-data-fields">
          <div>
            <dt>坐标</dt>
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
        </dl>
        <p v-if="target.referenceRanges.length > 0" class="program-data-reflines">
          <template v-for="(range, index) in target.referenceRanges" :key="index">
            <span>行 {{ range.start.line }}</span>
          </template>
        </p>

        <div v-if="canExecute" class="program-data-actions">
          <span v-if="target.referenceRanges.length > 0" class="program-data-share-warning">
            共享目标：示教将影响 {{ target.referenceRanges.length }} 处引用
          </span>
          <button type="button" class="secondary-action" @click="modifyPosition(target.name)">Modify Position（更新位置）</button>
          <button type="button" class="secondary-action" @click="startRename(target.name)">重命名</button>
          <button type="button" class="danger-action" @click="deleteTarget(target.name)">删除</button>
          <label class="program-data-insert-position">
            插入位置
            <select v-model="insertionSelection" aria-label="插入位置">
              <option v-for="point in props.insertionPoints" :key="point.index" :value="point.index">
                {{ insertionLabel(point) }}
              </option>
            </select>
          </label>
          <button type="button" class="secondary-action" @click="insertMotion(target.name, 'movej')">插入 MoveJ</button>
          <button type="button" class="secondary-action" @click="insertMotion(target.name, 'movel')">插入 MoveL</button>
        </div>
      </li>
    </ul>
  </section>
</template>
