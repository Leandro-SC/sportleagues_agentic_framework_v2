<script setup lang="ts">
import { type Component } from 'vue'

defineProps<{ icon?: Component; title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-mist-300 bg-white/60 px-6 py-10 text-center">
    <span v-if="icon" class="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600">
      <component :is="icon" class="h-6 w-6" />
    </span>
    <h3 class="text-base font-semibold text-ink-900">{{ title }}</h3>
    <p v-if="description" class="max-w-xs text-sm text-ink-500">{{ description }}</p>
    <div v-if="$slots.action" class="mt-1 w-full max-w-xs"><slot name="action" /></div>
  </div>
</template>
