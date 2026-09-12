<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_ROBTARGET,
  makeTaughtTargetFromPose,
  type RapidEditCommand,
  type RapidEditResult,
} from '@/rapid/editing/index.ts'
import { isRobtargetProgramData } from '@/rapid/language/index.ts'
import type { RapidProgramData, RapidSourceRange } from '@/rapid/language/index.ts'
import type { RobTarget } from '@/rapid/data/index.ts'
import type { JointAngles, Pose } from '@/robot-geometry/robot-types.ts'
import { formatCoord, formatRotation, isActiveName, referenceLabel } from './program-data-format.ts'

interface Props {
  /** 完整 Program Data 联合；本组件自行筛出 robtarget 条目。 */
  data: readonly RapidProgramData[]
  /** 源程序是否干净可执行；存在 error 时只读浏览、禁用结构化编辑。 */
  canExecute: boolean
  /** 当前活动 tool0 TCP（ABB 基座坐标），用于示教新目标值。 */
  pose: Pose | null
  joints?: JointAngles
  /** 唯一受控编辑入口；返回结果以展示结构化拒绝原因。 */
  applyEdit: (command: RapidEditCommand) => RapidEditResult
  /** 受控：当前选中的 robtarget 名称；由 App 唯一持有。 */
  selectedTargetName?: string | null
  /** 当前指令使用的 target 操作数名称（原始拼写），用于高亮当前使用的目标。 */
  activeTargetName: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'view-reference': [range: RapidSourceRange]
  'select-target': [name: string | null]
  'edit-error': [message: string | null]
}>()

// —— robtarget（点位示教）专用视图状态 ——
const filterQuery = ref('')
const newTargetName = ref('')
const renaming = ref(false)
const renameValue = ref('')
const editError = ref<string | null>(null)

// immediate: 每次挂载（Tab 切回 robtarget）都把当前值（初始为 null）同步给 shell 的错误横幅，
// 避免上一次挂载残留的错误信息在重新挂载后仍误报。
watch(editError, (message) => emit('edit-error', message), { immediate: true })

// 编辑位置二级展开：草稿与当前正在编辑的目标名称。
const editingPosition = ref(false)
const editTransDraft = ref<{ x: string; y: string; z: string }>({ x: '', y: '', z: '' })

/** 删除二次确认：armed 后 3 秒未确认或切换选中即复原。 */
const deleteArmed = ref(false)
let deleteArmTimer: number | null = null

function disarmDelete(): void {
  deleteArmed.value = false
  if (deleteArmTimer !== null) {
    window.clearTimeout(deleteArmTimer)
    deleteArmTimer = null
  }
}

function armDelete(): void {
  disarmDelete()
  deleteArmed.value = true
  deleteArmTimer = window.setTimeout(() => {
    deleteArmed.value = false
    deleteArmTimer = null
  }, 3000)
}

const robtargetEntries = computed(() => props.data.filter(isRobtargetProgramData))

const filteredTargets = computed(() => {
  const query = filterQuery.value.trim().toLocaleLowerCase()
  if (!query) return robtargetEntries.value
  return robtargetEntries.value.filter((target) => target.name.toLocaleLowerCase().includes(query))
})

const effectiveSelectedName = computed(() => props.selectedTargetName ?? null)

const selectedTarget = computed(() => {
  const name = effectiveSelectedName.value
  if (!name) return null
  const normalized = name.toLocaleLowerCase()
  return (
    robtargetEntries.value.find((target) => target.name.toLocaleLowerCase() === normalized) ?? null
  )
})

watch(effectiveSelectedName, disarmDelete)

/** 把当前 ABB 基座 tool0 TCP 转为 RAPID robtarget；教学语义统一入口。 */
const taughtRobTarget = computed<RobTarget | null>(() => {
  if (!props.pose) return null
  return makeTaughtTargetFromPose(props.pose, props.joints)
})

watch(
  () => props.data,
  (data) => {
    const name = effectiveSelectedName.value
    if (name && !data.some((d) => d.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      emit('select-target', null)
    }
  },
)

watch(filterQuery, (query) => {
  const name = effectiveSelectedName.value
  if (!name) return
  const normalized = name.toLocaleLowerCase()
  if (
    query.trim() &&
    !filteredTargets.value.some((target) => target.name.toLocaleLowerCase() === normalized)
  ) {
    emit('select-target', null)
  }
})

function selectTarget(name: string): void {
  const current = effectiveSelectedName.value
  if (current?.toLocaleLowerCase() === name.toLocaleLowerCase()) {
    editingPosition.value = false
    renaming.value = false
    emit('select-target', null)
  } else {
    editingPosition.value = false
    renaming.value = false
    editError.value = null
    emit('select-target', name)
  }
}

function runEdit(command: RapidEditCommand): void {
  const result = props.applyEdit(command)
  editError.value = result.ok ? null : result.error.message
}

function createTarget(): void {
  const name = newTargetName.value.trim()
  if (!name) {
    editError.value = '请输入新点位名称'
    return
  }
  // FlexPendant Program Data「New」：以类型默认值创建，位置后续用 Modify Position 录入。
  runEdit({ type: 'create-target', name, target: DEFAULT_ROBTARGET })
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

function startEditPosition(): void {
  const target = selectedTarget.value
  if (!target) return
  editingPosition.value = true
  editTransDraft.value = {
    x: String(target.target.trans[0]),
    y: String(target.target.trans[1]),
    z: String(target.target.trans[2]),
  }
  editError.value = null
}

function commitEditPosition(): void {
  const target = selectedTarget.value
  if (!target) return
  const raw = [
    editTransDraft.value.x.trim(),
    editTransDraft.value.y.trim(),
    editTransDraft.value.z.trim(),
  ]
  if (raw.some((value) => value === '')) {
    editError.value = 'X/Y/Z 不能为空'
    return
  }
  const values = raw.map((value) => Number(value))
  if (values.some((value) => !Number.isFinite(value))) {
    editError.value = 'X/Y/Z 必须均为有限数字'
    return
  }
  runEdit({
    type: 'modify-position',
    name: target.name,
    target: {
      trans: values as [number, number, number],
      rot: target.target.rot,
      robconf: target.target.robconf,
      extax: target.target.extax,
    },
  })
  if (!editError.value) editingPosition.value = false
}

function cancelEditPosition(): void {
  editingPosition.value = false
  editError.value = null
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
  const trimmed = renameValue.value.trim()
  runEdit({ type: 'rename-target', name: target.name, newName: trimmed })
  if (!editError.value) {
    renaming.value = false
    emit('select-target', trimmed)
  }
}

function cancelRename(): void {
  renaming.value = false
}

function deleteTarget(): void {
  const target = selectedTarget.value
  if (!target) return
  if (!deleteArmed.value) {
    armDelete()
    return
  }
  disarmDelete()
  runEdit({ type: 'delete-target', name: target.name })
  if (!editError.value) {
    emit('select-target', null)
  }
}
</script>

<template>
  <!-- robtarget：点位示教（含写操作） -->
  <div
    id="program-data-tabpanel-robtarget"
    class="program-data-tabpanel"
    role="tabpanel"
    aria-labelledby="program-data-tab-robtarget"
  >
    <div class="program-data-toolbar">
      <span class="program-data-type-count">robtarget · {{ robtargetEntries.length }} 项</span>
      <input
        v-model="filterQuery"
        class="program-data-filter"
        type="search"
        name="program-data-filter"
        autocomplete="off"
        aria-label="按名称筛选点位"
        placeholder="按名称筛选"
        spellcheck="false"
      />
    </div>

    <div v-if="canExecute" class="program-data-teach">
      <div class="program-data-teach-heading">
        <p class="program-data-teach-title">新建点位</p>
        <span class="program-data-teach-preview">以默认值创建，位置用 Modify Position 录入</span>
      </div>
      <div class="program-data-teach-row">
        <input
          v-model="newTargetName"
          class="program-data-name-input"
          name="program-data-new-target"
          autocomplete="off"
          aria-label="新点位名称"
          placeholder="如 pPick"
          spellcheck="false"
          @keyup.enter="createTarget"
        />
        <button
          type="button"
          class="primary-action"
          title="用输入的名称新建一个 robtarget 点位"
          @click="createTarget"
        >
          新建点位
        </button>
      </div>
    </div>

    <ul
      v-if="filteredTargets.length > 0"
      class="program-data-list"
      aria-label="robtarget 点位列表"
    >
      <li
        v-for="target in filteredTargets"
        :key="`${target.nameRange.start.offset}-${target.name}`"
        class="program-data-item"
        :class="{
          selected: selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase(),
          active: isActiveName(target.name, activeTargetName),
        }"
      >
        <button
          type="button"
          class="program-data-row"
          :aria-label="`选择点位 ${target.name}`"
          :aria-pressed="
            selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase()
          "
          :title="`选择点位 ${target.name}`"
          @click="selectTarget(target.name)"
        >
          <span class="program-data-row-name">{{ target.name }}</span>
          <span class="program-data-label program-data-storage">{{ target.storage }}</span>
          <span class="program-data-row-coord">[{{ formatCoord(target.target.trans) }}]</span>
          <span class="program-data-label program-data-references">{{
            referenceLabel(target.referenceRanges)
          }}</span>
        </button>

        <div
          v-if="selectedTarget?.name.toLocaleLowerCase() === target.name.toLocaleLowerCase()"
          class="program-data-inline-detail"
          role="region"
          aria-label="选中点位详情"
        >
          <p v-if="target.referenceRanges.length > 0" class="program-data-share-warning">
            共享目标：示教将影响 {{ target.referenceRanges.length }} 处引用
          </p>
          <div v-if="target.referenceRanges.length > 0" class="program-data-reference-links">
            <button
              v-for="(range, index) in target.referenceRanges"
              :key="`${range.start.offset}-${index}`"
              type="button"
              class="program-data-reference-link"
              :title="`在源码中定位该引用（行 ${range.start.line}）`"
              @click="emit('view-reference', range)"
            >
              查看引用 · 行 {{ range.start.line }}
            </button>
          </div>

          <dl class="program-data-fields">
            <div>
              <dt>存储</dt>
              <dd>{{ target.storage }}</dd>
            </div>
            <div>
              <dt>位置</dt>
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
            <div>
              <dt>引用</dt>
              <dd>{{ referenceLabel(target.referenceRanges) }}</dd>
            </div>
          </dl>

          <div v-if="canExecute" class="program-data-inline-actions">
            <button
              type="button"
              class="secondary-action"
              title="将本点位位置更新为当前 TCP 位姿"
              @click="modifyPosition"
            >
              Modify Position（更新位置）
            </button>
            <template v-if="editingPosition">
              <div class="program-data-edit-position">
                <label>
                  X
                  <input
                    v-model="editTransDraft.x"
                    type="text"
                    name="program-data-edit-x"
                    inputmode="decimal"
                    autocomplete="off"
                    aria-label="X"
                  />
                </label>
                <label>
                  Y
                  <input
                    v-model="editTransDraft.y"
                    type="text"
                    name="program-data-edit-y"
                    inputmode="decimal"
                    autocomplete="off"
                    aria-label="Y"
                  />
                </label>
                <label>
                  Z
                  <input
                    v-model="editTransDraft.z"
                    type="text"
                    name="program-data-edit-z"
                    inputmode="decimal"
                    autocomplete="off"
                    aria-label="Z"
                  />
                </label>
              </div>
              <button
                type="button"
                class="secondary-action"
                title="确认修改本点位位置"
                @click="commitEditPosition"
              >
                确认
              </button>
              <button
                type="button"
                class="secondary-action"
                title="取消位置修改"
                @click="cancelEditPosition"
              >
                取消
              </button>
            </template>
            <button
              v-else
              type="button"
              class="secondary-action"
              title="手动输入本点位的新位置"
              @click="startEditPosition"
            >
              编辑位置
            </button>
            <template v-if="renaming">
              <input
                v-model="renameValue"
                class="program-data-name-input program-data-rename-input"
                name="program-data-rename"
                autocomplete="off"
                aria-label="重命名点位"
                spellcheck="false"
                @keyup.enter="commitRename"
                @keyup.esc="cancelRename"
              />
              <button
                type="button"
                class="secondary-action"
                title="确认重命名本点位"
                @click="commitRename"
              >
                确认重命名
              </button>
              <button
                type="button"
                class="secondary-action"
                title="取消重命名"
                @click="cancelRename"
              >
                取消
              </button>
            </template>
            <button
              v-else
              type="button"
              class="secondary-action"
              title="重命名本点位"
              @click="startRename"
            >
              重命名
            </button>
            <button
              type="button"
              class="danger-action"
              :class="{ 'delete-armed': deleteArmed }"
              :title="deleteArmed ? '再次点击确认删除本点位' : '删除本点位（需二次确认）'"
              @click="deleteTarget"
            >
              {{ deleteArmed ? '确认删除？' : '删除' }}
            </button>
          </div>
        </div>
      </li>
    </ul>
    <p v-else class="program-data-empty">
      {{
        robtargetEntries.length === 0
          ? '源码中尚未声明 robtarget，或未识别到命名点位。'
          : '没有匹配的点位。'
      }}
    </p>
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

.program-data-filter {
  min-width: 0;
  flex: 1;
  padding: 7px 9px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-editor);
  font-size: var(--text-md);
}

.program-data-filter:focus {
  border-color: var(--color-brand-strong);
  outline: 2px solid color-mix(in srgb, var(--color-brand) 18%, transparent);
  outline-offset: 1px;
}

.program-data-teach {
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--color-border);
  border-left: 2px solid var(--color-brand);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.program-data-teach-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.program-data-teach-title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-md);
  font-weight: 700;
}

.program-data-teach-preview {
  min-width: 0;
  margin: 0;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.program-data-teach-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.program-data-name-input {
  flex: 1;
  min-width: 120px;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-editor);
  font-size: var(--text-lg);
  font-family: var(--font-mono);
}

.program-data-name-input:focus {
  outline: 2px solid color-mix(in srgb, var(--color-brand) 55%, transparent);
  outline-offset: 1px;
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

/* 存储标签（const/pers/var）更紧凑：收窄字距。 */
.program-data-storage {
  padding-inline: 5px;
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

.program-data-share-warning {
  flex-basis: 100%;
  margin: 0;
  color: var(--color-warning);
  font-size: var(--text-md);
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

.program-data-inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  padding-top: 7px;
  border-top: 1px solid var(--color-border-strong);
}

.program-data-edit-position {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex-basis: 100%;
  align-items: center;
}

.program-data-edit-position label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-faint);
  font-size: var(--text-md);
}

.program-data-edit-position input {
  width: 90px;
  padding: 5px 7px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-xs);
  color: var(--color-text);
  background: var(--color-editor);
  font-size: var(--text-md);
  font-family: var(--font-mono);
}

.program-data-rename-input {
  flex: 1;
  min-width: 130px;
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

/* 删除二次确认：armed 态高亮警示。 */
.danger-action.delete-armed {
  border-color: var(--color-danger-strong);
  color: var(--color-text-strong);
  background: var(--color-danger-hover-bg);
}

.program-data-tabpanel {
  display: grid;
  align-content: start;
  gap: 12px;
}
</style>
