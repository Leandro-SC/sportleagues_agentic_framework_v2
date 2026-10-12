<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Star, Ticket } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import StatChip from '../components/StatChip.vue'
import { useAuth } from '../composables/useAuth'
import { useMyTicketsHistory } from '../composables/usePoolTickets'
import { ticketStatusLabel } from '../lib/tickets'

// Historial de mis tickets (solo quinielas con tickets habilitados). Los datos y los puntos vienen del servidor; los tickets de
// distintas quinielas no se mezclan ni se suman.
const auth = useAuth()
const router = useRouter()
const history = useMyTicketsHistory()
onMounted(() => { void history.load() })

const groups = computed(() => {
  const pools = new Map<string, { id: string; name: string; rounds: Map<string, { id: string; name: string; tickets: typeof history.tickets.value }> }>()
  for (const t of history.tickets.value) {
    if (!pools.has(t.pool_id)) pools.set(t.pool_id, { id: t.pool_id, name: t.pool_name, rounds: new Map() })
    const pool = pools.get(t.pool_id)!
    if (!pool.rounds.has(t.round_id)) pool.rounds.set(t.round_id, { id: t.round_id, name: t.round_name, tickets: [] })
    pool.rounds.get(t.round_id)!.tickets.push(t)
  }
  return [...pools.values()].map((p) => ({ ...p, rounds: [...p.rounds.values()] }))
})
</script>

<template>
  <AppShell variant="app" active="points" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Mis tickets" :back="{ name: 'home' }" />
    <section class="space-y-4" aria-label="Historial de tickets">
      <p class="text-sm text-text-muted">Cada ticket es una jugada de una jornada. Solo compite tu mejor ticket enviado; los tickets no tienen valor económico.</p>
      <div v-if="history.loading.value" class="space-y-3" role="status" aria-label="Cargando tus tickets"><LoadingSkeleton height="5rem" /><LoadingSkeleton height="5rem" /></div>
      <ErrorState v-else-if="history.error.value" :description="history.error.value" />
      <EmptyState v-else-if="!groups.length" :icon="Ticket" title="Todavía no tienes tickets" description="Cuando una quiniela use tickets y crees tu primera jugada, la verás aquí con su estado y sus puntos.">
        <template #action><SecondaryButton @click="router.push({ name: 'leagues' })">Ir a mis ligas</SecondaryButton></template>
      </EmptyState>
      <template v-else>
        <section v-for="pool in groups" :key="pool.id" class="app-surface space-y-3 p-4">
          <button type="button" class="font-display font-bold text-text underline-offset-4 hover:underline" @click="router.push({ name: 'pool', params: { poolId: pool.id } })">{{ pool.name }}</button>
          <div v-for="round in pool.rounds" :key="round.id" class="space-y-2">
            <h2 class="text-sm font-semibold text-text-muted">{{ round.name }}</h2>
            <ul class="space-y-2">
              <li v-for="ticket in round.tickets" :key="ticket.ticket_id" class="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <div class="min-w-0">
                  <p class="flex items-center gap-1.5 text-sm font-semibold text-text">Ticket {{ ticket.display_no }}<Star v-if="ticket.is_best" class="h-3.5 w-3.5 text-primary" aria-label="Mejor ticket" /></p>
                  <p class="text-xs text-text-muted">{{ ticket.selections }}/{{ ticket.round_matches }} pronósticos</p>
                </div>
                <div class="flex flex-col items-end gap-1">
                  <StatChip :label="ticketStatusLabel(ticket.status, ticket.eligibility).label" :tone="ticketStatusLabel(ticket.status, ticket.eligibility).tone" />
                  <span v-if="ticket.results_count > 0 && ticket.status !== 'cancelled'" class="font-display text-sm font-bold text-primary">{{ ticket.points }} pts</span>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </template>
    </section>
  </AppShell>
</template>
