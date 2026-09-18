<script setup lang="ts">
import { type Component } from 'vue'
import { Activity, House, Trophy, UserRound } from 'lucide-vue-next'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

defineProps<{ active: 'home' | 'profile' }>()

type NavItem = { key: string; label: string; icon: Component; to?: RouteLocationRaw; disabled?: boolean; badge?: string }

const items: NavItem[] = [
  { key: 'home', label: 'Inicio', icon: House, to: { name: 'home' } },
  { key: 'pools', label: 'Quinielas', icon: Trophy, disabled: true, badge: 'Fase 05' },
  { key: 'activity', label: 'Actividad', icon: Activity, disabled: true, badge: 'Fase 08' },
  { key: 'profile', label: 'Perfil', icon: UserRound, to: { name: 'profile' } },
]
</script>

<template>
  <nav class="safe-bottom sticky bottom-0 z-30 border-t border-mist-200 bg-white/95 backdrop-blur">
    <div class="mx-auto flex max-w-lg items-stretch justify-around px-2 py-1.5">
      <component
        :is="item.disabled ? 'button' : RouterLink"
        v-for="item in items"
        :key="item.key"
        v-bind="item.disabled ? { type: 'button', disabled: true } : { to: item.to }"
        class="flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium"
        :class="!item.disabled && active === item.key ? 'text-brand-600' : item.disabled ? 'text-mist-400' : 'text-ink-500'"
      >
        <component :is="item.icon" class="h-5 w-5" />
        <span>{{ item.label }}</span>
        <span v-if="item.disabled" class="text-[9px] font-semibold uppercase tracking-wide text-mist-400">{{ item.badge }}</span>
      </component>
    </div>
  </nav>
</template>
