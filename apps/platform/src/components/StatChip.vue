<script setup lang="ts">
import { type Component } from 'vue'

withDefaults(defineProps<{ label: string; tone?: 'brand' | 'success' | 'warn' | 'danger' | 'neutral'; icon?: Component }>(), {
  tone: 'neutral',
})

const toneClasses: Record<string, string> = {
  brand: 'bg-brand-100 text-brand-700',
  success: 'bg-success-100 text-success-600',
  warn: 'bg-warn-100 text-warn-600',
  danger: 'bg-danger-100 text-danger-600',
  neutral: 'bg-mist-100 text-ink-600',
}
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-semibold" :class="toneClasses[tone]">
    <component :is="icon" v-if="icon" class="h-3.5 w-3.5" />
    {{ label }}
  </span>
</template>
