<script setup lang="ts">
import { computed, type Component } from 'vue'
import { CalendarClock, House, LayoutDashboard, SquareActivity, Trophy, UserRound, ChartNoAxesColumnIncreasing, Wallet, ArrowLeftRight } from 'lucide-vue-next'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import type { NavMode } from '../lib/role-navigation'

export type UserNavKey = 'home' | 'matches' | 'leagues' | 'points' | 'profile'
export type AdminNavKey = 'panel' | 'pools' | 'fixture' | 'finance'
export type NavKey = UserNavKey | AdminNavKey

const props = withDefaults(defineProps<{ active: NavKey; mode?: NavMode }>(), { mode: 'user' })

type NavItem = { key: NavKey; label: string; icon: Component; to: RouteLocationRaw }

// Experiencia participante (`user`).
const userItems: NavItem[] = [
  { key: 'home', label: 'Inicio', icon: House, to: { name: 'home' } },
  { key: 'matches', label: 'Partidos', icon: SquareActivity, to: { name: 'matches' } },
  { key: 'leagues', label: 'Ligas', icon: Trophy, to: { name: 'leagues' } },
  { key: 'points', label: 'Puntos', icon: ChartNoAxesColumnIncreasing, to: { name: 'points' } },
  { key: 'profile', label: 'Perfil', icon: UserRound, to: { name: 'profile' } },
]

// Experiencia organizador (`admin`): solo destinos que existen y están implementados. Es la misma
// cuenta con otra vista, no un rol nuevo; la autoridad real sigue siendo RLS/RPC.
const adminItems: NavItem[] = [
  { key: 'panel', label: 'Panel', icon: LayoutDashboard, to: { name: 'organizer-dashboard' } },
  { key: 'pools', label: 'Quinielas', icon: Trophy, to: { name: 'admin' } },
  { key: 'fixture', label: 'Parrilla', icon: CalendarClock, to: { name: 'admin-fixture' } },
  { key: 'finance', label: 'Finanzas', icon: Wallet, to: { name: 'admin-income' } },
  { key: 'profile', label: 'Perfil', icon: UserRound, to: { name: 'profile' } },
]

const items = computed<NavItem[]>(() => (props.mode === 'admin' ? adminItems : userItems))
</script>

<template>
  <nav :aria-label="mode === 'admin' ? 'Navegación del organizador' : 'Navegación principal'" class="safe-bottom sticky bottom-0 z-30 border-t border-border bg-canvas/95 backdrop-blur">
    <!-- Salida siempre visible del modo organizador hacia la experiencia de participante. -->
    <RouterLink
      v-if="mode === 'admin'"
      :to="{ name: 'home' }"
      data-test="exit-admin-mode"
      class="mx-auto flex min-h-11 max-w-lg items-center justify-center gap-2 border-b border-border px-4 text-sm font-semibold text-primary hover:bg-surface-2"
    >
      <ArrowLeftRight class="h-4 w-4" aria-hidden="true" />Modo participante · Volver a Inicio
    </RouterLink>
    <div class="mx-auto flex h-(--bottom-nav-h) max-w-lg items-stretch justify-around px-2 pt-1.5">
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
