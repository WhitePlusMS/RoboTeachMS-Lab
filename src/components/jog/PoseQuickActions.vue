<script setup lang="ts">
import { Home } from '@lucide/vue'

const emit = defineEmits<{
  reset: []
  'mechanical-zero': []
  random: []
}>()
</script>

<template>
  <div class="panel-actions">
    <button
      type="button"
      class="secondary-action home-action"
      title="机器人回到教学 Home（避开腕部奇异）"
      @click="emit('reset')"
    >
      <Home :size="14" />教学 Home
    </button>
    <button
      type="button"
      class="secondary-action"
      title="回到 ABB 六轴机械/同步零位（J5=+30°，避开腕部奇异）"
      @click="emit('mechanical-zero')"
    >
      机械零位
    </button>
    <button
      type="button"
      class="secondary-action"
      title="随机生成一组关节姿态"
      @click="emit('random')"
    >
      随机姿态
    </button>
  </div>
</template>

<style scoped>
.panel-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.home-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
</style>
