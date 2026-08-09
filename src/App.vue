<script setup lang="ts">
import { computed, ref } from 'vue'
import JointControlPanel from './components/JointControlPanel.vue'
import SceneViewport from './components/SceneViewport.vue'
import type { KukaSceneStatus } from './scene/kuka-scene'
import { useJointControl } from './robot/joint-control'

const sceneStatus = ref<KukaSceneStatus>('loading')
const {
  joints,
  jointStep,
  jointRanges,
  pose,
  setJoint,
  adjustJoint,
  setStep,
  reset,
  randomize,
} = useJointControl()

const statusLabel = computed(() => {
  if (sceneStatus.value === 'ready') return '场景已就绪'
  if (sceneStatus.value === 'error') return '已切换占位模型'
  return '正在加载模型'
})
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">ROBOT PROGRAMMING LAB · SKELETON</p>
        <h1>KUKA 机器人基准场景</h1>
        <p class="subtitle">ABB 编程仿真前端的独立 Vue3 骨架</p>
      </div>
      <span class="status-pill" :class="`status-${sceneStatus}`">
        <span class="status-dot" aria-hidden="true" />
        {{ statusLabel }}
      </span>
    </header>

    <section class="workspace" aria-label="机器人基准工作台">
      <aside class="info-panel">
        <div class="panel-heading">
          <span class="panel-kicker">MODEL</span>
          <h2>KUKA-6DOF</h2>
        </div>

        <dl class="model-facts">
          <div>
            <dt>当前阶段</dt>
            <dd>三维场景骨架</dd>
          </div>
          <div>
            <dt>场景交互</dt>
            <dd>旋转 · 缩放 · 平移</dd>
          </div>
          <div>
            <dt>后续接入</dt>
            <dd>关节与笛卡尔控制</dd>
          </div>
        </dl>

        <div class="hint-card">
          <p class="hint-title">操作提示</p>
          <p>左键拖拽旋转视角，滚轮缩放，右键拖拽平移场景。</p>
        </div>

        <JointControlPanel
          :joints="joints"
          :joint-ranges="jointRanges"
          :joint-step="jointStep"
          :pose="pose"
          @set-joint="setJoint"
          @adjust-joint="adjustJoint"
          @step-change="setStep"
          @reset="reset"
          @random="randomize"
        />
      </aside>

      <div class="viewport-card">
        <SceneViewport :joints="joints" @status="sceneStatus = $event" />
        <div class="viewport-caption">
          <span>WORLD / BASE FRAME</span>
          <span>OrbitControls</span>
        </div>
      </div>
    </section>

    <footer class="app-footer">
      <span>独立 Vite + Vue3 + TypeScript 应用</span>
      <span>·</span>
      <span>基础资源与构建配置自包含</span>
    </footer>
  </main>
</template>
