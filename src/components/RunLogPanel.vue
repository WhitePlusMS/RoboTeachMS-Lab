<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { RunLogEntry, RunLogLevel } from '@/application/run-log.ts'

interface Props {
  entries: readonly RunLogEntry[]
}

const props = defineProps<Props>()

type LogFilter = 'all' | 'warn' | 'err'

const FILTERS: ReadonlyArray<{ key: LogFilter; label: string; title: string }> = [
  { key: 'all', label: '全部', title: '显示全部日志' },
  { key: 'warn', label: '警告', title: '仅显示警告与错误' },
  { key: 'err', label: '错误', title: '仅显示错误' },
]

const filter = ref<LogFilter>('all')
const collapsed = ref(false)
const body = ref<HTMLDivElement | null>(null)

const LEVEL_RANK: Record<RunLogLevel, number> = { info: 0, ok: 0, warn: 1, err: 2 }

/** 日志体可拖拽高度：默认 96px，用户拖动手柄后记忆显式值。 */
const DEFAULT_HEIGHT = 96
const MIN_HEIGHT = 60
const MAX_HEIGHT = 420
const logHeight = ref<number | null>(null)

const bodyHeight = computed(() => `${logHeight.value ?? DEFAULT_HEIGHT}px`)

/** 级别过滤：警告档含错误（阈值语义），错误档只看错误。 */
const visibleEntries = computed(() => {
  if (filter.value === 'all') return props.entries
  const threshold = filter.value === 'warn' ? 1 : 2
  return props.entries.filter((entry) => LEVEL_RANK[entry.level] >= threshold)
})

// 新条目到达时自动滚到底部（日志体固定高度内滚动）。
watch(
  () => props.entries.length,
  () => {
    void nextTick(() => {
      const el = body.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
)

function currentHeight(): number {
  return logHeight.value ?? DEFAULT_HEIGHT
}

function clampHeight(value: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, value))
}

/** 拖拽开始：捕捉指针并记录起始 Y 与起始高度。手柄在日志顶部，向上拖 → 高度增加。 */
function startResize(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement & {
    _resizeStartY?: number
    _resizeStartH?: number
  }
  target._resizeStartY = event.clientY
  target._resizeStartH = currentHeight()
  // jsdom 不实现指针捕获静态方法；存在才调用以便单测可直接派发指针事件。
  if (typeof target.setPointerCapture === 'function') target.setPointerCapture(event.pointerId)
}

function onResizeMove(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement & {
    _resizeStartY?: number
    _resizeStartH?: number
  }
  if (target._resizeStartY === undefined || target._resizeStartH === undefined) return
  // 手柄在上边缘：向上拖（clientY 减小）使日志更高。
  logHeight.value = clampHeight(target._resizeStartH + (target._resizeStartY - event.clientY))
}

function endResize(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement & {
    _resizeStartY?: number
    _resizeStartH?: number
  }
  if (typeof target.hasPointerCapture === 'function' && target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }
  delete target._resizeStartY
  delete target._resizeStartH
}
</script>

<template>
  <div class="run-log" :class="{ 'log-collapsed': collapsed }">
    <div
      class="log-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="拖拽调整日志高度"
      @pointerdown="startResize"
      @pointermove="onResizeMove"
      @pointerup="endResize"
      @pointercancel="endResize"
    >
      <span class="log-resize-grip" aria-hidden="true"></span>
    </div>
    <div class="log-head">
      <span class="log-title">日志输出</span>
      <span class="log-filters" role="group" aria-label="日志级别过滤">
        <button
          v-for="item in FILTERS"
          :key="item.key"
          type="button"
          class="choice log-filter"
          :class="{ on: filter === item.key }"
          :aria-pressed="filter === item.key"
          :title="item.title"
          @click="filter = item.key"
        >
          {{ item.label }}
        </button>
      </span>
      <button
        type="button"
        class="icon-btn log-toggle"
        :aria-label="collapsed ? '展开日志' : '收起日志'"
        :aria-expanded="!collapsed"
        :title="collapsed ? '展开日志' : '收起日志'"
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '▸' : '▾' }}
      </button>
    </div>
    <div
      v-show="!collapsed"
      ref="body"
      class="log-body"
      :style="{ height: bodyHeight }"
      aria-label="运行日志"
    >
      <p v-if="visibleEntries.length === 0" class="log-empty">暂无日志。</p>
      <div v-for="entry in visibleEntries" :key="entry.id" class="log-line">
        <span class="log-time">{{ entry.time }}</span>
        <span class="log-level" :class="`log-${entry.level}`">[{{ entry.tag }}]</span>
        <span class="log-text">{{ entry.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.run-log {
  flex: 0 0 auto;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface-deep);
}

/* 顶部拖拽手柄：悬停/拖动时提示可调整高度。 */
.log-resize {
  position: relative;
  height: 8px;
  cursor: ns-resize;
  touch-action: none;
  display: grid;
  place-items: center;
}

.log-resize-grip {
  display: block;
  width: 44px;
  height: 3px;
  border-radius: var(--radius-xs);
  background: var(--color-text-faint);
  opacity: 0.55;
  transition:
    opacity 0.15s ease,
    background 0.15s ease;
}

.log-resize:hover .log-resize-grip,
.log-resize:active .log-resize-grip {
  opacity: 1;
  background: var(--color-brand);
}

.log-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 16px;
  color: var(--color-text-dim);
  font-size: var(--text-sm);
}

.log-filters {
  display: inline-flex;
  gap: 5px;
}

.log-filter {
  min-width: 0;
  padding: 2px 9px;
}

.log-toggle {
  margin-left: auto;
}

.log-body {
  /* 高度可拖拽调整（inline style），默认 96px；新条目到达时不再顶动上方布局。 */
  min-height: 60px;
  padding: 6px 16px 10px;
  overflow-y: auto;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  line-height: 1.7;
  font-variant-numeric: tabular-nums;
}

.log-empty {
  margin: 0;
  color: var(--color-text-dim);
}

.log-time {
  margin-right: 8px;
  color: var(--color-text-faint);
}

.log-level {
  margin-right: 6px;
}

.log-info {
  color: var(--color-info);
}

.log-ok {
  color: var(--color-success);
}

.log-warn {
  color: var(--color-warning);
}

.log-err {
  color: var(--color-danger);
}
</style>
