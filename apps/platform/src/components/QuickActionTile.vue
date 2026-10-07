<script setup lang="ts">
import { type Component } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

defineProps<{ icon: Component; label: string; to: RouteLocationRaw }>()
</script>

<template>
  <RouterLink
    :to="to"
    class="press-scale flex flex-col items-center gap-2 rounded-2xl border border-primary/25 bg-linear-to-b from-surface-2 to-surface px-1 py-3.5 text-center hover:border-primary/60"
  >
    <component :is="icon" class="h-6 w-6 text-primary" aria-hidden="true" />
    <span class="text-[11px] font-semibold leading-tight text-text">{{ label }}</span>
  </RouterLink>
</template>
