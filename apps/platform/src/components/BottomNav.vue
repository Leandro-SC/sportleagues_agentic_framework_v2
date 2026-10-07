<script setup lang="ts">
import { type Component } from 'vue'
import { House, SquareActivity, Trophy, UserRound } from 'lucide-vue-next'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

export type NavKey = 'home' | 'matches' | 'leagues' | 'profile'

defineProps<{ active: NavKey }>()

const items: Array<{ key: NavKey; label: string; icon: Component; to: RouteLocationRaw }> = [
  { key: 'home', label: 'Inicio', icon: House, to: { name: 'home' } },
  { key: 'matches', label: 'Partidos', icon: SquareActivity, to: { name: 'matches' } },
  { key: 'leagues', label: 'Ligas', icon: Trophy, to: { name: 'leagues' } },
  { key: 'profile', label: 'Perfil', icon: UserRound, to: { name: 'profile' } },
]
</script>

<template>
  <nav aria-label="Navegación principal" class="safe-bottom sticky bottom-0 z-30 border-t border-border bg-canvas/95 backdrop-blur">
    <div class="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-1.5">
      <RouterLink
        v-for="item in items"
        :key="item.key"
        :to="item.to"
        :aria-current="active === item.key ? 'page' : undefined"
        class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 pb-2 pt-1 text-[11px] font-semibold transition-colors"
        :class="active === item.key ? 'text-primary' : 'text-text-muted hover:text-text'"
      >
        <span class="flex h-8 w-10 items-center justify-center rounded-xl" :class="active === item.key ? 'bg-primary-100 shadow-glow-primary' : ''">
          <component :is="item.icon" class="h-5.5 w-5.5" :stroke-width="active === item.key ? 2.4 : 2" />
        </span>
        <span>{{ item.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>
