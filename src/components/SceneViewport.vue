<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  createKukaScene,
  type KukaSceneController,
  type KukaSceneStatus,
} from '../scene/kuka-scene'

const emit = defineEmits<{
  status: [value: KukaSceneStatus]
}>()

const viewport = ref<HTMLDivElement | null>(null)
let controller: KukaSceneController | null = null

onMounted(() => {
  if (!viewport.value) return
  controller = createKukaScene(viewport.value, {
    onStatus: (status) => emit('status', status),
  })
})

onBeforeUnmount(() => {
  controller?.dispose()
  controller = null
})
</script>

<template>
  <div ref="viewport" class="scene-viewport" role="img" aria-label="KUKA 机器人三维基准场景" />
</template>

<style scoped>
.scene-viewport {
  width: 100%;
  height: 100%;
  min-height: 420px;
  overflow: hidden;
  background: #101827;
}
</style>
