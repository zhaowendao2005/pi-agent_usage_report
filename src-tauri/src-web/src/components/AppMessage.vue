<template>
  <Teleport to="body">
    <!-- ===== Confirm Dialog ===== -->
    <Transition name="fade">
      <div
        v-if="confirmState.show"
        class="fixed inset-0 z-[100] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="onCancel" />

        <div class="relative bg-card border border-border rounded-lg shadow-2xl w-[min(92vw,420px)] p-5 animate-zoom-in">
          <div class="flex items-start gap-3">
            <div
              class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
              :class="confirmState.danger
                ? 'bg-red-100 text-red-600 dark:bg-red-950/40'
                : 'bg-blue-100 text-blue-600 dark:bg-blue-950/40'"
            >
              <component
                :is="confirmState.danger ? AlertTriangleIcon : HelpCircleIcon"
                class="w-5 h-5"
              />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-semibold text-foreground">{{ confirmState.title }}</h3>
              <p class="mt-1.5 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap break-words">
                {{ confirmState.message }}
              </p>
            </div>
          </div>

          <div class="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              class="px-3.5 py-1.5 text-xs border border-border rounded hover:bg-accent transition-colors"
              @click="onCancel"
            >
              {{ confirmState.cancelText }}
            </button>
            <button
              type="button"
              class="px-3.5 py-1.5 text-xs font-medium rounded transition-colors"
              :class="confirmState.danger
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-accent text-foreground hover:bg-accent/80'"
              @click="onConfirm"
            >
              {{ confirmState.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ===== Toasts ===== -->
    <div class="fixed top-4 right-4 z-[110] flex flex-col items-end gap-2 w-[min(92vw,360px)] pointer-events-none">
      <TransitionGroup name="toast">
        <div
          v-for="item in toasts"
          :key="item.id"
          class="pointer-events-auto flex items-start gap-2.5 w-full rounded-lg border bg-card px-3.5 py-2.5 shadow-lg"
          :class="toastBorder(item.type)"
          role="status"
        >
          <component
            :is="toastIcon(item.type)"
            class="w-4 h-4 shrink-0 mt-0.5"
            :class="toastIconColor(item.type)"
          />
          <p class="flex-1 min-w-0 text-xs text-foreground leading-relaxed break-words">
            {{ item.content }}
          </p>
          <button
            type="button"
            class="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            @click="dismissToast(item.id)"
          >
            <XIcon class="w-3.5 h-3.5" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import type { Component } from 'vue'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  HelpCircleIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-vue-next'
import { useMessage } from '@/lib/message'

const { toasts, confirmState, dismissToast, resolveConfirm } = useMessage()

const toastIcon: Record<string, Component> = {
  success: CheckCircle2Icon,
  error: TriangleAlertIcon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
}

const toastIconColor: Record<string, string> = {
  success: 'text-green-600',
  error: 'text-red-600',
  warning: 'text-amber-600',
  info: 'text-blue-600',
}

const toastBorder: Record<string, string> = {
  success: 'border-green-200/70',
  error: 'border-red-200/70',
  warning: 'border-amber-200/70',
  info: 'border-blue-200/70',
}

function onConfirm() {
  resolveConfirm(true)
}

function onCancel() {
  resolveConfirm(false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && confirmState.show) onCancel()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

@keyframes zoomIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
.animate-zoom-in {
  animation: zoomIn 0.15s ease-out;
}
</style>