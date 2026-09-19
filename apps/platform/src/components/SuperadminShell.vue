<script setup lang="ts">
import { Activity, Building2, CreditCard, LogOut, ScrollText, ShieldCheck } from 'lucide-vue-next'

withDefaults(defineProps<{ userName?: string | null }>(), { userName: null })
defineEmits<{ logout: [] }>()

const modules = [
  { key: 'overview', label: 'Resumen', icon: Activity, available: true },
  { key: 'tenants', label: 'Tenants', icon: Building2, available: false },
  { key: 'plans', label: 'Planes', icon: CreditCard, available: false },
  { key: 'audit', label: 'Auditoría', icon: ScrollText, available: false },
]
</script>

<template>
  <div class="min-h-screen bg-canvas text-text">
    <header class="safe-top border-b border-border">
      <div class="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
        <div class="flex items-center gap-2.5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary-100 text-secondary">
            <ShieldCheck class="h-4.5 w-4.5" />
          </span>
          <div>
            <p class="font-display text-sm font-extrabold tracking-tight text-text">SportLeagues</p>
            <p class="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Entorno global</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <p v-if="userName" class="text-xs text-text-muted">{{ userName }}</p>
          <button
            type="button"
            class="press-scale flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-semibold text-text-muted hover:bg-surface-2 hover:text-text"
            @click="$emit('logout')"
          >
            <LogOut class="h-3.5 w-3.5" />
            Cerrar sesión
          </button>
        </div>
      </div>
    </header>

    <div class="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6 sm:flex-row sm:gap-8">
      <nav class="sm:w-48 sm:shrink-0" aria-label="Navegación de plataforma">
        <ul class="flex gap-2 overflow-x-auto sm:flex-col sm:overflow-visible">
          <li v-for="module in modules" :key="module.key">
            <span
              class="flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium"
              :class="module.available ? 'bg-primary-100 text-primary' : 'text-text-faint'"
            >
              <component :is="module.icon" class="h-4 w-4" />
              {{ module.label }}
              <span v-if="!module.available" class="ml-auto text-[10px] font-semibold uppercase tracking-wide text-text-faint sm:ml-2">Próximamente</span>
            </span>
          </li>
        </ul>
      </nav>

      <main class="min-w-0 flex-1">
        <slot />
      </main>
    </div>
  </div>
</template>
