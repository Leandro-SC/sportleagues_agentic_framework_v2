<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'

withDefaults(defineProps<{ loading?: boolean; disabled?: boolean; fullWidth?: boolean; type?: 'button' | 'submit'; tone?: 'neutral' | 'danger' }>(), {
  loading: false,
  disabled: false,
  fullWidth: true,
  type: 'button',
  tone: 'neutral',
})
</script>

<template>
  <button
    :type="type"
    :disabled="loading || disabled"
    class="press-scale inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-3.5 text-[15px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      fullWidth ? 'w-full' : '',
      tone === 'danger'
        ? 'border-danger-100 bg-white text-danger-600 hover:bg-danger-100'
        : 'border-mist-300 bg-white text-ink-900 hover:bg-mist-100',
    ]"
  >
    <LoaderCircle v-if="loading" class="h-4 w-4 animate-spin" />
    <slot />
  </button>
</template>
