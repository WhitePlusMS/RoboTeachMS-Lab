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
      >‹</button>
      <div id="workbench-left-panel" class="workbench-side-content">
        <slot name="left" />
      </div>
    </aside>
    <div v-show="!leftExpanded" class="workbench-collapsed-rail workbench-collapsed-left" aria-label="左侧面板已收起">
      <button
        type="button"
        class="workbench-expand-button"
        aria-label="展开左侧面板"
        aria-controls="workbench-left-panel"
        aria-expanded="false"
        @click="leftExpanded = true"
      >›</button>
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
      >›</button>
      <div id="workbench-right-panel" class="workbench-side-content">
        <slot name="right" />
      </div>
    </aside>
    <div v-show="!rightExpanded" class="workbench-collapsed-rail workbench-collapsed-right" aria-label="右侧面板已收起">
      <button
        type="button"
        class="workbench-expand-button"
        aria-label="展开右侧面板"
        aria-controls="workbench-right-panel"
        aria-expanded="false"
        @click="rightExpanded = true"
      >‹</button>
    </div>
  </section>
</template>
