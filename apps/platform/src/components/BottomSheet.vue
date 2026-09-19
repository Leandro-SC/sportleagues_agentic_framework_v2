<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition enter-active-class="transition-opacity duration-200" leave-active-class="transition-opacity duration-150" enter-from-class="opacity-0" leave-to-class="opacity-0">
      <div v-if="open" class="fixed inset-0 z-50 bg-canvas/70 backdrop-blur-sm" @click="close" />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-200 ease-out"
      leave-active-class="transition-transform duration-150 ease-in"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="open"
        class="safe-bottom fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg rounded-t-2xl border-t border-border bg-surface p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
      >
        <div class="mx-auto mb-4 h-1.5 w-10 rounded-pill bg-surface-3" />
        <div class="mb-4 flex items-center justify-between">
          <h2 v-if="title" class="text-lg font-bold text-text">{{ title }}</h2>
          <button type="button" aria-label="Cerrar" class="ml-auto rounded-full p-1.5 text-text-muted hover:bg-surface-2" @click="close">
            <X class="h-5 w-5" />
          </button>
        </div>
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>
