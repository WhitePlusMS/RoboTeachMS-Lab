<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RobotModel } from '../core/robot/robot-model'
import type { JointAngles } from '../core/robot/types'
import {
  createKukaScene,
  type KukaSceneController,
  type KukaSceneStatus,
} from '../scene/kuka-scene'

const props = defineProps<{
  joints: JointAngles
}>()

const emit = defineEmits<{
  status: [value: KukaSceneStatus]
  model: [value: RobotModel | null]
}>()

const viewport = ref<HTMLDivElement | null>(null)
let controller: KukaSceneController | null = null

onMounted(() => {
  if (!viewport.value) return
  controller = createKukaScene(viewport.value, {
    onStatus: (status) => emit('status', status),
    onModel: (model) => emit('model', model),
  })
  controller.setJoints(props.joints)
})

watch(
  () => props.joints,
  (joints) => controller?.setJoints(joints),
  { deep: true },
)

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
