<script setup lang="ts">
import { type Component } from 'vue'
import { CalendarDays, House, Trophy, UserRound } from 'lucide-vue-next'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

defineProps<{ active: 'home' | 'profile' }>()

type NavItem = { key: string; label: string; icon: Component; to?: RouteLocationRaw; disabled?: boolean; badge?: string }

const items: NavItem[] = [
  { key: 'home', label: 'Inicio', icon: House, to: { name: 'home' } },
  { key: 'matches', label: 'Partidos', icon: CalendarDays, disabled: true, badge: 'Fase 06' },
  { key: 'pools', label: 'Ligas', icon: Trophy, disabled: true, badge: 'Fase 05' },
  { key: 'profile', label: 'Perfil', icon: UserRound, to: { name: 'profile' } },
]
</script>

<template>
  <nav class="safe-bottom sticky bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur">
    <div class="mx-auto flex max-w-lg items-stretch justify-around px-2 py-1">
      <component
        :is="item.disabled ? 'button' : RouterLink"
        v-for="item in items"
        :key="item.key"
        v-bind="item.disabled ? { type: 'button', disabled: true } : { to: item.to }"
        class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold"
        :class="!item.disabled && active === item.key ? 'text-primary' : item.disabled ? 'text-text-faint' : 'text-text-muted'"
      >
        <span
          class="flex h-8 w-8 items-center justify-center rounded-full"
          :class="!item.disabled && active === item.key ? 'bg-primary text-canvas shadow-glow-primary' : ''"
        >
          <component :is="item.icon" class="h-5 w-5" />
        </span>
        <span>{{ item.label }}</span>
        <span v-if="item.disabled" class="text-[9px] font-semibold uppercase tracking-wide text-text-faint">{{ item.badge }}</span>
      </component>
    </div>
  </nav>
</template>
