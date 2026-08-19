<script setup lang="ts">
import { computed } from 'vue'
import { injectToasts, type ToastLevel } from '@/application/toast.ts'
import { AlertTriangle, CheckCircle2, X, XCircle } from '@lucide/vue'

const toasts = injectToasts()
/** 无提供方（独立测试）时为空列表，不渲染任何通知。 */
const items = computed(() => toasts?.toasts.value ?? [])

/** toast 级别 → 图标。 */
function levelIcon(level: ToastLevel) {
  if (level === 'err') return XCircle
  if (level === 'warn') return AlertTriangle
  return CheckCircle2
}

function dismissToast(id: number): void {
  toasts?.dismiss(id)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="items.length > 0" class="toast-stack" role="status" aria-live="polite">
      <TransitionGroup name="toast">
        <div
          v-for="toast in items"
          :key="toast.id"
          class="toast-item"
          :class="`toast-${toast.level}`"
          role="alert"
        >
          <span class="toast-icon" aria-hidden="true">
            <component :is="levelIcon(toast.level)" :size="16" />
          </span>
          <div class="toast-body">
            <strong class="toast-title">{{ toast.title }}</strong>
            <p class="toast-text">{{ toast.text }}</p>
          </div>
          <button
            type="button"
            class="toast-close"
            aria-label="关闭通知"
            title="关闭通知"
            @click="dismissToast(toast.id)"
          >
            <X :size="13" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  top: 64px;
  right: 16px;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(320px, calc(100vw - 32px));
  pointer-events: none;
}

.toast-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-strong);
  border-left: 3px solid var(--color-info);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  box-shadow: var(--shadow-overlay);
  pointer-events: auto;
}

.toast-icon {
  display: grid;
  place-items: center;
  padding-top: 1px;
  color: var(--color-info);
}

.toast-warn {
  border-left-color: var(--color-warning-strong);
}

.toast-warn .toast-icon {
  color: var(--color-warning-strong);
}

.toast-err {
  border-left-color: var(--color-danger);
}

.toast-err .toast-icon {
  color: var(--color-danger);
}

.toast-ok {
  border-left-color: var(--color-success);
}

.toast-ok .toast-icon {
  color: var(--color-success);
}

.toast-body {
  min-width: 0;
}

.toast-title {
  display: block;
  color: var(--color-text-strong);
  font-size: var(--text-lg);
  line-height: 1.35;
}

.toast-text {
  margin: 2px 0 0;
  color: var(--color-text-dim);
  font-size: var(--text-md);
  line-height: 1.5;
}

.toast-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-faint);
  background: transparent;
  cursor: pointer;
  line-height: 1;
}

.toast-close:hover {
  color: var(--color-text);
  background: var(--color-surface-hover);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>
