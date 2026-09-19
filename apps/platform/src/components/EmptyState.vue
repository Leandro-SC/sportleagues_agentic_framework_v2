<script setup lang="ts">
import { type Component } from 'vue'

defineProps<{ icon?: Component; title: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-surface/60 px-6 py-10 text-center">
    <span v-if="icon" class="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary">
      <component :is="icon" class="h-6 w-6" />
    </span>
    <h3 class="text-base font-semibold text-text">{{ title }}</h3>
    <p v-if="description" class="max-w-xs text-sm text-text-muted">{{ description }}</p>
    <div v-if="$slots.action" class="mt-1 w-full max-w-xs"><slot name="action" /></div>
  </div>
</template>
