<script setup lang="ts">
import { ref } from 'vue'

const leftExpanded = ref(true)
const rightExpanded = ref(true)
</script>

<template>
  <section
    class="workbench-layout"
    :class="{ 'left-collapsed': !leftExpanded, 'right-collapsed': !rightExpanded }"
    aria-label="ABB 教学工作台"
  >
    <aside v-show="leftExpanded" class="workbench-side workbench-left" aria-label="左侧控制区">
      <button
        type="button"
        class="workbench-collapse-button workbench-collapse-left"
        aria-label="收起左侧面板"
        aria-controls="workbench-left-panel"
        aria-expanded="true"
        @click="leftExpanded = false"
      >
        ‹
      </button>
      <div id="workbench-left-panel" class="workbench-side-content">
        <slot name="left" />
      </div>
    </aside>
    <div
      v-show="!leftExpanded"
      class="workbench-collapsed-rail workbench-collapsed-left"
      aria-label="左侧面板已收起"
    >
      <button
        type="button"
        class="workbench-expand-button"
        aria-label="展开左侧面板"
        aria-controls="workbench-left-panel"
        aria-expanded="false"
        @click="leftExpanded = true"
      >
        ›
      </button>
    </div>

    <div class="workbench-center">
      <slot name="center" />
    </div>

    <aside v-show="rightExpanded" class="workbench-side workbench-right" aria-label="右侧编程区">
      <button
        type="button"
        class="workbench-collapse-button workbench-collapse-right"
        aria-label="收起右侧面板"
        aria-controls="workbench-right-panel"
        aria-expanded="true"
        @click="rightExpanded = false"
      >
        ›
      </button>
      <div id="workbench-right-panel" class="workbench-side-content">
        <slot name="right" />
      </div>
    </aside>
    <div
      v-show="!rightExpanded"
      class="workbench-collapsed-rail workbench-collapsed-right"
      aria-label="右侧面板已收起"
    >
      <button
        type="button"
        class="workbench-expand-button"
        aria-label="展开右侧面板"
        aria-controls="workbench-right-panel"
        aria-expanded="false"
        @click="rightExpanded = true"
      >
        ‹
      </button>
    </div>
  </section>
</template>

<style scoped>
.workbench-layout {
  display: grid;
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr) minmax(340px, 420px);
  gap: 12px;
  flex: 1 1 auto;
  width: 100%;
  max-width: none;
  min-height: 0;
  margin: 0 auto;
}

.workbench-layout.left-collapsed {
  grid-template-columns: 30px minmax(0, 1fr) minmax(340px, 420px);
}

.workbench-layout.right-collapsed {
  grid-template-columns: minmax(300px, 360px) minmax(0, 1fr) 30px;
}

.workbench-layout.left-collapsed.right-collapsed {
  grid-template-columns: 30px minmax(0, 1fr) 30px;
}

.workbench-side,
.workbench-collapsed-rail {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.8);
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.22);
}

.workbench-side {
  position: relative;
  overflow: hidden;
}

.workbench-side-content {
  height: 100%;
  min-height: 0;
  padding: 14px;
  overflow: hidden;
}

.workbench-collapsed-rail {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.66);
}

.workbench-collapse-button,
.workbench-expand-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--color-border-soft);
  border-radius: 6px;
  color: var(--color-text-muted);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  z-index: 3;
}

.workbench-collapse-button:hover,
.workbench-expand-button:hover {
  border-color: var(--color-brand-strong);
  color: var(--color-text-strong);
  background: var(--color-surface-hover);
}

.workbench-collapse-button {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}

.workbench-collapse-left {
  right: 4px;
}

.workbench-collapse-right {
  left: 4px;
}

.workbench-center {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
