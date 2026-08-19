<script setup lang="ts">
import { watch } from 'vue'
import { X } from '@lucide/vue'

interface Props {
  /** 是否显示弹窗（受控）。 */
  open: boolean
  /** 弹窗标题。 */
  title: string
  /** 可选正文；也可通过默认 slot 提供更丰富的自定义内容。 */
  message?: string
  /** 确认按钮文案，默认「确认」。 */
  confirmText?: string
  /** 取消按钮文案，默认「取消」。 */
  cancelText?: string
  /** 危险操作（删除/覆盖等）时确认按钮用危险色。 */
  danger?: boolean
  /** 点击遮罩是否关闭，默认 true。 */
  closeOnBackdrop?: boolean
  /** 按下 Esc 是否关闭，默认 true。 */
  closeOnEsc?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  message: '',
  confirmText: '确认',
  cancelText: '取消',
  danger: false,
  closeOnBackdrop: true,
  closeOnEsc: true,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  confirm: []
  cancel: []
}>()

function onBackdrop(event: Event): void {
  if (!props.closeOnBackdrop) return
  if (event.target === event.currentTarget) emit('update:open', false)
}

function close(): void {
  emit('update:open', false)
}

function onCancel(): void {
  emit('cancel')
  close()
}

function onConfirm(): void {
  emit('confirm')
}

// Esc 关闭：随 open 开合在 document 上挂/解监听（immediate 以覆盖初始即打开的情况）。
let escHandler: ((event: KeyboardEvent) => void) | null = null
watch(
  () => props.open,
  (open) => {
    if (open) {
      escHandler = (event) => {
        if (event.key === 'Escape' && props.closeOnEsc) close()
      }
      document.addEventListener('keydown', escHandler)
    } else if (escHandler) {
      document.removeEventListener('keydown', escHandler)
      escHandler = null
    }
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-fade">
      <div v-if="open" class="confirm-overlay" @click.self="onBackdrop">
        <div
          class="confirm-card"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          :class="danger ? 'confirm-danger' : ''"
        >
          <header class="confirm-head">
            <h3 class="confirm-title">{{ title }}</h3>
            <button type="button" class="confirm-close" aria-label="关闭" @click="close">
              <X :size="15" />
            </button>
          </header>
          <div class="confirm-body">
            <slot>
              <p>{{ message }}</p>
            </slot>
          </div>
          <footer class="confirm-foot">
            <button type="button" class="preset-btn" @click="onCancel">{{ cancelText }}</button>
            <button
              type="button"
              class="preset-btn"
              :class="danger ? 'preset-btn-danger' : 'preset-btn-primary'"
              @click="onConfirm"
            >
              {{ confirmText }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-toast);
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--color-scrim);
  backdrop-filter: blur(2px);
}

.confirm-card {
  width: min(440px, 92vw);
  max-height: 85vh;
  overflow: hidden auto;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  background: var(--color-surface-deep);
  box-shadow: var(--shadow-modal);
}

.confirm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.confirm-title {
  margin: 0;
  color: var(--color-text-strong);
  font-size: var(--text-2xl);
  font-weight: 700;
}

.confirm-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-faint);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-lg);
  line-height: 1.4;
}

.confirm-close:hover {
  color: var(--color-text);
  background: var(--color-surface-hover);
}

.confirm-body {
  padding: 14px 16px;
  color: var(--color-text);
  font-size: var(--text-lg);
  line-height: 1.6;
}

.confirm-body p {
  margin: 0;
}

.confirm-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
}

.preset-btn {
  padding: 7px 16px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  background: var(--color-surface);
  cursor: pointer;
  font-size: var(--text-lg);
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.preset-btn:hover {
  background: var(--color-surface-hover);
}

.preset-btn-primary {
  border-color: var(--color-brand);
  color: var(--color-on-brand);
  background: var(--color-brand);
  font-weight: 600;
}

.preset-btn-primary:hover {
  background: var(--color-brand-strong);
}

.preset-btn-danger {
  border-color: var(--color-danger);
  color: var(--color-on-fill);
  background: var(--color-danger);
  font-weight: 600;
}

.preset-btn-danger:hover {
  background: var(--color-danger-strong);
}

.confirm-fade-enter-active,
.confirm-fade-leave-active {
  transition: opacity 0.18s ease;
}

.confirm-fade-enter-active .confirm-card,
.confirm-fade-leave-active .confirm-card {
  transition: transform 0.18s ease;
}

.confirm-fade-enter-from,
.confirm-fade-leave-to {
  opacity: 0;
}

.confirm-fade-enter-from .confirm-card,
.confirm-fade-leave-to .confirm-card {
  transform: translateY(8px) scale(0.98);
}
</style>
