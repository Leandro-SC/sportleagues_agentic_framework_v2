<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'

withDefaults(defineProps<{ loading?: boolean; disabled?: boolean; fullWidth?: boolean; type?: 'button' | 'submit' }>(), {
  loading: false,
  disabled: false,
  fullWidth: true,
  type: 'button',
})
</script>

<template>
  <button
    :type="type"
    :disabled="loading || disabled"
    class="press-scale inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3.5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-mist-300 disabled:text-mist-400 disabled:shadow-none"
    :class="fullWidth ? 'w-full' : ''"
  >
    <LoaderCircle v-if="loading" class="h-4 w-4 animate-spin" />
    <slot />
  </button>
</template>
