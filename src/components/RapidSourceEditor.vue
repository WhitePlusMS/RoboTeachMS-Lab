<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  EditorView,
  GutterMarker,
  drawSelection,
  gutterLineClass,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  isRapidMotionInstruction,
  type RapidExecutableInstruction,
  type RapidSourceRange,
} from '@/rapid/language/index.ts'
import { rapid } from '@/rapid/editor/rapid-highlight.ts'

interface Props {
  source: string
  readonly: boolean
  /** 程序指针（PP）所在源码行；无效为 null。 */
  ppLine: number | null
  /** 运动指针（MP）所在源码行；无效为 null。 */
  mpLine: number | null
  /** 编辑器光标所在源码行（FlexPendant 式插入锚点）；未知为 null。 */
  cursorLine?: number | null
  /** 光标所在行的结构化指令（摘要条内容），来自 parser 结果。 */
  instruction: RapidExecutableInstruction | null
  /** parser 诊断所在源码行。 */
  diagnosticLines: readonly number[]
  /** 运行时规划错误所在源码行。 */
  runtimeErrorLine: number | null
  /** 从 Program Data 查看引用时，请求定位到该源码范围。 */
  focusRange?: RapidSourceRange | null
  /** 每次查看引用递增，即使范围对象相同也必须重新定位。 */
  focusRequestId?: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'source-change': [source: string]
  /** 编辑器光标（caret）所在源码行（1 起始），供 FlexPendant 式光标定位插入使用。 */
  'cursor-line-change': [line: number]
  /** 双击指令行（FlexPendant 双击 = Change Selected 打开参数编辑），携带该行行号（1 起始）。 */
  'line-activate': [line: number]
}>()

const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null

/** 自动换行开关：用 Compartment 动态切换 EditorView.lineWrapping。 */
const wrapOn = ref(true)
const wrapCompartment = new Compartment()
/** 只读开关：运行期间锁定编辑，用 Compartment 动态切换。 */
const readonlyCompartment = new Compartment()

/**
 * gutter 行标记：只为对应行的行号单元格附加 elementClass。
 * 遵循 GutterMarker 约定——只提供 elementClass、不提供 toDOM，
 * 这样不会插入 widget，而是把 class 挂到行号单元格上。
 * 注意：必须覆盖基类的 elementClass 而非另起字段，CodeMirror 才读取得到。
 */
class LineMarker extends GutterMarker {
  override elementClass: string
  constructor(className: string) {
    super()
    this.elementClass = className
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof LineMarker && other.elementClass === this.elementClass
  }
}

/** 标记刷新 effect：携带 (行号, 合并后的 gutter 类别 class 字符串)。 */
const markersEffect = StateEffect.define<Array<{ line: number; className: string }>>()

/**
 * gutter 行标记 StateField：把 PP/MP/诊断/运行时/光标行渲染到
 * gutterLineClass facet，使对应行号单元格获得类别 class。
 */
const gutterMarkerField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update: (set, tr) => {
    // 先随 doc 变更映射旧标记（保持行号对应），再应用新标记 effect（用新 doc 坐标重建）。
    let next = set.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(markersEffect)) {
        const ranges = effect.value.map((entry) => {
          const line = Math.max(1, Math.min(entry.line, tr.state.doc.lines))
          return new LineMarker(entry.className).range(tr.state.doc.line(line).from)
        })
        next = RangeSet.of(ranges, true)
      }
    }
    return next
  },
  provide: (field) => gutterLineClass.from(field),
})

/** 由 props 重算 gutter 标记并派发 effect。同格多类别合并成一个 class 字符串（CSS 依序覆盖）。 */
function syncGutterMarkers(): void {
  const current = view
  if (!current) return
  const merged = new Map<number, string[]>()
  const add = (line: number, cls: string): void => {
    if (line < 1) return
    const list = merged.get(line) ?? []
    if (!list.includes(cls)) list.push(cls)
    merged.set(line, list)
  }
  const pp = props.ppLine
  const mp = props.mpLine
  if (pp !== null) add(pp, 'pp-line')
  if (mp !== null) {
    if (pp !== null && pp === mp) {
      // 同行既 PP 又 MP → 用 both（渐变），去掉分条 pp-line。
      const list = (merged.get(pp) ?? []).filter((c) => c !== 'pp-line')
      list.push('both-line')
      merged.set(pp, list)
    } else {
      add(mp, 'mp-line')
    }
  }
  for (const line of props.diagnosticLines) add(line, 'diagnostic-line')
  if (props.runtimeErrorLine !== null) add(props.runtimeErrorLine, 'runtime-line')
  if (props.cursorLine !== null && props.cursorLine !== undefined) add(props.cursorLine, 'cursor-line')
  const entries = Array.from(merged.entries()).map(([line, classList]) => ({
    line,
    className: classList.join(' '),
  }))
  current.dispatch({ effects: markersEffect.of(entries) })
}

/** 组装 CodeMirror 扩展（首次创建即固定，之后通过 Compartment 动态变更能力）。 */
function buildExtensions() {
  return [
    lineNumbers({ formatNumber: (n: number) => String(n) }),
    wrapCompartment.of(wrapOn.value ? EditorView.lineWrapping : []),
    readonlyCompartment.of([
      EditorState.readOnly.of(props.readonly),
      EditorView.editable.of(!props.readonly),
    ]),
    gutterMarkerField,
    rapid,
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    drawSelection(),
    rectangularSelection(),
    scrollPastEnd(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) emit('source-change', update.state.doc.toString())
      // 无论输入还是移动光标，caret 行都可能变化，均需同步上报（旧 textarea 在 input/click/keyup 均上报）。
      if (update.docChanged || update.selectionSet) emitCursorLine()
    }),
    EditorView.domEventHandlers({
      dblclick: (event: MouseEvent) => emitLineActivate(event),
    }),
    // 点击 gutter 行号（FlexPendant 点选行语义）：把光标移到该行并上报（只读时不动）。
    // gutter 是 content 的兄弟节点，domEventHandlers 只挂到 .cm-content 上接收不到，
    // 故用 view.dom（.cm-editor 根）的捕获监听器可靠捕获 gutter 冒泡事件（含测试里的合成事件）。
  ]
}

function emitCursorLine(): void {
  const current = view
  if (!current) return
  const head = current.state.selection.main.head
  emit('cursor-line-change', current.state.doc.lineAt(head).number)
}

/**
 * 双击：目标 DOM 节点 → 源码行 → line-activate（FlexPendant Change Selected 语义）。
 * 用 posAtDOM 而非 posAtCoords——后者依赖真实布局的屏幕坐标，在 jsdom 里不可靠；
 * 而事件目标（.cm-line 及其子节点）直接落在 contentDOM 内，posAtDOM 即可定位。
 */
function emitLineActivate(event: MouseEvent): void {
  const current = view
  if (!current) return
  const target = event.target as HTMLElement | null
  if (!target || !current.contentDOM.contains(target)) return
  const pos = current.posAtDOM(target, 0)
  emit('line-activate', current.state.doc.lineAt(pos).number)
}

/**
 * FlexPendant 点选行：点击 gutter 行号把光标移到该行并上报行号（只读时不动）。
 * 用捕获阶段绑定到 view.dom（.cm-editor 根），确保在 CodeMirror 内部 gutter
 * handler 之前、且无论其是否处理，都能可靠收到从 .cm-gutterElement 冒泡的事件。
 */
function onGutterMousedown(event: MouseEvent): void {
  if (props.readonly) return
  const target = event.target as HTMLElement | null
  if (!target?.closest('.cm-lineNumbers')) return
  const cell = target.closest('.cm-gutterElement') as HTMLElement | null
  if (!cell) return
  const line = Number(cell.textContent)
  if (!Number.isInteger(line) || line < 1) return
  const current = view
  if (!current) return
  event.preventDefault()
  const caret = current.state.doc.line(Math.min(line, current.state.doc.lines)).from
  current.dispatch({ selection: { anchor: caret, head: caret } })
  current.focus()
  emit('cursor-line-change', line)
}

function mountEditor(): void {
  if (!host.value || view) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({ doc: props.source, extensions: buildExtensions() }),
  })
  view.dom.addEventListener('mousedown', onGutterMousedown, true)
  syncGutterMarkers()
}

/** 外部源码变化（预设加载 / localStorage 恢复 / 手动替换）：与当前 doc 不一致则整文替换。 */
watch(
  () => props.source,
  (next) => {
    const current = view
    if (!current) return
    if (current.state.doc.toString() === next) return
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: next },
    })
    syncGutterMarkers()
  },
)

/** 只读状态变化：切换只读 Compartment（运行期间锁定编辑）。 */
watch(
  () => props.readonly,
  (next) => {
    view?.dispatch({
      effects: readonlyCompartment.reconfigure([
        EditorState.readOnly.of(next),
        EditorView.editable.of(!next),
      ]),
    })
  },
)

/** 换行开关：切换 lineWrapping Compartment。 */
watch(wrapOn, (next) => {
  view?.dispatch({ effects: wrapCompartment.reconfigure(next ? EditorView.lineWrapping : []) })
})

/** 行标记（PP/MP/诊断/运行时/光标）变化时刷新 gutter。 */
watch(
  () =>
    [props.ppLine, props.mpLine, props.cursorLine, props.diagnosticLines, props.runtimeErrorLine] as
      const,
  () => syncGutterMarkers(),
)

/** Program Data 查看引用：定位到源码范围（选取 + 滚动可见），并上报光标行。 */
watch(
  () => [props.focusRange, props.focusRequestId] as const,
  ([range]) => {
    const current = view
    if (!range || !current) return
    const start = range.start.offset
    const end = range.end.offset
    current.dispatch({
      selection: { anchor: start, head: end },
      scrollIntoView: true,
    })
    emit('cursor-line-change', current.state.doc.lineAt(start).number)
  },
)

onMounted(() => mountEditor())
onBeforeUnmount(() => {
  view?.dom.removeEventListener('mousedown', onGutterMousedown, true)
  view?.destroy()
  view = null
})

/** 测试/诊断用：暴露底层 EditorView，便于确定性发起 dispatch。 */
defineExpose({
  getView: () => view,
})

const motionInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && isRapidMotionInstruction(instruction) ? instruction : null
})
const assignmentInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'assign' ? instruction : null
})
const conditionalInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'if' ? instruction : null
})
const whileInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'while' ? instruction : null
})
const forInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'for' ? instruction : null
})
const exitInstruction = computed(() => {
  const instruction = props.instruction
  return instruction && instruction.kind === 'exitdo' ? instruction : null
})
const kindLabel = computed(() => {
  if (motionInstruction.value) return motionInstruction.value.kind === 'movej' ? 'MoveJ' : 'MoveL'
  return assignmentInstruction.value ? '赋值' : ''
})
</script>

<template>
  <div class="source-editor-wrap">
    <div class="source-editor-scroll">
      <div ref="host" class="rapid-codemirror" />
    </div>

    <div class="instruction-summary" aria-label="当前结构化指令">
      <p v-if="!props.instruction" class="instruction-summary-empty">无活动指令。</p>
      <dl v-else-if="motionInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>{{ kindLabel }}</dd>
        </div>
        <div>
          <dt>目标</dt>
          <dd>{{ motionInstruction.operands.target }}</dd>
        </div>
        <div>
          <dt>速度</dt>
          <dd>{{ motionInstruction.operands.speed }}</dd>
        </div>
        <div>
          <dt>转弯区</dt>
          <dd>{{ motionInstruction.operands.zone }}</dd>
        </div>
        <div>
          <dt>工具</dt>
          <dd>{{ motionInstruction.operands.tool }}</dd>
        </div>
        <div>
          <dt>工件</dt>
          <dd>{{ motionInstruction.operands.wobj }}</dd>
        </div>
      </dl>
      <dl v-else-if="assignmentInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>{{ kindLabel }}</dd>
        </div>
        <div>
          <dt>变量</dt>
          <dd>{{ assignmentInstruction.target.name }}</dd>
        </div>
        <div>
          <dt>表达式</dt>
          <dd>{{ assignmentInstruction.sourceText }}</dd>
        </div>
      </dl>
      <dl v-else-if="conditionalInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>{{ conditionalInstruction.conditionKind === 'if' ? 'IF' : 'ELSEIF' }}</dd>
        </div>
        <div>
          <dt>条件</dt>
          <dd>{{ conditionalInstruction.sourceText }}</dd>
        </div>
      </dl>
      <dl v-else-if="whileInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>WHILE</dd>
        </div>
        <div>
          <dt>条件</dt>
          <dd>{{ whileInstruction.sourceText }}</dd>
        </div>
      </dl>
      <dl v-else-if="forInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>FOR</dd>
        </div>
        <div>
          <dt>循环头</dt>
          <dd>{{ forInstruction.sourceText }}</dd>
        </div>
        <div>
          <dt>循环变量</dt>
          <dd>{{ forInstruction.loopVar.name }}</dd>
        </div>
      </dl>
      <dl v-else-if="exitInstruction" class="instruction-summary-fields">
        <div>
          <dt>指令</dt>
          <dd>EXITDO</dd>
        </div>
        <div>
          <dt>说明</dt>
          <dd>提前退出当前循环</dd>
        </div>
      </dl>
      <!-- 换行开关：VS Code 状态栏语义（开 = soft wrap，关 = 横向滚动）。 -->
      <button
        type="button"
        class="wrap-toggle"
        :aria-pressed="wrapOn"
        title="自动换行"
        @click="wrapOn = !wrapOn"
      >
        换行
      </button>
    </div>
  </div>
</template>

<style scoped>
.source-editor-wrap {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

/* 编辑器与面板融为一体：无内嵌卡片边框，状态条以 hairline 分隔。 */
.source-editor-scroll {
  display: flex;
  flex: 1;
  min-height: 0;
  background: var(--color-editor);
  overflow: hidden;
}

.source-editor-scroll:focus-within {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-brand) 55%, transparent);
}

.rapid-codemirror {
  flex: 1;
  min-width: 0;
  min-height: 220px;
  overflow: hidden;
}

/* IDE 状态栏：贴附编辑器底边的 hairline 条，不再是浮动卡片。 */
.instruction-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-deep);
}

.instruction-summary-empty {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--color-text-faint);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.instruction-summary-fields {
  display: flex;
  flex: 1;
  gap: 4px 14px;
  min-width: 0;
  margin: 0;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}

.instruction-summary-fields div {
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.instruction-summary-fields dt {
  flex: 0 0 auto;
  color: var(--color-text-faint);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.instruction-summary-fields dd {
  min-width: 0;
  max-width: 260px;
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 换行开关（状态栏右端，VS Code 状态栏项语义）。 */
.wrap-toggle {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-xs);
  color: var(--color-text-faint);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-xs);
}

.wrap-toggle:hover {
  border-color: var(--color-brand);
  color: var(--color-text);
}

.wrap-toggle[aria-pressed='true'] {
  border-color: var(--color-brand);
  color: var(--color-brand-soft);
  background: var(--color-brand-dim);
}
</style>

<!-- CodeMirror 注入 DOM 无法被 scoped 作用域命中，需用非 scoped 全局规则做编辑器主题。
     所有颜色引用主题 token，保持单一数据源。选择器以 .source-editor-scroll 宿主限定，避免串扰页面其他部分。
     CodeMirror 自带类名为第三方 camelCase 命名（.cm-lineNumbers 等），无法 kebab-ize，故局部关闭该规则。 -->
<style>
/* stylelint-disable selector-class-pattern */
.source-editor-scroll .cm-editor {
  height: 100%;
  color: var(--color-text);
  background: var(--color-editor);
}

.source-editor-scroll .cm-editor.cm-focused {
  outline: none;
}

.source-editor-scroll .cm-scroller {
  font: var(--text-lg)/20px var(--font-mono);
}

.source-editor-scroll .cm-content {
  caret-color: var(--color-text);
  padding: 12px 0;
}

.source-editor-scroll .cm-line {
  padding: 0 12px;
}

/* 行号 gutter：与旧编辑器一致（浅灰底 + 深灰数字）。 */
.source-editor-scroll .cm-gutters {
  border-right: 1px solid var(--color-border-strong);
  background: var(--color-surface-deep);
  color: var(--color-text-dim-deep);
}

.source-editor-scroll .cm-lineNumbers .cm-gutterElement {
  min-width: 34px;
  padding: 0 8px 0 6px;
  text-align: right;
}

/* 光标行：gutter 左侧 3px 品牌黄 bar（与旧编辑器 cursor-line 一致）。 */
.source-editor-scroll .cm-lineNumbers .cm-gutterElement.cursor-line {
  background: var(--color-surface-raised);
  box-shadow: inset 3px 0 var(--color-pp);
}

/* PP 行（黄底深字），both 额外渐变底由下方规则覆盖。 */
.source-editor-scroll .cm-lineNumbers .cm-gutterElement.pp-line {
  color: var(--color-text-strong);
  background: var(--color-pp);
  font-weight: 700;
}

/* MP 行（橙底深字）。 */
.source-editor-scroll .cm-lineNumbers .cm-gutterElement.mp-line {
  color: var(--color-text-strong);
  background: var(--color-orange);
  font-weight: 700;
}

/* 同行既 PP 又 MP：渐变橙→黄（与旧编辑器 both-line 一致）。 */
.source-editor-scroll .cm-lineNumbers .cm-gutterElement.both-line {
  background: linear-gradient(90deg, var(--color-orange) 0 50%, var(--color-pp) 50% 100%);
}

/* 诊断行：左侧 4px 深红 bar。 */
.source-editor-scroll .cm-lineNumbers .cm-gutterElement.diagnostic-line {
  color: var(--color-danger-strong);
  box-shadow: inset 4px 0 var(--color-danger-strong);
}

/* 运行时错误行：整格红底白字。 */
.source-editor-scroll .cm-lineNumbers .cm-gutterElement.runtime-line {
  color: var(--color-on-fill);
  background: var(--color-error-bg);
  box-shadow: inset 4px 0 var(--color-error-edge);
}

/* 选中文本：浅品牌色底。 */
.source-editor-scroll .cm-editor ::selection {
  background: color-mix(in srgb, var(--color-brand) 18%, transparent);
}
</style>
