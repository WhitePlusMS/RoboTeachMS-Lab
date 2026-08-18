<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { RunLogEntry, RunLogLevel } from '@/application/run-log.ts'

interface Props {
  entries: readonly RunLogEntry[]
}

const props = defineProps<Props>()

type LogFilter = 'all' | 'warn' | 'err'

const FILTERS: ReadonlyArray<{ key: LogFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'warn', label: '警告' },
  { key: 'err', label: '错误' },
]

const filter = ref<LogFilter>('all')
const collapsed = ref(false)
const body = ref<HTMLDivElement | null>(null)

const LEVEL_RANK: Record<RunLogLevel, number> = { info: 0, ok: 0, warn: 1, err: 2 }

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
</script>

<template>
  <div class="run-log" :class="{ 'log-collapsed': collapsed }">
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
        @click="collapsed = !collapsed"
      >
        {{ collapsed ? '▸' : '▾' }}
      </button>
    </div>
    <div v-show="!collapsed" ref="body" class="log-body" aria-label="运行日志">
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

.log-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 16px;
  color: var(--color-text-dim);
  font-size: 11px;
}

.log-filters {
  display: inline-flex;
  gap: 5px;
}

.log-filter {
  min-width: 0;
  padding: 2px 9px;
  font-size: 10.5px;
}

.log-toggle {
  margin-left: auto;
}

.log-body {
  /* 固定高度：新条目到达时不再顶动上方布局（视口/画布不随日志闪烁）。 */
  height: 96px;
  padding: 6px 16px 10px;
  overflow-y: auto;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.7;
  font-variant-numeric: tabular-nums;
}

.log-empty {
  margin: 0;
  color: var(--color-text-dim);
}

.log-time {
  margin-right: 8px;
  color: var(--color-text-dim);
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
