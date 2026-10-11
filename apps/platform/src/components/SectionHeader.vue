<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

defineProps<{ title: string; to?: RouteLocationRaw; linkLabel?: string }>()
</script>

<template>
  <div class="mb-3 flex items-center justify-between gap-3">
    <h2 class="flex items-center gap-2 font-display text-base font-bold text-text">{{ title }}<slot name="badge" /></h2>
    <RouterLink v-if="to" :to="to" class="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline">
      {{ linkLabel ?? 'Ver todos' }}<ChevronRight class="h-3.5 w-3.5" />
    </RouterLink>
  </div>
</template>
