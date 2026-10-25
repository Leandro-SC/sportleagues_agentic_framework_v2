<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LoaderCircle } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import ClosingSoonBanner from '../components/ClosingSoonBanner.vue'
import EmptyState from '../components/EmptyState.vue'
import EvolutionChart from '../components/EvolutionChart.vue'
import ErrorState from '../components/ErrorState.vue'
import PoolCard from '../components/PoolCard.vue'
import PoolTicketsPanel from '../components/PoolTicketsPanel.vue'
import PredictionMatchCard from '../components/PredictionMatchCard.vue'
import RankingRow from '../components/RankingRow.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import SegmentedTabs from '../components/SegmentedTabs.vue'
import ShareStudio from '../components/ShareStudio.vue'
import StatChip from '../components/StatChip.vue'
import { usePoolAccess } from '../composables/usePoolAccess'
import { usePoolPlay } from '../composables/usePoolPlay'
import { usePoolStats } from '../composables/usePoolStats'
import { useAuth } from '../composables/useAuth'
import { useIdentityWatch } from '../composables/useIdentityWatch'
import { usePoolLiveUpdates } from '../composables/usePoolLiveUpdates'
import { useTenantBranding } from '../composables/useTenantBranding'
import { appLinkHosts } from '../lib/pwa'
import type { ScorelineSuggestion } from '../lib/scoreline-suggestion'
import { buildPoolShareTemplates, poolShareLink } from '../lib/share-templates'

type Tab = 'summary' | 'matches' | 'table'
const router = useRouter()
const route = useRoute()
const auth = useAuth()
const access = usePoolAccess()
// El getter de identidad evita pintar o cachear lecturas hechas con el JWT de otro usuario (FE-05).
const play = usePoolPlay(undefined, () => auth.state.user?.id ?? null)
const stats = usePoolStats()
// Marca del organizador (nombre de plataforma en todos los planes; logo, banner y color en PRO) visible para sus jugadores.
const tenant = useTenantBranding()
const host = appLinkHosts()[0]!

const tab = ref<Tab>('summary')
const tabs: { value: Tab; label: string }[] = [{ value: 'summary', label: 'Resumen' }, { value: 'matches', label: 'Partidos' }, { value: 'table', label: 'Tabla' }]
const now = ref(new Date())
const roundFilter = ref('')
const messages = ref<Record<string, string>>({})
const suggestions = ref<Record<string, ScorelineSuggestion>>({})
const suggestionMessages = ref<Record<string, string>>({})

// Tabla en vivo: al publicarse o corregirse un resultado (o cambiar el estado de un partido) se recargan parrilla, tabla y estadísticas
// sin mostrar el estado de carga. Se conserva la jornada elegida en la tabla.
async function refreshLive(): Promise<void> {
  const poolId = access.pool.value?.id
  const userId = auth.state.user?.id
  if (!poolId || !userId) return
  await Promise.all([play.load(poolId, userId, { background: true }), stats.loadPool(poolId)])
  if (roundFilter.value) await play.loadLeaderboard(roundFilter.value)
}
usePoolLiveUpdates({
  tenantId: () => tenant.branding.value?.tenantId ?? null,
  active: () => play.fixture.value.some((item) => item.status !== 'final'),
  onChange: () => { void refreshLive() },
})
let timer: ReturnType<typeof setInterval> | undefined

const nextMatches = computed(() => play.fixture.value.filter((item) => item.status === 'scheduled' && new Date(item.lockAt).getTime() > now.value.getTime()).slice(0, 3))
const grouped = computed(() => {
  const groups = new Map<string, { name: string; items: typeof play.fixture.value }>()
  for (const item of play.fixture.value) {
    if (!groups.has(item.roundId)) groups.set(item.roundId, { name: item.roundName, items: [] })
    groups.get(item.roundId)!.items.push(item)
  }
  return [...groups.values()]
})
const closingClassic = computed(() => play.ticketMode.value === 'tickets' || !play.canPredict.value ? [] : play.fixture.value
  .filter((item) => item.status === 'scheduled' && !item.mine)
  .map((item) => ({ key: item.matchId, label: `${item.homeName} vs ${item.awayName} sin pronóstico`, closesAt: item.lockAt })))
const shareContext = computed(() => ({
  poolId: access.pool.value?.id ?? '', poolName: access.pool.value?.name ?? 'Quiniela', host, timezone: play.tenantTimezone.value, now: now.value,
  fixture: play.fixture.value, leaderboard: play.leaderboard.value,
  scopeLabel: roundFilter.value ? (play.rounds.value.find((r) => r.id === roundFilter.value)?.name ?? 'Jornada') : 'Tabla general',
  stats: stats.stats.value, playerName: auth.state.profile?.display_name ?? 'Jugador', joinCode: tenant.branding.value?.joinCode ?? null,
}))
const shareTemplates = computed(() => (access.pool.value ? buildPoolShareTemplates(shareContext.value) : []))
const shareLink = computed(() => poolShareLink(shareContext.value))
const rosterNotice = computed(() => {
  if (play.participation.value === 'pending') return 'Tu inscripción está pendiente de aprobación del organizador.'
  if (play.participation.value === 'none') return 'Administras esta quiniela o aún no te has inscrito: puedes ver la parrilla, pero no pronosticar.'
  return ''
})

async function save(matchId: string, home: number, away: number): Promise<void> {
  const message = await play.savePrediction(matchId, home, away)
  messages.value = { ...messages.value, [matchId]: message ?? '' }
}

async function suggest(poolMatchId: string, matchId: string): Promise<void> {
  const result = await play.suggestScoreline(poolMatchId)
  if ('suggestion' in result) {
    suggestions.value = { ...suggestions.value, [matchId]: result.suggestion }
    suggestionMessages.value = { ...suggestionMessages.value, [matchId]: '' }
  } else {
    suggestionMessages.value = { ...suggestionMessages.value, [matchId]: result.failure }
  }
}

function loadPool(): void {
  const id = typeof route.params.poolId === 'string' ? route.params.poolId : ''
  void access.load(id, auth.state.user?.id).then(() => { if (access.pool.value && auth.state.user) { void play.load(id, auth.state.user.id); void stats.loadPool(id); void tenant.load(id) } })
}

watch(() => route.params.poolId, loadPool, { immediate: true })
// Otra identidad con la vista montada (FE-05): lo mostrado era del usuario anterior. Se vacía, se limpian mensajes y sugerencias
// (también las de IA estadística) y se vuelve a verificar el acceso y cargar con el id vigente; sin sesión, se vuelve a Inicio.
useIdentityWatch(auth, {
  onChange: () => { play.reset(); tenant.reset(); messages.value = {}; suggestions.value = {}; suggestionMessages.value = {}; loadPool() },
  onSignedOut: () => { play.reset(); tenant.reset(); messages.value = {}; suggestions.value = {}; suggestionMessages.value = {}; void router.replace({ name: 'home' }) },
})
watch(roundFilter, (id) => { void play.loadLeaderboard(id || null) })
onMounted(() => { timer = setInterval(() => { now.value = new Date() }, 15_000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <AppShell variant="app" active="leagues" title="Quiniela" :user-name="auth.state.profile?.display_name">
    <ScreenHeader :title="access.pool.value?.name ?? 'Liga'" :back="{ name: 'leagues' }" />
    <section class="space-y-6">
      <div v-if="access.loading.value" class="flex items-center justify-center gap-2 py-16 text-sm text-text-muted">
        <LoaderCircle class="h-4 w-4 animate-spin" />Verificando acceso…
      </div>

      <template v-else-if="access.pool.value">
        <p v-if="access.offline.value" class="rounded-xl bg-surface-2 p-3 text-sm text-text-muted" role="status">Sin conexión: mostramos la última versión disponible de esta quiniela.</p>
        <div class="stadium-hero overflow-hidden rounded-3xl border p-1 shadow-md" :style="tenant.branding.value?.accent ? { borderColor: tenant.branding.value.accent } : undefined" :class="tenant.branding.value?.accent ? '' : 'border-secondary/25'">
          <img v-if="tenant.branding.value?.bannerUrl" :src="tenant.branding.value.bannerUrl" alt="" class="mb-1 aspect-8/3 w-full rounded-xl object-cover" data-testid="tenant-banner" />
          <div v-if="tenant.branding.value?.brandName || tenant.branding.value?.logoUrl" class="flex items-center gap-3 px-3 py-2" data-testid="tenant-brand">
            <img v-if="tenant.branding.value?.logoUrl" :src="tenant.branding.value.logoUrl" :alt="`Logo de ${tenant.branding.value.brandName ?? 'la organización'}`" class="h-10 max-w-34 shrink-0 object-contain" />
            <p v-if="tenant.branding.value?.brandName" class="truncate font-display text-sm font-bold" :style="tenant.branding.value.accent ? { color: tenant.branding.value.accent } : undefined" :class="tenant.branding.value.accent ? '' : 'text-secondary'">{{ tenant.branding.value.brandName }}</p>
          </div>
          <PoolCard :name="access.pool.value.name" variant="hero" status="active" />
        </div>

        <ShareStudio v-if="shareTemplates.length" :templates="shareTemplates" :branding="tenant.branding.value" :link="shareLink" button-label="Compartir por WhatsApp o redes" />

        <SegmentedTabs v-model="tab" :options="tabs" label="Secciones de la quiniela" variant="underline" />

        <div v-if="play.loading.value" class="flex items-center justify-center gap-2 py-10 text-sm text-text-muted"><LoaderCircle class="h-4 w-4 animate-spin" />Cargando…</div>
        <ErrorState v-else-if="play.error.value" :description="play.error.value" />

        <template v-else>
          <p v-if="rosterNotice" class="rounded-xl bg-surface-2 p-3 text-sm text-text-muted" role="status">{{ rosterNotice }}</p>
          <p v-if="play.offline.value" class="rounded-xl bg-warn-100 p-3 text-sm font-medium text-warn" role="status" data-test="offline-notice">Sin conexión: mostrando lo último guardado{{ play.updatedAt.value ? ` (${new Date(play.updatedAt.value).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })})` : '' }}. Pronosticar y emitir tickets requiere conexión: el servidor confirma siempre cada acción.</p>

          <ClosingSoonBanner :items="closingClassic" :now="now" />

          <section v-if="tab === 'summary'" class="space-y-6">
            <div v-if="play.myRow.value" class="app-surface flex items-center justify-between p-4">
              <div><p class="text-xs text-text-muted">Tu posición</p><p class="font-display text-2xl font-bold text-text">#{{ play.myRow.value.rank }}</p></div>
              <div class="text-right"><p class="text-xs text-text-muted">Puntos</p><p class="font-display text-2xl font-bold text-primary">{{ play.myRow.value.points }}</p></div>
            </div>
            <div v-if="stats.stats.value" class="app-surface space-y-4 p-4">
              <h2 class="font-display text-base font-bold text-text">Tu rendimiento</h2>
              <div class="grid grid-cols-3 gap-2 text-center">
                <div class="rounded-xl bg-surface-2 p-2"><p class="font-display text-lg font-bold text-text">{{ Math.round(stats.stats.value.hit_rate * 100) }}%</p><p class="text-[11px] text-text-muted">Acierto</p></div>
                <div class="rounded-xl bg-surface-2 p-2"><p class="font-display text-lg font-bold text-text">{{ stats.stats.value.exact_hits }}</p><p class="text-[11px] text-text-muted">Exactos</p></div>
                <div class="rounded-xl bg-surface-2 p-2"><p class="font-display text-lg font-bold text-text">{{ stats.stats.value.avg_points.toFixed(1) }}</p><p class="text-[11px] text-text-muted">Pts/partido</p></div>
              </div>
              <div class="flex flex-wrap gap-2"><StatChip :label="`Racha actual ${stats.stats.value.current_streak}`" tone="success" /><StatChip :label="`Mejor racha ${stats.stats.value.best_streak}`" /><StatChip :label="`Mejor jornada ${stats.stats.value.best_round_points} pts`" /></div>
              <EvolutionChart :points="stats.evolution.value" />
            </div>
            <div v-if="play.ticketMode.value === 'tickets'" class="app-surface space-y-3 p-4">
              <h2 class="font-display text-base font-bold text-text">Esta quiniela usa tickets</h2>
              <p class="text-sm text-text-muted">Pronostica desde la pestaña Partidos: cada jornada tiene sus tickets y solo compite el mejor ticket enviado.</p>
              <SecondaryButton @click="tab = 'matches'">Ir a mis tickets</SecondaryButton>
            </div>
            <div v-else>
              <h2 class="mb-3 font-display text-base font-bold text-text">Próximos partidos</h2>
              <EmptyState v-if="!nextMatches.length" title="Sin partidos abiertos" description="Cuando el organizador programe partidos aparecerán aquí." />
              <div v-else class="space-y-3">
                <PredictionMatchCard v-for="item in nextMatches" :key="item.matchId" :item="item" :now="now" :timezone="play.tenantTimezone.value" :can-predict="play.canPredict.value"
                  :saving="play.savingMatchId.value === item.matchId" :message="messages[item.matchId]" @save="(h, a) => save(item.matchId, h, a)"
                  :suggest-available="play.suggestAvailable.value" :suggesting="play.suggestingPoolMatchId.value === item.poolMatchId" :suggestion="suggestions[item.matchId] ?? null" :suggestion-message="suggestionMessages[item.matchId]" @suggest="suggest(item.poolMatchId, item.matchId)" />
              </div>
            </div>
          </section>

          <PoolTicketsPanel v-else-if="tab === 'matches' && play.ticketMode.value === 'tickets' && auth.state.user" :key="auth.state.user.id" :pool-id="access.pool.value.id" :profile-id="auth.state.user.id"
            :fixture="play.fixture.value" :timezone="play.tenantTimezone.value" :now="now" :can-predict="play.canPredict.value" />

          <section v-else-if="tab === 'matches'" class="space-y-6">
            <EmptyState v-if="!grouped.length" title="Aún no hay partidos" description="El organizador todavía no cargó la parrilla de esta quiniela." />
            <div v-for="group in grouped" :key="group.name">
              <h2 class="mb-3 font-display text-base font-bold text-text">{{ group.name }}</h2>
              <div class="space-y-3">
                <PredictionMatchCard v-for="item in group.items" :key="item.matchId" :item="item" :now="now" :timezone="play.tenantTimezone.value" :can-predict="play.canPredict.value"
                  :saving="play.savingMatchId.value === item.matchId" :message="messages[item.matchId]" @save="(h, a) => save(item.matchId, h, a)"
                  :suggest-available="play.suggestAvailable.value" :suggesting="play.suggestingPoolMatchId.value === item.poolMatchId" :suggestion="suggestions[item.matchId] ?? null" :suggestion-message="suggestionMessages[item.matchId]" @suggest="suggest(item.poolMatchId, item.matchId)" />
              </div>
            </div>
          </section>

          <section v-else class="space-y-3">
            <label v-if="play.rounds.value.length" class="block text-sm font-medium text-text-muted">Ver
              <select v-model="roundFilter" class="field-surface mt-1.5 w-full px-3 py-3 text-sm">
                <option value="">Tabla general</option>
                <option v-for="round in play.rounds.value" :key="round.id" :value="round.id">{{ round.name }}</option>
              </select>
            </label>
            <EmptyState v-if="!play.leaderboard.value.length" title="La tabla aparecerá con los primeros resultados" description="Se actualiza cuando el organizador publica resultados oficiales." />
            <div v-else class="space-y-1.5 app-surface p-3">
              <RankingRow v-for="row in play.leaderboard.value" :key="row.participant_id" :position="row.rank" :name="row.display_name" :points="row.points" :is-current-user="row.is_me"
                :detail="`${row.exact_hits} exactos · racha ${row.current_streak}`" />
            </div>
            <p v-if="play.leaderboard.value.length" class="flex items-center justify-center gap-1.5 text-xs text-text-muted" data-testid="live-table-note">
              <span class="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />En vivo: se actualiza sola al publicarse cada resultado{{ play.updatedAt.value ? ` · ${new Date(play.updatedAt.value).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : '' }}
            </p>
          </section>
        </template>
      </template>

      <ErrorState v-else-if="access.denied.value" tone="denied" description="No tienes acceso a esta quiniela.">
        <template #action><SecondaryButton @click="router.push({ name: 'home' })">Volver al inicio</SecondaryButton></template>
      </ErrorState>

      <ErrorState v-else-if="access.error.value" description="No fue posible verificar el acceso." />
    </section>
  </AppShell>
</template>
