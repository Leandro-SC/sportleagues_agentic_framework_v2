<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Trophy } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ variant?: 'guest' | 'app'; title?: string; userName?: string | null }>(), {
  variant: 'guest',
})

const initials = computed(() => {
  const name = props.userName?.trim()
  if (!name) return '?'
  const parts = name.split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
})
</script>

<template>
  <header class="safe-top sticky top-0 z-30 border-b border-border bg-canvas/90 backdrop-blur">
    <div class="mx-auto flex max-w-lg items-center justify-between px-5 py-3.5">
      <RouterLink to="/" class="flex items-center gap-2">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-canvas shadow-glow-primary">
          <Trophy class="h-4.5 w-4.5" />
        </span>
        <span class="font-display text-lg font-extrabold tracking-tight text-text">SportLeagues</span>
      </RouterLink>
      <h1 v-if="title && variant === 'app'" class="hidden text-sm font-semibold text-text-muted sm:block">{{ title }}</h1>
      <div v-if="variant === 'app'" class="flex items-center gap-3">
        <RouterLink to="/admin" class="rounded-pill px-2.5 py-1 text-xs font-semibold text-secondary hover:bg-secondary-100">Admin</RouterLink>
        <RouterLink
          to="/perfil"
          class="press-scale flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-text ring-1 ring-primary/40"
          aria-label="Ver perfil"
        >{{ initials }}</RouterLink>
      </div>
    </div>
  </header>
</template>
