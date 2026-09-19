<script setup lang="ts">
import { type Component } from 'vue'

withDefaults(defineProps<{ label: string; tone?: 'brand' | 'success' | 'warn' | 'danger' | 'neutral'; icon?: Component }>(), {
  tone: 'neutral',
})

const toneClasses: Record<string, string> = {
  brand: 'bg-secondary-100 text-secondary',
  success: 'bg-primary-100 text-primary',
  warn: 'bg-warn-100 text-warn',
  danger: 'bg-danger-100 text-danger',
  neutral: 'bg-surface-2 text-text-muted',
}
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold" :class="toneClasses[tone]">
    <component :is="icon" v-if="icon" class="h-3.5 w-3.5" />
    {{ label }}
  </span>
</template>
