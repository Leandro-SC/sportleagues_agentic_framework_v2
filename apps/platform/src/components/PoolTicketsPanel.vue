<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Plus, Ticket } from 'lucide-vue-next'
import ClosingSoonBanner, { type ClosingItem } from './ClosingSoonBanner.vue'
import EmptyState from './EmptyState.vue'
import ErrorState from './ErrorState.vue'
import PredictionMatchCard from './PredictionMatchCard.vue'
import PrimaryButton from './PrimaryButton.vue'
import SecondaryButton from './SecondaryButton.vue'
import StatChip from './StatChip.vue'
import LoadingSkeleton from './LoadingSkeleton.vue'
import { usePoolTickets } from '../composables/usePoolTickets'
import type { FixtureItem } from '../composables/usePoolPlay'
import { salesLabel, salesOpen, ticketStatusLabel } from '../lib/tickets'

// Tickets de una quiniela con tickets habilitados. Cupo, cierre de venta y elegibilidad los decide el servidor: aquí solo se muestran y se
// ofrecen las acciones. Solo compite el mejor ticket enviado de cada jornada.
const props = defineProps<{ poolId: string; profileId: string; fixture: FixtureItem[]; timezone: string; now: Date; canPredict: boolean }>()
const t = usePoolTickets()
const active = ref<Record<string, string>>({})   // jornada → ticket elegido
const messages = ref<Record<string, string>>({})

const rounds = computed(() => {
  const map = new Map<string, { id: string; name: string; order: number; items: FixtureItem[] }>()
  for (const item of props.fixture) {
    if (!map.has(item.roundId)) map.set(item.roundId, { id: item.roundId, name: item.roundName, order: item.roundOrder, items: [] })
    map.get(item.roundId)!.items.push(item)
  }
  return [...map.values()].sort((a, b) => a.order - b.order)
})
const closesAt = (roundId: string): string | null => {
  const locks = props.fixture.filter((f) => f.roundId === roundId).map((f) => f.lockAt).sort()
  return locks[0] ?? null
}
const ticketsOf = (roundId: string) => t.tickets.value.filter((x) => x.round_id === roundId)
const liveCount = (roundId: string): number => ticketsOf(roundId).filter((x) => x.status !== 'cancelled').length
const limit = (roundId: string): number | null => t.roundLimits.value[roundId] ?? null
const selected = (roundId: string) => ticketsOf(roundId).find((x) => x.ticket_id === active.value[roundId]) ?? null

const closing = computed<ClosingItem[]>(() => rounds.value.flatMap((r) => {
  const at = closesAt(r.id)
  const submitted = ticketsOf(r.id).some((x) => x.status === 'submitted')
  return at && limit(r.id) !== null && !submitted && salesOpen(at, props.now) ? [{ key: r.id, label: `${r.name}: aún sin ticket enviado`, closesAt: at }] : []
}))

function pick(roundId: string): void {
  const list = ticketsOf(roundId)
  if (!list.some((x) => x.ticket_id === active.value[roundId])) {
    const next = list.find((x) => x.status !== 'cancelled') ?? list[0]
    if (next) active.value = { ...active.value, [roundId]: next.ticket_id }
  }
}
watch([() => t.tickets.value, rounds], () => rounds.value.forEach((r) => pick(r.id)), { deep: true, immediate: true })

const setMessage = (key: string, message: string | null): void => { messages.value = { ...messages.value, [key]: message ?? '' } }

async function create(roundId: string): Promise<void> {
  const message = await t.createTicket(roundId)
  setMessage(roundId, message)
  if (!message) {
    const created = ticketsOf(roundId).filter((x) => x.status === 'draft').sort((a, b) => b.display_no - a.display_no)[0]
    if (created) active.value = { ...active.value, [roundId]: created.ticket_id }
  }
}
async function save(roundId: string, matchId: string, poolMatchId: string, home: number, away: number): Promise<void> {
  const ticket = selected(roundId)
  if (!ticket) return
  setMessage(poolMatchId, await t.saveSelection(ticket.ticket_id, matchId, home, away))
}
async function submit(roundId: string): Promise<void> {
  const ticket = selected(roundId)
  if (ticket) setMessage(roundId, await t.submitTicket(ticket.ticket_id))
}
async function cancel(roundId: string): Promise<void> {
  const ticket = selected(roundId)
  if (ticket) setMessage(roundId, await t.cancelTicket(ticket.ticket_id))
}
function cardFor(roundId: string, item: FixtureItem): FixtureItem {
  const ticket = selected(roundId)
  const sel = ticket ? t.selections.value[ticket.ticket_id]?.[item.poolMatchId] : undefined
  return { ...item, mine: sel ? { home: sel.home, away: sel.away } : null, points: sel?.points ?? null }
}

onMounted(() => { void t.load(props.poolId, props.profileId) })
watch(() => props.poolId, () => { void t.load(props.poolId, props.profileId) })
</script>

<template>
  <section class="space-y-6" aria-label="Tickets de la quiniela">
    <p class="text-sm text-text-muted">Cada ticket es una jugada completa de la jornada. Solo compite tu mejor ticket enviado y la venta cierra con el primer partido de la jornada.</p>
    <div v-if="t.loading.value && !t.tickets.value.length" class="space-y-3" role="status" aria-label="Cargando tickets"><LoadingSkeleton height="6rem" /><LoadingSkeleton height="6rem" /></div>
    <ErrorState v-else-if="t.error.value" :description="t.error.value" />
    <template v-else>
      <ClosingSoonBanner :items="closing" :now="now" />
      <EmptyState v-if="!rounds.length" :icon="Ticket" title="Aún no hay jornadas" description="El organizador todavía no cargó partidos en esta quiniela." />

      <article v-for="round in rounds" :key="round.id" class="app-surface space-y-3 p-4" :aria-label="`Tickets de ${round.name}`">
        <header class="flex items-start justify-between gap-2">
          <div><h2 class="font-display text-base font-bold text-text">{{ round.name }}</h2><p class="text-xs text-text-muted">{{ salesLabel(closesAt(round.id), now) }}</p></div>
          <StatChip v-if="limit(round.id) !== null" :label="`${liveCount(round.id)}/${limit(round.id)} tickets`" tone="brand" />
        </header>

        <EmptyState v-if="limit(round.id) === null" title="Tickets no habilitados" description="El organizador aún no habilitó tickets para esta jornada." />
        <template v-else>
          <div v-if="ticketsOf(round.id).length" class="flex gap-2 overflow-x-auto pb-1" role="tablist" :aria-label="`Tus tickets de ${round.name}`">
            <button v-for="ticket in ticketsOf(round.id)" :key="ticket.ticket_id" type="button" role="tab" :aria-selected="active[round.id] === ticket.ticket_id"
              class="min-h-11 shrink-0 rounded-xl border px-3 py-2 text-left text-sm" :class="active[round.id] === ticket.ticket_id ? 'border-primary/60 bg-primary-100 text-primary' : 'border-border text-text-muted'"
              @click="active = { ...active, [round.id]: ticket.ticket_id }">
              Ticket {{ ticket.display_no }}<span v-if="ticket.is_best" class="ml-1 text-[11px] font-bold">★ mejor</span>
              <span class="block text-[11px]">{{ ticketStatusLabel(ticket.status, ticket.eligibility).label }}</span>
            </button>
          </div>
          <EmptyState v-else :icon="Ticket" title="Todavía no tienes tickets en esta jornada" description="Crea uno para empezar a pronosticar." />

          <PrimaryButton v-if="salesOpen(closesAt(round.id), now) && canPredict && liveCount(round.id) < (limit(round.id) ?? 0)" :loading="t.busy.value === `create:${round.id}`" @click="create(round.id)">
            <Plus class="h-4 w-4" aria-hidden="true" />Nuevo ticket
          </PrimaryButton>
          <p v-else-if="canPredict && liveCount(round.id) >= (limit(round.id) ?? 0) && salesOpen(closesAt(round.id), now)" class="text-xs text-text-muted">Alcanzaste el máximo de tickets de esta jornada. Cancela uno sin enviar para emitir otro.</p>

          <div v-if="selected(round.id)" class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <StatChip :label="ticketStatusLabel(selected(round.id)!.status, selected(round.id)!.eligibility).label" :tone="ticketStatusLabel(selected(round.id)!.status, selected(round.id)!.eligibility).tone" />
              <span v-if="selected(round.id)!.results_count > 0" class="font-display text-sm font-bold text-primary">{{ selected(round.id)!.points }} pts</span>
            </div>
            <PredictionMatchCard v-for="item in round.items" :key="item.poolMatchId" :item="cardFor(round.id, item)" :now="now" :timezone="timezone"
              :can-predict="canPredict && selected(round.id)!.status !== 'cancelled'" :saving="t.busy.value === `save:${selected(round.id)!.ticket_id}:${item.matchId}`"
              :message="messages[item.poolMatchId]" @save="(h, a) => save(round.id, item.matchId, item.poolMatchId, h, a)" />
            <div v-if="canPredict && selected(round.id)!.status !== 'cancelled' && salesOpen(closesAt(round.id), now)" class="grid grid-cols-2 gap-2">
              <PrimaryButton v-if="selected(round.id)!.status === 'draft'" :loading="t.busy.value === `submit:${selected(round.id)!.ticket_id}`" @click="submit(round.id)">Enviar ticket</PrimaryButton>
              <SecondaryButton tone="danger" :loading="t.busy.value === `cancel:${selected(round.id)!.ticket_id}`" @click="cancel(round.id)">Cancelar ticket</SecondaryButton>
            </div>
            <p v-if="selected(round.id)!.status === 'draft' && !salesOpen(closesAt(round.id), now)" class="text-xs text-warn">La venta cerró: este borrador no compite.</p>
          </div>
        </template>
        <p v-if="messages[round.id]" class="text-sm font-medium text-danger" role="alert">{{ messages[round.id] }}</p>
      </article>
    </template>
  </section>
</template>
