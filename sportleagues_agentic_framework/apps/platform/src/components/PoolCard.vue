<script setup lang="ts">
import { Trophy, Users } from 'lucide-vue-next'
import StatChip from './StatChip.vue'

withDefaults(
  defineProps<{
    name: string
    competition?: string
    status?: 'active' | 'pending' | 'closed'
    membersCount?: number
    variant?: 'hero' | 'list'
  }>(),
  { variant: 'list', status: 'active' },
)

const statusTone: Record<string, 'success' | 'warn' | 'neutral'> = { active: 'success', pending: 'warn', closed: 'neutral' }
const statusLabel: Record<string, string> = { active: 'Acceso confirmado', pending: 'Pendiente de aprobación', closed: 'Cerrada' }
</script>

<template>
  <div
    class="rounded-2xl border border-mist-200 bg-gradient-to-br from-ink-900 to-ink-700 text-white shadow-md"
    :class="variant === 'hero' ? 'p-6' : 'p-4'"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-3">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
          <Trophy class="h-5 w-5 text-brand-300" />
        </span>
        <div>
          <p v-if="competition" class="text-xs font-medium uppercase tracking-wide text-white/60">{{ competition }}</p>
          <h2 class="font-display font-bold" :class="variant === 'hero' ? 'text-xl' : 'text-base'">{{ name }}</h2>
        </div>
      </div>
    </div>
    <div class="mt-4 flex flex-wrap items-center gap-2">
      <StatChip :label="statusLabel[status]" :tone="statusTone[status]" />
      <StatChip v-if="membersCount" :label="`${membersCount} participantes`" :icon="Users" tone="neutral" />
    </div>
    <div v-if="$slots.action" class="mt-4"><slot name="action" /></div>
  </div>
</template>
