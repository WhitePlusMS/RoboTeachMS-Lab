<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

const emit = defineEmits<{
  'view-reference': [range: RapidSourceRange]
}>()

type PanelView = 'list' | 'detail'
const panelView = ref<PanelView>('list')
const filterQuery = ref('')
const selectedName = ref<string | null>(null)
const newTargetName = ref('')
const renaming = ref(false)
const renameValue = ref('')
const editError = ref<string | null>(null)
const insertionIndex = ref<number | null>(null)

const filteredTargets = computed(() => {
  const query = filterQuery.value.trim().toLocaleLowerCase()
  if (!query) return props.targets
  return props.targets.filter((target) => target.name.toLocaleLowerCase().includes(query))
})

const selectedTarget = computed(() => {
  if (!selectedName.value) return null
  const normalized = selectedName.value.toLocaleLowerCase()
  return props.targets.find((target) => target.name.toLocaleLowerCase() === normalized) ?? null
})

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

/** 把当前 ABB 基座 tool0 TCP 转为 RAPID robtarget；MVP 明确使用零 robconf。 */
const taughtRobTarget = computed<RobTarget | null>(() => {
  if (!props.pose) return null
  const quat = rotationMatrixToQuaternion(props.pose.rotation)
  return makeEmptyTaughtTarget(
    [props.pose.position[0], props.pose.position[1], props.pose.position[2]],
    internalQuatToRapid(quat),
  )
})

watch(
  () => props.targets,
  (targets) => {
    if (selectedName.value && !targets.some((target) => target.name.toLocaleLowerCase() === selectedName.value?.toLocaleLowerCase())) {
      selectedName.value = null
      panelView.value = 'list'
    }
  },
)

watch(filterQuery, (query) => {
  if (!selectedName.value) return
  const normalized = selectedName.value.toLocaleLowerCase()
  if (query.trim() && !filteredTargets.value.some((target) => target.name.toLocaleLowerCase() === normalized)) {
    selectedName.value = null
    panelView.value = 'list'
  }
})

function formatCoord(value: readonly number[]): string {
  return value.map((entry) => (Number.isFinite(entry) ? entry.toFixed(1) : '—')).join(', ')
}

function formatRotation(rot: readonly number[]): string {
  return rot.map((entry) => entry.toFixed(3)).join(', ')
}

function referenceLabel(references: readonly RapidSourceRange[]): string {
  if (references.length === 0) return '未被引用'
  if (references.length === 1) return '1 处引用'
  return `${references.length} 处引用`
}

function selectTarget(name: string): void {
  selectedName.value = name
  panelView.value = 'list'
  renaming.value = false
  editError.value = null
}

function openDetails(): void {
  if (!selectedTarget.value) return
  panelView.value = 'detail'
  editError.value = null
}

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

function modifyPosition(): void {
  const target = selectedTarget.value
  if (!target) return
  if (!taughtRobTarget.value) {
    editError.value = '当前姿态不可用，无法更新点位'
    return
  }
  runEdit({ type: 'modify-position', name: target.name, target: taughtRobTarget.value })
}

function startRename(): void {
  const target = selectedTarget.value
  if (!target) return
  renaming.value = true
  renameValue.value = target.name
  editError.value = null
}

function commitRename(): void {
  const target = selectedTarget.value
  if (!target) return
  runEdit({ type: 'rename-target', name: target.name, newName: renameValue.value.trim() })
  if (!editError.value) {
    selectedName.value = renameValue.value.trim()
    renaming.value = false
  }
}

function deleteTarget(): void {
  const target = selectedTarget.value
  if (!target) return
  runEdit({ type: 'delete-target', name: target.name })
}

function insertMotion(kind: 'movej' | 'movel'): void {
  const target = selectedTarget.value
  if (!target) return
  runEdit({ type: 'insert-motion', name: target.name, kind, insertionIndex: selectedInsertionIndex.value })
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
      <span class="control-status" :class="props.canExecute ? 'program-state-idle' : 'program-state-error'">
        {{ props.canExecute ? '就绪' : '含错误' }}
      </span>
    </div>

    <p class="program-data-hint">
      {{ props.canExecute ? 'RAPID 模块 · robtarget 实例列表' : '源程序存在错误：仅只读浏览，已禁用结构化编辑与运行。' }}
    </p>
    <p v-if="editError" class="program-data-error">{{ editError }}</p>

    <template v-if="panelView === 'list'">
      <div class="program-data-toolbar">
        <span class="program-data-type-count">robtarget · {{ props.targets.length }} 项</span>
        <input
          v-model="filterQuery"
          class="program-data-filter"
          type="search"
          aria-label="按名称筛选点位"
          placeholder="按名称筛选"
          spellcheck="false"
        />
      </div>

      <div v-if="props.canExecute" class="program-data-teach">
        <div class="program-data-teach-heading">
          <p class="program-data-teach-title">从当前 TCP 新建点位</p>
          <span class="program-data-teach-preview">{{ taughtRobTarget ? formatCoord(taughtRobTarget.trans) : '当前 TCP 不可用' }}</span>
        </div>
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
      </div>

      <ul v-if="filteredTargets.length > 0" class="program-data-list" aria-label="robtarget 点位列表">
        <li
          v-for="target in filteredTargets"
          :key="`${target.nameRange.start.offset}-${target.name}`"
          class="program-data-item"
          :class="{ selected: selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase() }"
        >
          <button
            type="button"
            class="program-data-row"
            :aria-label="`选择点位 ${target.name}`"
            :aria-pressed="selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase()"
            @click="selectTarget(target.name)"
          >
            <span class="program-data-row-name">{{ target.name }}</span>
            <span class="program-data-label program-data-storage">{{ target.storage }}</span>
            <span class="program-data-row-coord">[{{ formatCoord(target.target.trans) }}]</span>
            <span class="program-data-label program-data-references">{{ referenceLabel(target.referenceRanges) }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="program-data-empty">
        {{ props.targets.length === 0 ? '源码中尚未声明 robtarget，或未识别到命名点位。' : '没有匹配的点位。' }}
      </p>

      <div v-if="selectedTarget" class="program-data-selection" aria-label="选中点位操作">
        <div class="program-data-selection-heading">
          <div>
            <span class="panel-kicker">SELECTED TARGET</span>
            <strong>{{ selectedTarget.name }}</strong>
          </div>
          <span class="program-data-references-text">{{ referenceLabel(selectedTarget.referenceRanges) }}</span>
        </div>
        <p v-if="selectedTarget.referenceRanges.length > 0" class="program-data-share-warning">
          共享目标：示教将影响 {{ selectedTarget.referenceRanges.length }} 处引用
        </p>
        <div v-if="selectedTarget.referenceRanges.length > 0" class="program-data-reference-links">
          <button
            v-for="(range, index) in selectedTarget.referenceRanges"
            :key="`${range.start.offset}-${index}`"
            type="button"
            class="program-data-reference-link"
            @click="emit('view-reference', range)"
          >查看引用 · 行 {{ range.start.line }}</button>
        </div>
        <div v-if="props.canExecute" class="program-data-actions">
          <button type="button" class="secondary-action" @click="modifyPosition">Modify Position（更新位置）</button>
          <button type="button" class="secondary-action" @click="openDetails">编辑数据</button>
          <label class="program-data-insert-position">
            插入位置
            <select v-model="insertionSelection" aria-label="插入位置">
              <option v-for="point in props.insertionPoints" :key="point.index" :value="point.index">
                {{ insertionLabel(point) }}
              </option>
            </select>
          </label>
          <button type="button" class="secondary-action" @click="insertMotion('movej')">插入 MoveJ</button>
          <button type="button" class="secondary-action" @click="insertMotion('movel')">插入 MoveL</button>
        </div>
      </div>
    </template>

    <template v-else-if="selectedTarget">
      <div class="program-data-detail-heading">
        <button type="button" class="secondary-action" @click="panelView = 'list'">返回列表</button>
        <div>
          <span class="panel-kicker">ROBTARGET DETAIL</span>
          <h3>{{ selectedTarget.name }}</h3>
        </div>
      </div>

      <div class="program-data-detail" aria-label="点位详情">
        <dl class="program-data-fields">
          <div>
            <dt>存储</dt>
            <dd>{{ selectedTarget.storage }}</dd>
          </div>
          <div>
            <dt>位置</dt>
            <dd>{{ formatCoord(selectedTarget.target.trans) }}</dd>
          </div>
          <div>
            <dt>姿态</dt>
            <dd>{{ formatRotation(selectedTarget.target.rot) }}</dd>
          </div>
          <div>
            <dt>robconf</dt>
            <dd>{{ formatCoord(selectedTarget.target.robconf) }}（当前 MVP 未模拟构型控制）</dd>
          </div>
          <div>
            <dt>外轴</dt>
            <dd>{{ formatCoord(selectedTarget.target.extax) }}</dd>
          </div>
          <div>
            <dt>引用</dt>
            <dd>{{ referenceLabel(selectedTarget.referenceRanges) }}</dd>
          </div>
        </dl>

        <div v-if="selectedTarget.referenceRanges.length > 0" class="program-data-reference-links">
          <button
            v-for="(range, index) in selectedTarget.referenceRanges"
            :key="`${range.start.offset}-${index}`"
            type="button"
            class="program-data-reference-link"
            @click="emit('view-reference', range)"
          >定位 RAPID 引用 · 行 {{ range.start.line }}</button>
        </div>

        <div v-if="props.canExecute" class="program-data-detail-actions">
          <button type="button" class="secondary-action" @click="modifyPosition">Modify Position（更新位置）</button>
          <template v-if="renaming">
            <input
              v-model="renameValue"
              class="program-data-name-input program-data-rename-input"
              aria-label="重命名点位"
              spellcheck="false"
              @keyup.enter="commitRename"
              @keyup.esc="renaming = false"
            />
            <button type="button" class="secondary-action" @click="commitRename">确认重命名</button>
            <button type="button" class="secondary-action" @click="renaming = false">取消</button>
          </template>
          <button v-else type="button" class="secondary-action" @click="startRename">重命名</button>
          <button type="button" class="danger-action" @click="deleteTarget">删除</button>
        </div>
      </div>
    </template>
  </section>
</template>
