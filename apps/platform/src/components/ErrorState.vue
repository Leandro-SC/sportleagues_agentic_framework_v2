<script setup lang="ts">
import { ShieldAlert, TriangleAlert } from 'lucide-vue-next'

withDefaults(defineProps<{ title?: string; description: string; tone?: 'error' | 'denied' }>(), {
  tone: 'error',
})
</script>

<template>
  <div class="flex flex-col items-center gap-3 rounded-2xl border border-danger/30 bg-danger-100/50 px-6 py-8 text-center" role="alert">
    <span class="flex h-11 w-11 items-center justify-center rounded-full bg-danger-100 text-danger">
      <ShieldAlert v-if="tone === 'denied'" class="h-5 w-5" />
      <TriangleAlert v-else class="h-5 w-5" />
    </span>
    <h3 class="text-base font-semibold text-text">{{ title ?? (tone === 'denied' ? 'Sin acceso' : 'Algo salió mal') }}</h3>
    <p class="max-w-xs text-sm text-text-muted">{{ description }}</p>
    <div v-if="$slots.action" class="mt-1 w-full max-w-xs"><slot name="action" /></div>
  </div>
</template>
