<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import { Database, FileCode, Joystick, Maximize2, PanelRightClose, X } from '@lucide/vue'

/** 右侧功能面板可切换的功能集合；由窄图标边栏驱动。 */
type WorkbenchFunction = 'rapid' | 'data' | 'jog'

const RAIL_ITEMS: ReadonlyArray<{
  fn: WorkbenchFunction
  icon: Component
  text: string
  label: string
}> = [
  { fn: 'rapid', icon: FileCode, text: 'RAPID', label: 'RAPID 程序' },
  { fn: 'data', icon: Database, text: '数据', label: '程序数据 Program Data' },
  { fn: 'jog', icon: Joystick, text: '控制', label: '手动控制' },
]

const TITLES: Record<WorkbenchFunction, string> = {
  rapid: 'RAPID 程序',
  data: '程序数据',
  jog: '手动控制',
}

const activeFunction = ref<WorkbenchFunction>('rapid')
const panelOpen = ref(true)
/** 半屏加宽：RAPID 默认已 50vw，其余功能可临时加宽到同一上限。 */
const panelWide = ref(false)

const dockTitle = computed(() => TITLES[activeFunction.value])

/** 边栏选中某个功能：已展开且为当前功能时收起，否则切换并展开。 */
function selectFunction(fn: WorkbenchFunction): void {
  if (panelOpen.value && activeFunction.value === fn) {
    panelOpen.value = false
    return
  }
  activeFunction.value = fn
  panelOpen.value = true
}

function collapsePanel(): void {
  panelOpen.value = false
}
</script>

<template>
  <section
    class="workbench-layout"
    :class="[`view-${activeFunction}`, { 'panel-closed': !panelOpen, 'panel-wide': panelWide }]"
    aria-label="ABB 教学工作台"
  >
    <div class="workbench-center">
      <slot name="center" />
    </div>

    <aside v-show="panelOpen" class="workbench-dock" aria-label="工作区面板">
      <div class="dock-head">
        <h2 class="dock-title">{{ dockTitle }}</h2>
        <div class="dock-head-actions">
          <button
            type="button"
            class="icon-btn"
            aria-label="展开/收起半屏宽度"
            :aria-pressed="panelWide"
            title="展开到半屏"
            @click="panelWide = !panelWide"
          >
            <Maximize2 :size="15" />
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label="收起面板"
            title="收起面板"
            @click="collapsePanel"
          >
            <X :size="15" />
          </button>
        </div>
      </div>

      <div class="dock-body">
        <slot name="panel" :active-function="activeFunction" :select="selectFunction" />
      </div>
    </aside>

    <nav class="workbench-rail" role="tablist" aria-label="功能边栏">
      <button
        v-for="item in RAIL_ITEMS"
        :key="item.fn"
        type="button"
        role="tab"
        class="rail-btn"
        :class="{ on: panelOpen && activeFunction === item.fn }"
        :aria-label="item.label"
        :aria-selected="panelOpen && activeFunction === item.fn"
        @click="selectFunction(item.fn)"
      >
        <span class="rail-icon" aria-hidden="true">
          <component :is="item.icon" :size="16" />
        </span>
        {{ item.text }}
      </button>
      <div class="rail-sep" aria-hidden="true"></div>
      <button type="button" class="rail-btn" aria-label="收起面板" @click="collapsePanel">
        <span class="rail-icon" aria-hidden="true"><PanelRightClose :size="16" /></span>
        收起
      </button>
    </nav>
  </section>
</template>

<style scoped>
/* 主区：满幅 3D 视口 + 可收放功能面板 + 最右 52px 窄图标边栏。 */
.workbench-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 52px;
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  margin: 0 auto;
}

.workbench-center {
  grid-column: 1;
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workbench-dock {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  width: 480px;
  min-height: 0;
  border-left: 1px solid var(--color-border);
  background: var(--color-surface-deep);
  overflow: hidden;
  transition: width 0.2s ease;
}

/* RAPID 功能（源码编辑器）默认半屏宽，上限 860px。 */
.workbench-layout.view-rapid .workbench-dock,
.workbench-layout.panel-wide .workbench-dock {
  width: min(860px, 50vw);
}

.dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.dock-title {
  margin: 1px 0 0;
  color: var(--color-text-strong);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.dock-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dock-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/* 窄图标边栏（常驻，KUKA iiQKA 右边缘操作栏式）。 */
.workbench-rail {
  grid-column: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  border-left: 1px solid var(--color-border);
  background: var(--color-surface-deep);
}

.rail-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 42px;
  padding: 8px 0 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--color-text-faint);
  background: transparent;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background 0.15s ease;
}

.rail-btn .rail-icon {
  font-size: 16px;
  line-height: 1;
}

.rail-btn:hover {
  color: var(--color-text);
}

.rail-btn.on {
  border-color: var(--color-brand);
  color: var(--color-brand-soft);
  background: var(--color-brand-dim);
}

.rail-sep {
  width: 26px;
  margin: 4px 0;
  border-top: 1px solid var(--color-border);
}
</style>
