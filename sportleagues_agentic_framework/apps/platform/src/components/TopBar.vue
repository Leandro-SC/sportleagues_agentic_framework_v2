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
  <header class="safe-top sticky top-0 z-30 bg-mist-50/90 backdrop-blur">
    <div class="mx-auto flex max-w-lg items-center justify-between px-5 py-4">
      <RouterLink to="/" class="flex items-center gap-2">
        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-brand-300">
          <Trophy class="h-4.5 w-4.5" />
        </span>
        <span class="font-display text-lg font-extrabold tracking-tight text-ink-950">SportLeagues</span>
      </RouterLink>
      <h1 v-if="title && variant === 'app'" class="hidden text-sm font-semibold text-ink-600 sm:block">{{ title }}</h1>
      <RouterLink
        v-if="variant === 'app'"
        to="/perfil"
        class="press-scale flex h-9 w-9 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-white"
        aria-label="Ver perfil"
      >{{ initials }}</RouterLink>
    </div>
  </header>
</template>
